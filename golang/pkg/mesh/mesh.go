// Package mesh implements PartialMesh, a self-organising WebRTC partial-mesh
// network over a FreeRTC signaling server.
// It is a faithful Go port of src/index.ts.
package mesh

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/peerpigeon/peerpigeon-go/pkg/signaling"
	"github.com/pion/webrtc/v3"
)

// ── configuration ──────────────────────────────────────────────────────────

// Config mirrors PartialMeshConfig from the TypeScript source.
type Config struct {
	MinPeers               int
	MaxPeers               int
	TolerantPeers          int
	SignalingServer        string
	SessionID              string
	AutoDiscover           bool
	AutoConnect            bool
	ICEServers             []webrtc.ICEServer // nil = use library defaults
	ConnectionTimeoutMs    int
	MaintenanceIntervalMs  int
	UnderConnectedResetMs  int
	NonInitiatorFallbackMs int
	TrickleICE             bool
	TrickleICESet          bool // internal: true if TrickleICE was explicitly set
}

func defaultConfig(c Config) Config {
	if c.MinPeers == 0 {
		c.MinPeers = 2
	}
	if c.MaxPeers == 0 {
		c.MaxPeers = 10
	}
	if c.TolerantPeers == 0 {
		t := c.MaxPeers / 4
		if t < 1 {
			t = 1
		}
		if t > 2 {
			t = 2
		}
		c.TolerantPeers = t
	}
	if c.SignalingServer == "" {
		c.SignalingServer = "wss://peer.ooo/ws"
	}
	if c.SessionID == "" {
		c.SessionID = "default-session"
	}
	if !c.AutoDiscover {
		// keep false if explicitly set
	} else {
		c.AutoDiscover = true
	}
	if c.ConnectionTimeoutMs == 0 {
		c.ConnectionTimeoutMs = 45_000
	}
	if c.MaintenanceIntervalMs == 0 {
		c.MaintenanceIntervalMs = 2_000
	}
	// TrickleICE defaults to true; caller must explicitly set to false to disable.
	if !c.TrickleICESet {
		c.TrickleICE = true
	}
	if c.NonInitiatorFallbackMs == 0 {
		c.NonInitiatorFallbackMs = 8_000
	}
	return c
}

// ── peer state ─────────────────────────────────────────────────────────────

type peerConn struct {
	id        string
	connected bool
	initiator bool
}

// ── mesh ───────────────────────────────────────────────────────────────────

// Mesh is the PartialMesh Go equivalent.
type Mesh struct {
	cfg Config

	mu                        sync.Mutex
	sig                       *signaling.Adapter
	clientID                  string
	selfAliases               map[string]struct{}
	peers                     map[string]*peerConn
	discoveredPeers           map[string]struct{}
	globalPeers               map[string]struct{}
	connecting                map[string]struct{}
	connTimers                map[string]*time.Timer
	connStartedAt             map[string]int64
	peerConnectedAt           map[string]int64
	discoveredAt              map[string]int64
	dialFailures              map[string]int
	dialBackoffUntil          map[string]int64
	nonInitFallbackTimers     map[string]*time.Timer
	rebalanceCooldownUntil    int64
	rebalanceAttemptAt        map[string]int64
	pendingRebalanceDrop      map[string]string // newTarget → dropPeer
	underConnectedSince       int64 // unix ms, 0 = not tracking
	lastHardReset             int64
	lastDiscoveryRefresh      int64
	lastSignalingReconnect    int64
	maintenanceTicker         *time.Ticker
	maintenanceDone           chan struct{}

	// event callbacks
	onSignalingConnected    []func(clientID string)
	onSignalingDisconnected []func()
	onSignalingError        []func(error)
	onSignalingLog          []func(string)
	onPeerConnected         []func(string)
	onPeerDisconnected      []func(string)
	onPeerData              []func(string, []byte)
	onPeerError             []func(string, error)
	onPeerDiscovered        []func(string)
	onMeshReady             []func()
	onMeshMembership        []func([]string)
}

// New creates a new Mesh with the given configuration.
func New(cfg Config) *Mesh {
	cfg = defaultConfig(cfg)
	m := &Mesh{
		cfg:                  cfg,
		selfAliases:          make(map[string]struct{}),
		peers:                make(map[string]*peerConn),
		discoveredPeers:      make(map[string]struct{}),
		globalPeers:          make(map[string]struct{}),
		connecting:           make(map[string]struct{}),
		connTimers:           make(map[string]*time.Timer),
		connStartedAt:        make(map[string]int64),
		peerConnectedAt:      make(map[string]int64),
		discoveredAt:         make(map[string]int64),
		dialFailures:         make(map[string]int),
		dialBackoffUntil:     make(map[string]int64),
		nonInitFallbackTimers: make(map[string]*time.Timer),
		rebalanceAttemptAt:   make(map[string]int64),
		pendingRebalanceDrop: make(map[string]string),
		maintenanceDone:      make(chan struct{}),
	}
	return m
}

// ── event registration ─────────────────────────────────────────────────────

func (m *Mesh) OnSignalingConnected(fn func(string))    { m.mu.Lock(); m.onSignalingConnected = append(m.onSignalingConnected, fn); m.mu.Unlock() }
func (m *Mesh) OnSignalingDisconnected(fn func())       { m.mu.Lock(); m.onSignalingDisconnected = append(m.onSignalingDisconnected, fn); m.mu.Unlock() }
func (m *Mesh) OnSignalingError(fn func(error))         { m.mu.Lock(); m.onSignalingError = append(m.onSignalingError, fn); m.mu.Unlock() }
func (m *Mesh) OnSignalingLog(fn func(string))          { m.mu.Lock(); m.onSignalingLog = append(m.onSignalingLog, fn); m.mu.Unlock() }
func (m *Mesh) OnPeerConnected(fn func(string))         { m.mu.Lock(); m.onPeerConnected = append(m.onPeerConnected, fn); m.mu.Unlock() }
func (m *Mesh) OnPeerDisconnected(fn func(string))      { m.mu.Lock(); m.onPeerDisconnected = append(m.onPeerDisconnected, fn); m.mu.Unlock() }
func (m *Mesh) OnPeerData(fn func(string, []byte))      { m.mu.Lock(); m.onPeerData = append(m.onPeerData, fn); m.mu.Unlock() }
func (m *Mesh) OnPeerError(fn func(string, error))      { m.mu.Lock(); m.onPeerError = append(m.onPeerError, fn); m.mu.Unlock() }
func (m *Mesh) OnPeerDiscovered(fn func(string))        { m.mu.Lock(); m.onPeerDiscovered = append(m.onPeerDiscovered, fn); m.mu.Unlock() }
func (m *Mesh) OnMeshReady(fn func())                   { m.mu.Lock(); m.onMeshReady = append(m.onMeshReady, fn); m.mu.Unlock() }
func (m *Mesh) OnMeshMembership(fn func([]string))      { m.mu.Lock(); m.onMeshMembership = append(m.onMeshMembership, fn); m.mu.Unlock() }

// ── public API ─────────────────────────────────────────────────────────────

// Init connects to the signaling server and starts the mesh.
func (m *Mesh) Init() {
	peerID := generateHexID(32)
	m.mu.Lock()
	m.addSelfAliasLocked(peerID)
	m.mu.Unlock()

	sig := signaling.New(
		normalizeWSURL(m.cfg.SignalingServer),
		m.cfg.SessionID,
		peerID,
		m.cfg.ICEServers,
		m.cfg.TrickleICE,
	)
	m.mu.Lock()
	m.sig = sig
	m.mu.Unlock()

	sig.OnSignalingLog(func(msg string) { m.fireSignalingLog(msg) })
	sig.OnError(func(err error) { m.fireSignalingError(err) })

	sig.OnConnected(func(e signaling.ConnectedEvent) {
		m.mu.Lock()
		m.clientID = normID(e.ClientID)
		m.lastSignalingReconnect = nowMs()
		m.addSelfAliasLocked(e.ClientID)
		m.addSelfAliasLocked(e.RequestedClientID)
		m.addSelfAliasLocked(e.PreviousClientID)
		cid := m.clientID
		m.mu.Unlock()

		m.fireSignalingConnected(cid)

		if m.cfg.AutoDiscover {
			sig.JoinSession(m.cfg.SessionID)
		}
		if m.cfg.AutoConnect {
			m.startMaintenanceLoop()
		}
	})

	sig.OnJoined(func(e signaling.JoinedEvent) {
		m.mu.Lock()
		for _, id := range e.Clients {
			m.addDiscoveredLocked(normID(id))
		}
		m.mu.Unlock()
		if m.cfg.AutoConnect {
			m.maintainPeerConnections()
		}
	})

	sig.OnPeerJoined(func(id string) {
		id = normID(id)
		if id == "" {
			return
		}
		m.mu.Lock()
		m.addDiscoveredLocked(id)
		m.mu.Unlock()
		if m.cfg.AutoConnect {
			m.maintainPeerConnections()
		}
	})

	sig.OnPeerLeft(func(id string) {
		id = normID(id)
		if id == "" {
			return
		}
		m.mu.Lock()
		m.removeFromGlobalLocked(id)
		delete(m.discoveredPeers, id)
		delete(m.dialFailures, id)
		delete(m.dialBackoffUntil, id)
		m.mu.Unlock()
		m.removePeer(id, true)
	})

	sig.OnRTCConnected(func(id string) {
		id = normID(id)
		if id == "" {
			return
		}
		m.mu.Lock()
		if m.isSelfAliasLocked(id) {
			m.mu.Unlock()
			return
		}
		pc := m.peers[id]
		if pc == nil {
			pc = &peerConn{id: id, connected: false, initiator: false}
			m.peers[id] = pc
		}
		if pc.connected {
			m.mu.Unlock()
			return
		}
		if t := m.connTimers[id]; t != nil {
			t.Stop()
			delete(m.connTimers, id)
		}
		delete(m.connStartedAt, id)
		pc.connected = true
		m.peerConnectedAt[id] = nowMs()
		delete(m.connecting, id)
		delete(m.dialFailures, id)
		delete(m.dialBackoffUntil, id)
		if t := m.nonInitFallbackTimers[id]; t != nil {
			t.Stop()
			delete(m.nonInitFallbackTimers, id)
		}
		dropTarget := m.pendingRebalanceDrop[id]
		delete(m.pendingRebalanceDrop, id)
		connCount := m.connectedCountLocked()
		m.mu.Unlock()

		m.firePeerConnected(id)
		m.sendMembership(id)

		if dropTarget != "" {
			m.mu.Lock()
			dropPC := m.peers[dropTarget]
			ok := dropPC != nil && dropPC.connected && connCount > m.cfg.MaxPeers
			m.mu.Unlock()
			if ok {
				m.disconnectFromPeer(dropTarget)
			}
		}

		m.trimExcessPeers()

		if m.cfg.AutoConnect {
			m.maintainPeerConnections()
		}

		m.mu.Lock()
		ready := m.connectedCountLocked() >= m.cfg.MinPeers
		m.mu.Unlock()
		if ready {
			m.fireMeshReady()
		}
	})

	sig.OnRTCDisconnected(func(id string) {
		id = normID(id)
		if id == "" {
			return
		}
		m.mu.Lock()
		if m.isSelfAliasLocked(id) {
			m.mu.Unlock()
			return
		}
		// clean up rebalance state
		delete(m.pendingRebalanceDrop, id)
		for k, v := range m.pendingRebalanceDrop {
			if v == id {
				delete(m.pendingRebalanceDrop, k)
			}
		}
		pc := m.peers[id]
		wasConnected := false
		if pc != nil {
			wasConnected = pc.connected
			if t := m.connTimers[id]; t != nil {
				t.Stop()
				delete(m.connTimers, id)
			}
			delete(m.connStartedAt, id)
			delete(m.peers, id)
			delete(m.peerConnectedAt, id)
			delete(m.connecting, id)
		}
		m.mu.Unlock()

		if wasConnected {
			m.firePeerDisconnected(id)
		}
		if m.cfg.AutoConnect {
			m.maintainPeerConnections()
		}
	})

	sig.OnRTCData(func(e signaling.RTCDataEvent) {
		if mbr := tryParseMembership(e.Data); mbr != nil {
			m.mergeMembership(mbr, e.PeerID)
		} else {
			m.firePeerData(e.PeerID, e.Data)
		}
	})

	sig.Connect()
}

// GetClientID returns this peer's local ID (empty until signaling connects).
func (m *Mesh) GetClientID() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.clientID
}

// GetConnectedPeers returns the IDs of all currently connected peers.
func (m *Mesh) GetConnectedPeers() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.connectedPeersLocked()
}

// GetDiscoveredPeers returns all discovered (but not necessarily connected) peer IDs.
func (m *Mesh) GetDiscoveredPeers() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.discoveredPeers))
	for id := range m.discoveredPeers {
		out = append(out, id)
	}
	return out
}

// GetGlobalPeers returns the converged global peer set from membership gossip.
func (m *Mesh) GetGlobalPeers() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.globalPeers))
	for id := range m.globalPeers {
		out = append(out, id)
	}
	return out
}

// Send sends data to a specific connected peer.
func (m *Mesh) Send(peerID string, data []byte) error {
	m.mu.Lock()
	sig := m.sig
	pc := m.peers[peerID]
	m.mu.Unlock()
	if pc == nil || !pc.connected || sig == nil {
		return fmt.Errorf("mesh: peer %s not connected", peerID)
	}
	return sig.Send(peerID, data)
}

// Broadcast sends data to all connected peers.
func (m *Mesh) Broadcast(data []byte) {
	m.mu.Lock()
	sig := m.sig
	m.mu.Unlock()
	if sig != nil {
		sig.Broadcast(data)
	}
}

// ConnectToPeer initiates a connection to a specific peer.
func (m *Mesh) ConnectToPeer(peerID string) {
	m.connectToPeerInternal(peerID, false)
}

// DisconnectFromPeer closes the connection to a specific peer.
func (m *Mesh) DisconnectFromPeer(peerID string) {
	m.disconnectFromPeer(normID(peerID))
}

// HardReset tears down all peer connections while keeping signaling alive.
func (m *Mesh) HardReset(reason string) {
	m.mu.Lock()
	m.lastHardReset = nowMs()
	m.underConnectedSince = 0
	for _, t := range m.connTimers {
		t.Stop()
	}
	m.connTimers = make(map[string]*time.Timer)
	m.connStartedAt = make(map[string]int64)
	m.peerConnectedAt = make(map[string]int64)
	m.pendingRebalanceDrop = make(map[string]string)
	peerIDs := make([]string, 0, len(m.peers))
	for id := range m.peers {
		peerIDs = append(peerIDs, id)
	}
	sig := m.sig
	m.mu.Unlock()

	for _, id := range peerIDs {
		if sig != nil {
			sig.CloseConnection(id)
		}
	}

	m.mu.Lock()
	m.peers = make(map[string]*peerConn)
	m.connecting = make(map[string]struct{})
	m.mu.Unlock()

	if sig != nil {
		sig.JoinSession(m.cfg.SessionID)
	}
	if m.cfg.AutoConnect {
		m.maintainPeerConnections()
	}
	log.Printf("[PartialMesh] hardReset(%s) clientID=%s discovered=%d", reason, m.GetClientID(), len(m.GetDiscoveredPeers()))
}

// Destroy disconnects all peers and closes the signaling connection.
func (m *Mesh) Destroy() {
	m.mu.Lock()
	if m.maintenanceTicker != nil {
		m.maintenanceTicker.Stop()
		m.maintenanceTicker = nil
		select {
		case <-m.maintenanceDone:
		default:
			close(m.maintenanceDone)
		}
	}
	for _, t := range m.connTimers {
		t.Stop()
	}
	peerIDs := make([]string, 0, len(m.peers))
	for id := range m.peers {
		peerIDs = append(peerIDs, id)
	}
	sig := m.sig
	m.sig = nil
	m.mu.Unlock()

	for _, id := range peerIDs {
		if sig != nil {
			sig.CloseConnection(id)
		}
	}

	m.mu.Lock()
	m.peers = make(map[string]*peerConn)
	m.connecting = make(map[string]struct{})
	m.discoveredPeers = make(map[string]struct{})
	m.clientID = ""
	m.underConnectedSince = 0
	m.mu.Unlock()

	if sig != nil {
		sig.Disconnect()
	}
}

// ── maintenance ────────────────────────────────────────────────────────────

func (m *Mesh) startMaintenanceLoop() {
	m.mu.Lock()
	if m.maintenanceTicker != nil || m.cfg.MaintenanceIntervalMs <= 0 {
		m.mu.Unlock()
		return
	}
	ticker := time.NewTicker(time.Duration(m.cfg.MaintenanceIntervalMs) * time.Millisecond)
	m.maintenanceTicker = ticker
	done := m.maintenanceDone
	m.mu.Unlock()

	go func() {
		for {
			select {
			case <-ticker.C:
				m.maybeRefreshDiscovery()
				m.maybeRecoverStalledNegotiations()
				m.maintainPeerConnections()
				m.maybeHardResetUnderConnected()
			case <-done:
				return
			}
		}
	}()
}

func (m *Mesh) maintainPeerConnections() {
	now := nowMs()
	m.mu.Lock()
	connCount := m.connectedCountLocked()
	pendingCount := m.pendingCountLocked()
	emergencyIsolated := connCount == 0 && len(m.discoveredPeers) > 0
	totalInProgress := connCount + pendingCount

	var allCandidates []string
	for id := range m.discoveredPeers {
		if m.isSelfAliasLocked(id) {
			continue
		}
		if _, hasPeer := m.peers[id]; hasPeer {
			continue
		}
		if _, connecting := m.connecting[id]; connecting {
			continue
		}
		allCandidates = append(allCandidates, id)
	}
	var available []string
	for _, id := range allCandidates {
		until := m.dialBackoffUntil[id]
		if emergencyIsolated || until <= now {
			available = append(available, id)
		}
	}
	selfID := m.clientID
	m.mu.Unlock()

	pickCandidates := func(count int) []string {
		source := available
		if len(source) == 0 {
			source = allCandidates
		}
		if len(source) == 0 || count <= 0 {
			return nil
		}
		// Sort by failure count then ID for deterministic rotation
		m.mu.Lock()
		sorted := make([]string, len(source))
		copy(sorted, source)
		sort.Slice(sorted, func(i, j int) bool {
			fi, fj := m.dialFailures[sorted[i]], m.dialFailures[sorted[j]]
			if fi != fj {
				return fi < fj
			}
			return sorted[i] < sorted[j]
		})
		m.mu.Unlock()

		offset := 0
		if selfID != "" {
			var h uint32
			for _, c := range selfID {
				h = h*31 + uint32(c)
			}
			if len(sorted) > 0 {
				offset = int(h) % len(sorted)
			}
		}
		var selected []string
		max := count
		if max > len(sorted) {
			max = len(sorted)
		}
		for i := 0; i < max; i++ {
			selected = append(selected, sorted[(offset+i)%len(sorted)])
		}
		return selected
	}

	maxTolerant := m.cfg.MaxPeers + m.cfg.TolerantPeers

	if totalInProgress < m.cfg.MinPeers {
		needed := m.cfg.MinPeers - totalInProgress
		dialCount := needed
		if emergencyIsolated {
			burst := len(available)
			if burst > 3 {
				burst = 3
			}
			if burst < 2 {
				burst = 2
			}
			if burst > dialCount {
				dialCount = burst
			}
		}
		for _, id := range pickCandidates(dialCount) {
			m.connectToPeer(id)
		}
	} else if totalInProgress < m.cfg.MaxPeers && len(available) > 0 {
		if now >= m.rebalanceCooldownUntil {
			for _, id := range pickCandidates(1) {
				m.connectToPeer(id)
			}
		}
	} else if connCount > maxTolerant {
		m.trimExcessPeers()
	} else if connCount >= m.cfg.MaxPeers && pendingCount == 0 && len(available) > 0 {
		m.maybeRebalance(available)
	}
}

func (m *Mesh) maybeRefreshDiscovery() {
	if !m.cfg.AutoDiscover {
		return
	}
	now := nowMs()
	m.mu.Lock()
	conn := m.connectedCountLocked()
	disc := len(m.discoveredPeers)
	last := m.lastDiscoveryRefresh
	sig := m.sig
	m.mu.Unlock()

	underConn := conn < m.cfg.MinPeers
	fewCandidates := disc < m.cfg.MinPeers
	if !underConn && !fewCandidates {
		return
	}
	if now-last < 2_000 {
		return
	}
	m.mu.Lock()
	m.lastDiscoveryRefresh = now
	m.mu.Unlock()
	if sig != nil {
		sig.JoinSession(m.cfg.SessionID)
	}
}

func (m *Mesh) maybeRecoverStalledNegotiations() {
	now := nowMs()
	m.mu.Lock()
	connCount := m.connectedCountLocked()
	isolated := connCount == 0 && len(m.discoveredPeers) > 0
	baseStall := int64(m.cfg.ConnectionTimeoutMs)
	if baseStall > 15_000 {
		baseStall = 15_000
	}
	if baseStall < 10_000 {
		baseStall = 10_000
	}
	stallMs := baseStall
	if isolated {
		stallMs = int64(m.cfg.ConnectionTimeoutMs)
		if stallMs > 6_000 {
			stallMs = 6_000
		}
		if stallMs < 3_500 {
			stallMs = 3_500
		}
	}

	var stalledID string
	for id, pc := range m.peers {
		if pc.connected {
			continue
		}
		startedAt := m.connStartedAt[id]
		age := now - startedAt
		if age < stallMs {
			continue
		}
		stalledID = id
		break
	}
	m.mu.Unlock()

	if stalledID == "" {
		return
	}

	m.mu.Lock()
	m.noteDialFailureLocked(stalledID)
	m.mu.Unlock()
	m.firePeerError(stalledID, fmt.Errorf("negotiation stalled"))
	m.removePeer(stalledID, false)

	if isolated {
		m.mu.Lock()
		m.clearDialBackoffLocked(stalledID)
		_, isDisc := m.discoveredPeers[stalledID]
		m.mu.Unlock()
		if isDisc {
			m.connectToPeerInternal(stalledID, true)
		}
	}
}

func (m *Mesh) maybeHardResetUnderConnected() {
	threshMs := int64(m.cfg.UnderConnectedResetMs)
	if threshMs <= 0 {
		return
	}
	now := nowMs()

	m.mu.Lock()
	conn := m.connectedCountLocked()
	pending := m.pendingCountLocked()
	disc := len(m.discoveredPeers)
	hasEnough := disc >= m.cfg.MinPeers
	hasAny := disc > 0
	underConn := conn < m.cfg.MinPeers && hasEnough
	isolated := conn == 0 && hasAny
	isolatedThresh := threshMs
	if isolatedThresh > 8_000 {
		isolatedThresh = 8_000
	}
	if isolatedThresh < 3_500 {
		isolatedThresh = 3_500
	}
	var oldestPending int64
	for id := range m.connecting {
		startedAt := m.connStartedAt[id]
		age := now - startedAt
		if age > oldestPending {
			oldestPending = age
		}
	}
	hasStalePending := pending > 0 && oldestPending >= isolatedThresh
	hasRepeatedFails := false
	for id := range m.discoveredPeers {
		if m.dialFailures[id] >= 3 {
			hasRepeatedFails = true
			break
		}
	}
	lastReset := m.lastHardReset
	underSince := m.underConnectedSince
	m.mu.Unlock()

	if !underConn && !isolated {
		m.mu.Lock()
		m.underConnectedSince = 0
		m.mu.Unlock()
		return
	}

	if isolated && (hasStalePending || hasRepeatedFails) {
		if now-lastReset < isolatedThresh {
			return
		}
		m.HardReset("isolated-stalled")
		return
	}

	if pending > 0 {
		if oldestPending < threshMs {
			m.mu.Lock()
			m.underConnectedSince = 0
			m.mu.Unlock()
			return
		}
	}

	if underSince == 0 {
		m.mu.Lock()
		m.underConnectedSince = now
		m.mu.Unlock()
		return
	}
	if now-underSince < threshMs {
		return
	}
	if now-lastReset < threshMs {
		return
	}
	m.HardReset("under-connected")
}

// ── connection management ──────────────────────────────────────────────────

func (m *Mesh) connectToPeer(peerID string) {
	m.connectToPeerInternal(peerID, false)
}

func (m *Mesh) connectToPeerInternal(peerID string, allowOverflow bool) {
	m.mu.Lock()
	selfID := m.clientID
	normPeer := normID(peerID)

	if !m.isSignalingConnectedLocked() {
		sig := m.sig
		m.mu.Unlock()
		if sig != nil {
			sig.Connect()
		}
		return
	}
	if selfID == "" {
		m.mu.Unlock()
		return
	}
	if normPeer == "" || m.isSelfAliasLocked(normPeer) || normPeer == selfID {
		m.mu.Unlock()
		return
	}
	if _, hasPeer := m.peers[normPeer]; hasPeer {
		m.mu.Unlock()
		return
	}
	if _, connecting := m.connecting[normPeer]; connecting {
		m.mu.Unlock()
		return
	}

	now := nowMs()
	connCount := m.connectedCountLocked()
	emergencyIsolated := connCount == 0 && len(m.discoveredPeers) > 0

	if !emergencyIsolated {
		if until := m.dialBackoffUntil[normPeer]; until > now {
			m.mu.Unlock()
			return
		}
	} else {
		delete(m.dialBackoffUntil, normPeer)
	}

	maxAllowed := m.cfg.MaxPeers + m.cfg.TolerantPeers
	if allowOverflow {
		maxAllowed = m.cfg.MaxPeers + 1
	}
	if connCount >= maxAllowed {
		m.mu.Unlock()
		return
	}

	initiator := selfID < normPeer

	if !initiator {
		sig := m.sig
		m.mu.Unlock()
		if sig != nil {
			sig.NudgeSignaling()
		}

		fallbackMs := m.cfg.NonInitiatorFallbackMs
		if fallbackMs <= 0 {
			return
		}

		m.mu.Lock()
		if _, exists := m.nonInitFallbackTimers[normPeer]; exists {
			m.mu.Unlock()
			return
		}

		// Check if there's a natural initiator target
		var candidates []string
		for id := range m.discoveredPeers {
			nid := normID(id)
			if nid == "" || m.isSelfAliasLocked(nid) || nid == selfID {
				continue
			}
			if _, hasPeer := m.peers[nid]; hasPeer {
				continue
			}
			if _, connecting := m.connecting[nid]; connecting {
				continue
			}
			if until := m.dialBackoffUntil[nid]; until > now {
				continue
			}
			candidates = append(candidates, nid)
		}

		hasNaturalInitTarget := false
		for _, id := range candidates {
			if selfID < id {
				hasNaturalInitTarget = true
				break
			}
		}
		if hasNaturalInitTarget {
			m.mu.Unlock()
			return
		}

		var fallbackTargets []string
		for _, id := range candidates {
			if selfID > id {
				fallbackTargets = append(fallbackTargets, id)
			}
		}
		if len(fallbackTargets) == 0 {
			m.mu.Unlock()
			return
		}
		sort.Strings(fallbackTargets)

		var h uint32
		for _, c := range selfID {
			h = h*31 + uint32(c)
		}
		selected := fallbackTargets[int(h)%len(fallbackTargets)]
		if selected != normPeer {
			m.mu.Unlock()
			return
		}

		t := time.AfterFunc(time.Duration(fallbackMs)*time.Millisecond, func() {
			m.mu.Lock()
			delete(m.nonInitFallbackTimers, normPeer)
			if _, hasPeer := m.peers[normPeer]; hasPeer {
				m.mu.Unlock()
				return
			}
			if _, connecting := m.connecting[normPeer]; connecting {
				m.mu.Unlock()
				return
			}
			if m.connectedCountLocked() >= m.cfg.MaxPeers {
				m.mu.Unlock()
				return
			}
			m.connecting[normPeer] = struct{}{}
			m.mu.Unlock()
			m.createPeerConnection(normPeer, true)
		})
		m.nonInitFallbackTimers[normPeer] = t
		m.mu.Unlock()
		return
	}

	m.connecting[normPeer] = struct{}{}
	m.mu.Unlock()
	m.createPeerConnection(normPeer, initiator)
}

func (m *Mesh) createPeerConnection(peerID string, initiator bool) {
	m.mu.Lock()
	// Set up connection timeout
	if t := m.connTimers[peerID]; t != nil {
		t.Stop()
	}
	timer := time.AfterFunc(time.Duration(m.cfg.ConnectionTimeoutMs)*time.Millisecond, func() {
		m.mu.Lock()
		pc := m.peers[peerID]
		if pc == nil || pc.connected {
			m.mu.Unlock()
			return
		}
		delete(m.connecting, peerID)
		delete(m.connStartedAt, peerID)
		m.noteDialFailureLocked(peerID)
		m.mu.Unlock()
		m.firePeerError(peerID, fmt.Errorf("connection timeout"))
		m.removePeer(peerID, false)
	})
	m.connTimers[peerID] = timer
	m.connStartedAt[peerID] = nowMs()
	m.peers[peerID] = &peerConn{id: peerID, connected: false, initiator: initiator}
	sig := m.sig
	m.mu.Unlock()

	if initiator && sig != nil {
		sig.NudgeSignaling()
		sig.InitiateConnection(peerID)
	}
}

func (m *Mesh) disconnectFromPeer(peerID string) {
	peerID = normID(peerID)
	if peerID == "" {
		return
	}
	m.removePeer(peerID, false)
}

func (m *Mesh) removePeer(peerID string, forgetDiscovered bool) {
	m.mu.Lock()
	delete(m.pendingRebalanceDrop, peerID)
	for k, v := range m.pendingRebalanceDrop {
		if v == peerID {
			delete(m.pendingRebalanceDrop, k)
		}
	}

	if t := m.nonInitFallbackTimers[peerID]; t != nil {
		t.Stop()
		delete(m.nonInitFallbackTimers, peerID)
	}

	pc := m.peers[peerID]
	wasConnected := false
	if pc != nil {
		wasConnected = pc.connected
		if t := m.connTimers[peerID]; t != nil {
			t.Stop()
			delete(m.connTimers, peerID)
		}
		delete(m.connStartedAt, peerID)
		delete(m.peers, peerID)
		delete(m.peerConnectedAt, peerID)
		delete(m.connecting, peerID)
	}
	if forgetDiscovered {
		delete(m.discoveredPeers, peerID)
	}
	sig := m.sig
	m.mu.Unlock()

	if sig != nil {
		sig.CloseConnection(peerID)
	}

	if wasConnected {
		m.firePeerDisconnected(peerID)
	}
	if m.cfg.AutoConnect {
		m.maintainPeerConnections()
	}
}

func (m *Mesh) trimExcessPeers() {
	m.mu.Lock()
	connected := m.connectedPeersLocked()
	overflow := len(connected) - (m.cfg.MaxPeers + m.cfg.TolerantPeers)
	if overflow <= 0 {
		m.mu.Unlock()
		return
	}
	m.rebalanceCooldownUntil = nowMs() + 2_000

	type entry struct {
		id          string
		connectedAt int64
	}
	var entries []entry
	for _, id := range connected {
		entries = append(entries, entry{id, m.peerConnectedAt[id]})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].connectedAt != entries[j].connectedAt {
			return entries[i].connectedAt > entries[j].connectedAt // newest first
		}
		return entries[i].id > entries[j].id
	})

	var toDrop []string
	for i := 0; i < overflow; i++ {
		toDrop = append(toDrop, entries[i].id)
		m.dialBackoffUntil[entries[i].id] = nowMs() + 5_000
	}
	m.mu.Unlock()

	for _, id := range toDrop {
		m.disconnectFromPeer(id)
	}
}

func (m *Mesh) maybeRebalance(candidates []string) bool {
	m.mu.Lock()
	selfID := m.clientID
	if selfID == "" {
		m.mu.Unlock()
		return false
	}
	now := nowMs()
	if now < m.rebalanceCooldownUntil || len(m.pendingRebalanceDrop) > 0 {
		m.mu.Unlock()
		return false
	}

	connected := m.connectedPeersLocked()
	if len(connected) <= m.cfg.MinPeers || len(candidates) == 0 {
		m.mu.Unlock()
		return false
	}

	type peerDist struct {
		id          string
		dist        *big.Int
		connectedAt int64
	}
	var connByDist []peerDist
	for _, id := range connected {
		d := xorDistance(selfID, id)
		connByDist = append(connByDist, peerDist{id, d, m.peerConnectedAt[id]})
	}
	sort.Slice(connByDist, func(i, j int) bool {
		cmp := connByDist[i].dist.Cmp(connByDist[j].dist)
		if cmp != 0 {
			return cmp < 0
		}
		return connByDist[i].id < connByDist[j].id
	})

	type candDist struct {
		id          string
		dist        *big.Int
		discoveredAt int64
		lastAttempt  int64
	}
	var candByDist []candDist
	for _, id := range candidates {
		d := xorDistance(selfID, id)
		candByDist = append(candByDist, candDist{id, d, m.discoveredAt[id], m.rebalanceAttemptAt[id]})
	}
	sort.Slice(candByDist, func(i, j int) bool {
		cmp := candByDist[i].dist.Cmp(candByDist[j].dist)
		if cmp != 0 {
			return cmp < 0
		}
		return candByDist[i].id < candByDist[j].id
	})

	farthest := connByDist[len(connByDist)-1]
	var closest *candDist
	for i := range candByDist {
		discAge := now - candByDist[i].discoveredAt
		attemptAge := now - candByDist[i].lastAttempt
		if discAge >= 2_000 && attemptAge >= 20_000 {
			closest = &candByDist[i]
			break
		}
	}

	if closest == nil {
		m.mu.Unlock()
		return false
	}

	connAge := now - farthest.connectedAt
	if connAge < 12_000 {
		m.mu.Unlock()
		return false
	}

	// Require candidate to be 25% closer
	// closest.dist * 4 >= farthest.dist * 3 means NOT close enough
	lhs := new(big.Int).Mul(closest.dist, big.NewInt(4))
	rhs := new(big.Int).Mul(farthest.dist, big.NewInt(3))
	if lhs.Cmp(rhs) >= 0 {
		m.mu.Unlock()
		return false
	}

	// Safety: need ≥1 other discovered peer
	otherDisc := 0
	for id := range m.discoveredPeers {
		id = normID(id)
		if id != "" && id != selfID && id != farthest.id && id != closest.id {
			otherDisc++
		}
	}
	if otherDisc < 1 {
		m.mu.Unlock()
		return false
	}

	m.rebalanceCooldownUntil = now + 12_000
	m.rebalanceAttemptAt[closest.id] = now
	m.rebalanceAttemptAt[farthest.id] = now
	m.pendingRebalanceDrop[closest.id] = farthest.id
	m.mu.Unlock()

	m.fireSignalingLog(fmt.Sprintf("[rebalance] dial closer %s then drop %s", closest.id[:8], farthest.id[:8]))
	m.connectToPeerInternal(closest.id, true)
	return true
}

// ── membership gossip ──────────────────────────────────────────────────────

func (m *Mesh) sendMembership(toPeerID string) {
	m.mu.Lock()
	selfID := normID(m.clientID)
	all := make(map[string]struct{})
	for id := range m.globalPeers {
		all[id] = struct{}{}
	}
	if selfID != "" {
		all[selfID] = struct{}{}
	}
	for id := range m.discoveredPeers {
		all[id] = struct{}{}
	}
	peers := make([]string, 0, len(all))
	for id := range all {
		peers = append(peers, id)
	}
	sig := m.sig
	m.mu.Unlock()

	payload := map[string]interface{}{"__membership": true, "peers": peers}
	data, err := json.Marshal(payload)
	if err != nil || sig == nil {
		return
	}
	_ = sig.Send(toPeerID, data)
}

type membershipMsg struct {
	Membership bool     `json:"__membership"`
	Peers      []string `json:"peers"`
}

func tryParseMembership(data []byte) *membershipMsg {
	var msg membershipMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil
	}
	if !msg.Membership {
		return nil
	}
	return &msg
}

func (m *Mesh) mergeMembership(msg *membershipMsg, fromPeerID string) {
	m.mu.Lock()
	var changed bool
	for _, raw := range msg.Peers {
		id := normID(raw)
		if id == "" || m.isSelfAliasLocked(id) {
			continue
		}
		if _, has := m.globalPeers[id]; !has {
			m.globalPeers[id] = struct{}{}
			changed = true
			m.addDiscoveredLocked(id)
		}
	}
	var global []string
	for id := range m.globalPeers {
		global = append(global, id)
	}
	connPeers := m.connectedPeersLocked()
	m.mu.Unlock()

	if !changed {
		return
	}
	m.fireMeshMembership(global)
	for _, id := range connPeers {
		if id != fromPeerID {
			m.sendMembership(id)
		}
	}
	if m.cfg.AutoConnect {
		m.maintainPeerConnections()
	}
}

func (m *Mesh) removeFromGlobalLocked(peerID string) {
	if _, removed := m.globalPeers[peerID]; !removed {
		return
	}
	delete(m.globalPeers, peerID)
	var global []string
	for id := range m.globalPeers {
		global = append(global, id)
	}
	connPeers := m.connectedPeersLocked()

	go func() {
		m.fireMeshMembership(global)
		for _, id := range connPeers {
			if id != peerID {
				m.sendMembership(id)
			}
		}
	}()
}

// ── locked helpers ─────────────────────────────────────────────────────────

func (m *Mesh) connectedCountLocked() int {
	count := 0
	for _, pc := range m.peers {
		if pc.connected {
			count++
		}
	}
	return count
}

func (m *Mesh) connectedPeersLocked() []string {
	var out []string
	for id, pc := range m.peers {
		if pc.connected {
			out = append(out, id)
		}
	}
	return out
}

func (m *Mesh) pendingCountLocked() int {
	pending := make(map[string]struct{})
	for id := range m.connecting {
		pending[id] = struct{}{}
	}
	for id, pc := range m.peers {
		if !pc.connected {
			pending[id] = struct{}{}
		}
	}
	return len(pending)
}

func (m *Mesh) addSelfAliasLocked(id string) {
	id = normID(id)
	if id == "" {
		return
	}
	m.selfAliases[id] = struct{}{}
	delete(m.discoveredPeers, id)
	delete(m.globalPeers, id)
}

func (m *Mesh) isSelfAliasLocked(id string) bool {
	_, ok := m.selfAliases[id]
	return ok
}

func (m *Mesh) addDiscoveredLocked(id string) {
	id = normID(id)
	if id == "" || m.isSelfAliasLocked(id) {
		return
	}
	if _, has := m.discoveredPeers[id]; has {
		return
	}
	m.discoveredPeers[id] = struct{}{}
	m.discoveredAt[id] = nowMs()
	go m.firePeerDiscovered(id)
}

func (m *Mesh) noteDialFailureLocked(peerID string) {
	failures := m.dialFailures[peerID] + 1
	m.dialFailures[peerID] = failures
	backoff := int64(1_000) << min(failures, 5)
	if backoff > 30_000 {
		backoff = 30_000
	}
	m.dialBackoffUntil[peerID] = nowMs() + backoff
}

func (m *Mesh) clearDialBackoffLocked(peerID string) {
	delete(m.dialBackoffUntil, peerID)
}

func (m *Mesh) isSignalingConnectedLocked() bool {
	return m.sig != nil && m.sig.IsConnected()
}

// ── event fires ────────────────────────────────────────────────────────────

func (m *Mesh) fireSignalingConnected(id string) {
	m.mu.Lock(); cbs := append(([]func(string))(nil), m.onSignalingConnected...); m.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(id) }) }
}
func (m *Mesh) fireSignalingDisconnected() {
	m.mu.Lock(); cbs := append(([]func())(nil), m.onSignalingDisconnected...); m.mu.Unlock()
	for _, fn := range cbs { safeCall(fn) }
}
func (m *Mesh) fireSignalingError(err error) {
	m.mu.Lock(); cbs := append(([]func(error))(nil), m.onSignalingError...); m.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(err) }) }
}
func (m *Mesh) fireSignalingLog(msg string) {
	m.mu.Lock(); cbs := append(([]func(string))(nil), m.onSignalingLog...); m.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(msg) }) }
}
func (m *Mesh) firePeerConnected(id string) {
	m.mu.Lock(); cbs := append(([]func(string))(nil), m.onPeerConnected...); m.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(id) }) }
}
func (m *Mesh) firePeerDisconnected(id string) {
	m.mu.Lock(); cbs := append(([]func(string))(nil), m.onPeerDisconnected...); m.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(id) }) }
}
func (m *Mesh) firePeerData(id string, data []byte) {
	m.mu.Lock(); cbs := append(([]func(string, []byte))(nil), m.onPeerData...); m.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(id, data) }) }
}
func (m *Mesh) firePeerError(id string, err error) {
	m.mu.Lock(); cbs := append(([]func(string, error))(nil), m.onPeerError...); m.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(id, err) }) }
}
func (m *Mesh) firePeerDiscovered(id string) {
	m.mu.Lock(); cbs := append(([]func(string))(nil), m.onPeerDiscovered...); m.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(id) }) }
}
func (m *Mesh) fireMeshReady() {
	m.mu.Lock(); cbs := append(([]func())(nil), m.onMeshReady...); m.mu.Unlock()
	for _, fn := range cbs { safeCall(fn) }
}
func (m *Mesh) fireMeshMembership(peers []string) {
	m.mu.Lock(); cbs := append(([]func([]string))(nil), m.onMeshMembership...); m.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(peers) }) }
}

// ── utilities ──────────────────────────────────────────────────────────────

var hexRe = regexp.MustCompile(`^[0-9a-fA-F]+$`)

func xorDistance(a, b string) *big.Int {
	a = strings.ToLower(strings.TrimSpace(a))
	b = strings.ToLower(strings.TrimSpace(b))
	if hexRe.MatchString(a) && hexRe.MatchString(b) {
		ai := new(big.Int)
		bi := new(big.Int)
		if _, ok1 := ai.SetString(a, 16); ok1 {
			if _, ok2 := bi.SetString(b, 16); ok2 {
				return new(big.Int).Xor(ai, bi)
			}
		}
	}
	// Fallback: hash-based distance
	ha, hb := hashID(a), hashID(b)
	return big.NewInt(int64(ha ^ hb))
}

func hashID(s string) uint32 {
	var h uint32 = 2166136261
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= 16777619
	}
	return h
}

func nowMs() int64 { return time.Now().UnixMilli() }

func normID(s string) string { return strings.TrimSpace(s) }

func normalizeWSURL(raw string) string {
	u := raw
	if strings.HasPrefix(u, "https://") {
		u = "wss://" + u[8:]
	} else if strings.HasPrefix(u, "http://") {
		u = "ws://" + u[7:]
	}
	return u
}

func generateHexID(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("mesh: rand.Read: %v", err))
	}
	return hex.EncodeToString(b)
}

func safeCall(fn func()) {
	defer func() { recover() }() //nolint:errcheck
	fn()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
