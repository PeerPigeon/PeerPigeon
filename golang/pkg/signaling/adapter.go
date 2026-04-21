// Package signaling implements the FreeRTC WebSocket signaling adapter.
// It is a faithful Go port of src/freertc-client-adapter.ts.
package signaling

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/peerpigeon/peerpigeon-go/pkg/rtcpeer"
	"github.com/pion/webrtc/v3"
)

// ── PSP wire types ─────────────────────────────────────────────────────────

type pspEnvelope struct {
	PSPVersion string      `json:"psp_version"`
	Type       string      `json:"type"`
	Network    string      `json:"network"`
	From       string      `json:"from"`
	To         interface{} `json:"to"`
	SessionID  interface{} `json:"session_id"`
	MessageID  string      `json:"message_id"`
	Timestamp  int64       `json:"timestamp"`
	TTLMS      interface{} `json:"ttl_ms"`
	Body       interface{} `json:"body"`
}

type peerListBody struct {
	Peers []struct {
		PeerID string `json:"peer_id"`
	} `json:"peers"`
}

type sdpBody struct {
	SDP        string `json:"sdp"`
	TrickleICE bool   `json:"trickle_ice"`
}

type candidateBody struct {
	Candidate interface{} `json:"candidate"`
}

// ── peer entry ─────────────────────────────────────────────────────────────

type peerEntry struct {
	peer       *rtcpeer.RtcPeer
	initiator  bool
	trickleICE bool
	connected  bool
}

// ── events ─────────────────────────────────────────────────────────────────

// ConnectedEvent is emitted when the local client has connected to the
// signaling server and received its assigned peer ID.
type ConnectedEvent struct {
	ClientID          string
	RequestedClientID string
	PreviousClientID  string
}

// JoinedEvent is emitted on the first peer_list response.
type JoinedEvent struct {
	SessionID string
	Clients   []string
}

// RTCDataEvent carries data received over a WebRTC data channel.
type RTCDataEvent struct {
	PeerID string
	Data   []byte
}

// Adapter is a Go port of FreeRTCClientAdapter.
// It manages a WebSocket connection to a FreeRTC signaling server and
// coordinates WebRTC peer connections through it.
type Adapter struct {
	signalURL  string
	networkID  string
	peerID     string // requested / stable local peer ID
	iceServers []webrtc.ICEServer
	trickleICE bool

	mu            sync.Mutex
	socket        *websocket.Conn
	writeMu       sync.Mutex // serialise WebSocket writes
	peerEntries   map[string]*peerEntry
	knownPeers    map[string]struct{}
	pendingCands  map[string][]rtcpeer.Signal // buffered before remote desc set
	offerMu       map[string]*sync.Mutex      // per-peer serialisation
	lastOfferSDP  map[string]string
	lastAnswerSDP map[string]string
	selfAliases   map[string]struct{}

	joinedOnce     bool
	reconnectDelay time.Duration
	reconnectTimer *time.Timer
	pingTicker     *time.Ticker
	pingStop       chan struct{}
	announceTicker *time.Ticker
	announceStop   chan struct{}

	intentional atomic.Bool
	closed      atomic.Bool

	// event callbacks
	onConnected       []func(ConnectedEvent)
	onJoined          []func(JoinedEvent)
	onPeerJoined      []func(string)
	onPeerLeft        []func(string)
	onRTCConnected    []func(string)
	onRTCDisconnected []func(string)
	onRTCData         []func(RTCDataEvent)
	onError           []func(error)
	onSignalingLog    []func(string)
}

// New creates a new Adapter.
// peerID is the stable local identity (pass empty string to auto-generate).
func New(signalURL, networkID string, peerID string, iceServers []webrtc.ICEServer, trickleICE bool) *Adapter {
	if peerID == "" {
		peerID = generatePeerID()
	}
	a := &Adapter{
		signalURL:      signalURL,
		networkID:      networkID,
		peerID:         peerID,
		iceServers:     iceServers,
		trickleICE:     trickleICE,
		peerEntries:    make(map[string]*peerEntry),
		knownPeers:     make(map[string]struct{}),
		pendingCands:   make(map[string][]rtcpeer.Signal),
		offerMu:        make(map[string]*sync.Mutex),
		lastOfferSDP:   make(map[string]string),
		lastAnswerSDP:  make(map[string]string),
		selfAliases:    make(map[string]struct{}),
		reconnectDelay: time.Second,
	}
	a.addSelfAlias(peerID)
	return a
}

// ── event registration ─────────────────────────────────────────────────────

func (a *Adapter) OnConnected(fn func(ConnectedEvent)) {
	a.mu.Lock()
	a.onConnected = append(a.onConnected, fn)
	a.mu.Unlock()
}
func (a *Adapter) OnJoined(fn func(JoinedEvent)) {
	a.mu.Lock()
	a.onJoined = append(a.onJoined, fn)
	a.mu.Unlock()
}
func (a *Adapter) OnPeerJoined(fn func(string)) {
	a.mu.Lock()
	a.onPeerJoined = append(a.onPeerJoined, fn)
	a.mu.Unlock()
}
func (a *Adapter) OnPeerLeft(fn func(string)) {
	a.mu.Lock()
	a.onPeerLeft = append(a.onPeerLeft, fn)
	a.mu.Unlock()
}
func (a *Adapter) OnRTCConnected(fn func(string)) {
	a.mu.Lock()
	a.onRTCConnected = append(a.onRTCConnected, fn)
	a.mu.Unlock()
}
func (a *Adapter) OnRTCDisconnected(fn func(string)) {
	a.mu.Lock()
	a.onRTCDisconnected = append(a.onRTCDisconnected, fn)
	a.mu.Unlock()
}
func (a *Adapter) OnRTCData(fn func(RTCDataEvent)) {
	a.mu.Lock()
	a.onRTCData = append(a.onRTCData, fn)
	a.mu.Unlock()
}
func (a *Adapter) OnError(fn func(error)) {
	a.mu.Lock()
	a.onError = append(a.onError, fn)
	a.mu.Unlock()
}
func (a *Adapter) OnSignalingLog(fn func(string)) {
	a.mu.Lock()
	a.onSignalingLog = append(a.onSignalingLog, fn)
	a.mu.Unlock()
}

// ── public API ─────────────────────────────────────────────────────────────

// PeerID returns this adapter's stable local peer ID.
func (a *Adapter) PeerID() string { return a.peerID }

// Connect opens the WebSocket connection to the signaling server.
func (a *Adapter) Connect() {
	a.intentional.Store(false)
	a.mu.Lock()
	if a.reconnectTimer != nil {
		a.reconnectTimer.Stop()
		a.reconnectTimer = nil
	}
	if a.socket != nil {
		a.mu.Unlock()
		return
	}
	a.mu.Unlock()
	go a.dial()
}

// Disconnect closes the WebSocket connection and all WebRTC peers.
func (a *Adapter) Disconnect() {
	a.intentional.Store(true)
	a.mu.Lock()
	if a.reconnectTimer != nil {
		a.reconnectTimer.Stop()
		a.reconnectTimer = nil
	}
	a.mu.Unlock()
	a.sendEnvelope("withdraw", nil, "", nil, nil)
	a.stopLoops()
	a.mu.Lock()
	sock := a.socket
	a.socket = nil
	a.mu.Unlock()
	if sock != nil {
		_ = sock.Close()
	}
	a.closeAllPeers()
	a.mu.Lock()
	a.joinedOnce = false
	a.knownPeers = make(map[string]struct{})
	a.mu.Unlock()
}

// IsConnected returns true if the WebSocket is currently open.
func (a *Adapter) IsConnected() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.socket != nil
}

// JoinSession sends a discover message for the given session.
func (a *Adapter) JoinSession(sessionID string) {
	if sessionID != "" && sessionID != a.networkID {
		a.fireError(fmt.Errorf("signaling: cannot change networkID after init"))
		return
	}
	a.sendEnvelope("discover", map[string]interface{}{
		"exclude_peers": []string{},
		"limit":         50,
	}, "", nil, nil)
}

// NudgeSignaling sends an announce to refresh peer discovery.
func (a *Adapter) NudgeSignaling() {
	a.sendEnvelope("announce", map[string]interface{}{"hints": map[string]interface{}{"wants_peers": true}},
		"", nil, int64Ptr(30_000))
	a.JoinSession(a.networkID)
}

// InitiateConnection starts a WebRTC connection to the given peer.
func (a *Adapter) InitiateConnection(peerID string) {
	a.mu.Lock()
	if !a.isConnectedLocked() {
		a.mu.Unlock()
		a.fireError(fmt.Errorf("signaling: not connected to signaling server"))
		return
	}
	a.mu.Unlock()

	a.CloseConnection(peerID)
	peer, err := rtcpeer.New(rtcpeer.Options{
		Initiator:  true,
		TrickleICE: a.trickleICE,
		Config:     a.buildRTCConfig(),
	})
	if err != nil {
		a.fireError(fmt.Errorf("signaling: create peer for %s: %w", peerID, err))
		return
	}
	a.attachPeer(peerID, peer, true)
}

// CloseConnection tears down the WebRTC connection to a specific peer.
func (a *Adapter) CloseConnection(peerID string) {
	a.mu.Lock()
	entry, ok := a.peerEntries[peerID]
	if ok {
		delete(a.peerEntries, peerID)
		delete(a.pendingCands, peerID)
		delete(a.lastOfferSDP, peerID)
		delete(a.lastAnswerSDP, peerID)
	}
	a.mu.Unlock()
	if ok && entry.peer != nil {
		entry.peer.Destroy()
	}
}

// Send sends data to a connected peer.
func (a *Adapter) Send(peerID string, data []byte) error {
	a.mu.Lock()
	entry := a.peerEntries[peerID]
	a.mu.Unlock()
	if entry == nil || !entry.connected {
		return fmt.Errorf("signaling: peer %s not connected", peerID)
	}
	return entry.peer.Send(data)
}

// Broadcast sends data to every currently connected peer.
func (a *Adapter) Broadcast(data []byte) {
	a.mu.Lock()
	var entries []*peerEntry
	for _, e := range a.peerEntries {
		if e.connected {
			entries = append(entries, e)
		}
	}
	a.mu.Unlock()
	for _, e := range entries {
		_ = e.peer.Send(data)
	}
}

// ── internal: dialing & loops ──────────────────────────────────────────────

func (a *Adapter) dial() {
	rawURL := a.signalURL
	u, err := url.Parse(rawURL)
	if err != nil {
		a.fireError(fmt.Errorf("signaling: invalid URL %s: %w", rawURL, err))
		return
	}
	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else if u.Scheme == "http" {
		u.Scheme = "ws"
	}
	q := u.Query()
	if q.Get("networkId") == "" {
		q.Set("networkId", a.networkID)
		u.RawQuery = q.Encode()
	}

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		a.log(fmt.Sprintf("[signal] dial error: %v", err))
		a.scheduleReconnect()
		return
	}

	a.mu.Lock()
	a.socket = conn
	a.reconnectDelay = time.Second
	a.mu.Unlock()

	a.log("[signal] connected")

	// announce + periodic loops
	a.sendEnvelope("announce", map[string]interface{}{"hints": map[string]interface{}{"wants_peers": true}},
		"", nil, int64Ptr(30_000))
	a.startPingLoop()
	a.startAnnounceLoop()

	// fire connected event
	a.fireConnected(ConnectedEvent{
		ClientID:          a.peerID,
		RequestedClientID: a.peerID,
	})

	// read loop
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		a.handleMessage(msg)
	}

	a.stopLoops()
	a.mu.Lock()
	a.socket = nil
	a.mu.Unlock()
	a.closeAllPeers()
	if !a.intentional.Load() {
		a.scheduleReconnect()
	}
}

func (a *Adapter) scheduleReconnect() {
	if a.intentional.Load() {
		return
	}
	a.mu.Lock()
	if a.reconnectTimer != nil {
		a.mu.Unlock()
		return
	}
	delay := a.reconnectDelay
	a.reconnectDelay = minDuration(15*time.Second, time.Duration(float64(a.reconnectDelay)*1.5))
	a.reconnectTimer = time.AfterFunc(delay, func() {
		a.mu.Lock()
		a.reconnectTimer = nil
		a.mu.Unlock()
		if !a.intentional.Load() {
			go a.dial()
		}
	})
	a.mu.Unlock()
}

func (a *Adapter) startPingLoop() {
	a.mu.Lock()
	if a.pingTicker != nil {
		a.mu.Unlock()
		return
	}
	ticker := time.NewTicker(time.Second)
	a.pingTicker = ticker
	stop := make(chan struct{})
	a.pingStop = stop
	a.mu.Unlock()

	go func() {
		for {
			select {
			case <-ticker.C:
				a.sendEnvelope("ping", map[string]interface{}{"nonce": generatePeerID()[:16]}, "", nil, nil)
			case <-stop:
				return
			}
		}
	}()
}

func (a *Adapter) startAnnounceLoop() {
	a.mu.Lock()
	if a.announceTicker != nil {
		a.mu.Unlock()
		return
	}
	ticker := time.NewTicker(12 * time.Second)
	a.announceTicker = ticker
	stop := make(chan struct{})
	a.announceStop = stop
	a.mu.Unlock()

	go func() {
		for {
			select {
			case <-ticker.C:
				a.sendEnvelope("announce", map[string]interface{}{"hints": map[string]interface{}{"wants_peers": true}},
					"", nil, int64Ptr(30_000))
			case <-stop:
				return
			}
		}
	}()
}

func (a *Adapter) stopLoops() {
	a.mu.Lock()
	if a.pingTicker != nil {
		a.pingTicker.Stop()
		a.pingTicker = nil
	}
	if a.pingStop != nil {
		close(a.pingStop)
		a.pingStop = nil
	}
	if a.announceTicker != nil {
		a.announceTicker.Stop()
		a.announceTicker = nil
	}
	if a.announceStop != nil {
		close(a.announceStop)
		a.announceStop = nil
	}
	a.mu.Unlock()
}

// ── internal: message handling ─────────────────────────────────────────────

func (a *Adapter) handleMessage(raw []byte) {
	var msg map[string]interface{}
	if err := json.Unmarshal(raw, &msg); err != nil {
		return
	}

	msgType, _ := msg["type"].(string)
	switch msgType {
	case "peer_list":
		a.handlePeerList(msg)
	case "offer":
		from := a.normPeerID(msg["from"])
		var body sdpBody
		if b, ok := msg["body"].(map[string]interface{}); ok {
			body.SDP, _ = b["sdp"].(string)
			body.TrickleICE, _ = b["trickle_ice"].(bool)
		}
		go a.enqueueOffer(from, body)
	case "answer":
		from := a.normPeerID(msg["from"])
		var body sdpBody
		if b, ok := msg["body"].(map[string]interface{}); ok {
			body.SDP, _ = b["sdp"].(string)
		}
		go a.handleSignal(from, rtcpeer.Signal{Type: "answer", SDP: body.SDP})
	case "ice_candidate":
		from := a.normPeerID(msg["from"])
		if b, ok := msg["body"].(map[string]interface{}); ok {
			cand := a.normalizeCandidate(b["candidate"])
			if cand != nil {
				go a.handleSignal(from, rtcpeer.Signal{Candidate: cand})
			}
		}
	case "bye":
		from := a.normPeerID(msg["from"])
		a.CloseConnection(from)
	case "error":
		if b, ok := msg["body"].(map[string]interface{}); ok {
			errMsg, _ := b["error"].(string)
			a.log(fmt.Sprintf("[signal] error: %s", errMsg))
		}
	}
}

func (a *Adapter) handlePeerList(msg map[string]interface{}) {
	body, _ := msg["body"].(map[string]interface{})
	rawPeers, _ := body["peers"].([]interface{})

	nextPeers := make(map[string]struct{})
	var peerList []string
	for _, p := range rawPeers {
		pm, _ := p.(map[string]interface{})
		id := a.normPeerID(pm["peer_id"])
		if id == "" || a.isSelf(id) {
			continue
		}
		nextPeers[id] = struct{}{}
		peerList = append(peerList, id)
	}

	a.mu.Lock()
	wasJoined := a.joinedOnce
	if !wasJoined {
		a.joinedOnce = true
	}
	oldKnown := a.knownPeers
	a.knownPeers = nextPeers
	a.mu.Unlock()

	if !wasJoined {
		a.fireJoined(JoinedEvent{SessionID: a.networkID, Clients: peerList})
	}

	for id := range nextPeers {
		if _, had := oldKnown[id]; !had {
			a.firePeerJoined(id)
		}
	}
	for id := range oldKnown {
		if _, has := nextPeers[id]; !has {
			a.firePeerLeft(id)
		}
	}
}

// ── internal: offer handling ───────────────────────────────────────────────

func (a *Adapter) enqueueOffer(peerID string, body sdpBody) {
	if peerID == "" || body.SDP == "" {
		return
	}
	// Serialise offer processing per peer.
	a.mu.Lock()
	mu, ok := a.offerMu[peerID]
	if !ok {
		mu = &sync.Mutex{}
		a.offerMu[peerID] = mu
	}
	a.mu.Unlock()

	mu.Lock()
	defer mu.Unlock()
	a.handleOffer(peerID, body)
}

func (a *Adapter) handleOffer(peerID string, body sdpBody) {
	a.mu.Lock()
	entry := a.peerEntries[peerID]
	lastSDP := a.lastOfferSDP[peerID]
	a.mu.Unlock()

	if body.SDP == "" {
		return
	}
	// Deterministic initiator selection is handled by Mesh. If we already have
	// an initiator-side connection attempt for this peer, ignore incoming offers
	// to avoid offer glare loops.
	if entry != nil && entry.initiator {
		return
	}
	if entry != nil && entry.connected {
		return
	}
	if lastSDP == body.SDP {
		return
	}

	if entry == nil {
		peer, err := rtcpeer.New(rtcpeer.Options{
			Initiator:  false,
			TrickleICE: body.TrickleICE,
			Config:     a.buildRTCConfig(),
		})
		if err != nil {
			a.log(fmt.Sprintf("[webrtc] create peer for offer from %s: %v", peerID, err))
			return
		}
		a.attachPeer(peerID, peer, false)
		a.mu.Lock()
		if e := a.peerEntries[peerID]; e != nil {
			e.trickleICE = body.TrickleICE
		}
		a.mu.Unlock()
	}

	a.mu.Lock()
	a.lastOfferSDP[peerID] = body.SDP
	entry = a.peerEntries[peerID]
	a.mu.Unlock()

	if entry == nil {
		return
	}

	if err := entry.peer.Signal(rtcpeer.Signal{Type: "offer", SDP: body.SDP}); err != nil {
		a.log(fmt.Sprintf("[webrtc] answer error for %s: %v", peerID, err))
		return
	}
	a.flushPendingCandidates(peerID)
}

func (a *Adapter) handleSignal(peerID string, sig rtcpeer.Signal) {
	a.mu.Lock()
	entry := a.peerEntries[peerID]
	a.mu.Unlock()

	if entry == nil {
		if sig.Candidate != nil {
			a.mu.Lock()
			a.pendingCands[peerID] = append(a.pendingCands[peerID], sig)
			a.mu.Unlock()
		}
		return
	}

	if sig.Type == "answer" {
		a.mu.Lock()
		lastAns := a.lastAnswerSDP[peerID]
		a.mu.Unlock()
		if sig.SDP != "" && lastAns == sig.SDP {
			return
		}
		if err := entry.peer.Signal(sig); err != nil {
			// ignore wrong-state errors
			a.log(fmt.Sprintf("[webrtc] answer signal error %s: %v", peerID, err))
			return
		}
		if sig.SDP != "" {
			a.mu.Lock()
			a.lastAnswerSDP[peerID] = sig.SDP
			a.mu.Unlock()
		}
		a.flushPendingCandidates(peerID)
		return
	}

	if err := entry.peer.Signal(sig); err != nil {
		msg := strings.ToLower(err.Error())
		if sig.Candidate != nil && (strings.Contains(msg, "remote description") || strings.Contains(msg, "wrong state")) {
			a.mu.Lock()
			a.pendingCands[peerID] = append(a.pendingCands[peerID], sig)
			a.mu.Unlock()
			return
		}
		a.log(fmt.Sprintf("[webrtc] signal error %s: %v", peerID, err))
	}
}

func (a *Adapter) flushPendingCandidates(peerID string) {
	a.mu.Lock()
	cands := a.pendingCands[peerID]
	delete(a.pendingCands, peerID)
	a.mu.Unlock()
	for _, c := range cands {
		a.handleSignal(peerID, c)
	}
}

// ── internal: peer attachment ──────────────────────────────────────────────

func (a *Adapter) attachPeer(peerID string, peer *rtcpeer.RtcPeer, initiator bool) {
	entry := &peerEntry{peer: peer, initiator: initiator, trickleICE: a.trickleICE}
	a.mu.Lock()
	a.peerEntries[peerID] = entry
	a.mu.Unlock()

	peer.OnSignal(func(sig rtcpeer.Signal) {
		if sig.Type == "offer" || sig.Type == "answer" {
			a.sendEnvelope(sig.Type, map[string]interface{}{
				"sdp":         sig.SDP,
				"trickle_ice": entry.trickleICE,
			}, peerID, nil, nil)
		} else if sig.Candidate != nil {
			a.sendEnvelope("ice_candidate", map[string]interface{}{
				"candidate": sig.Candidate,
			}, peerID, nil, nil)
		}
	})

	peer.OnConnect(func() {
		a.mu.Lock()
		e := a.peerEntries[peerID]
		if e != nil && !e.connected {
			e.connected = true
		}
		a.mu.Unlock()
		if e != nil {
			a.fireRTCConnected(peerID)
		}
	})

	peer.OnData(func(data []byte) {
		a.fireRTCData(RTCDataEvent{PeerID: peerID, Data: data})
	})

	peer.OnDebug(func(snap rtcpeer.DebugSnapshot) {
		a.log(fmt.Sprintf("[webrtc] %s %s signaling=%s ice=%s pc=%s dc=%s",
			peerID, snap.Reason, snap.SignalingState, snap.ICEConnState, snap.ConnectionState, snap.DataChannelState))
	})

	peer.OnClose(func() {
		a.mu.Lock()
		delete(a.peerEntries, peerID)
		delete(a.pendingCands, peerID)
		a.mu.Unlock()
		a.fireRTCDisconnected(peerID)
	})

	peer.OnError(func(err error) {
		a.log(fmt.Sprintf("[webrtc] %s error: %v", peerID, err))
	})
}

func (a *Adapter) closeAllPeers() {
	a.mu.Lock()
	entries := make(map[string]*peerEntry, len(a.peerEntries))
	for id, e := range a.peerEntries {
		entries[id] = e
	}
	a.peerEntries = make(map[string]*peerEntry)
	a.pendingCands = make(map[string][]rtcpeer.Signal)
	a.lastOfferSDP = make(map[string]string)
	a.lastAnswerSDP = make(map[string]string)
	a.mu.Unlock()

	for id, e := range entries {
		if e.peer != nil {
			e.peer.Destroy()
		}
		a.fireRTCDisconnected(id)
	}
}

// ── internal: WebSocket send ───────────────────────────────────────────────

func (a *Adapter) sendEnvelope(msgType string, body interface{}, to string, sessionID interface{}, ttlMS *int64) {
	a.mu.Lock()
	sock := a.socket
	a.mu.Unlock()
	if sock == nil {
		return
	}

	env := pspEnvelope{
		PSPVersion: "1.0",
		Type:       msgType,
		Network:    a.networkID,
		From:       a.peerID,
		MessageID:  generatePeerID()[:16],
		Timestamp:  time.Now().UnixMilli(),
	}
	if to != "" {
		env.To = to
	}
	if sessionID != nil {
		env.SessionID = sessionID
	}
	if ttlMS != nil {
		env.TTLMS = *ttlMS
	}
	if body != nil {
		env.Body = body
	} else {
		env.Body = map[string]interface{}{}
	}

	data, err := json.Marshal(env)
	if err != nil {
		return
	}
	a.writeMu.Lock()
	_ = sock.WriteMessage(websocket.TextMessage, data)
	a.writeMu.Unlock()
}

// ── internal: helpers ──────────────────────────────────────────────────────

func (a *Adapter) addSelfAlias(id string) {
	id = normID(id)
	if id == "" {
		return
	}
	a.mu.Lock()
	a.selfAliases[id] = struct{}{}
	a.mu.Unlock()
}

func (a *Adapter) isSelf(id string) bool {
	id = normID(id)
	a.mu.Lock()
	_, ok := a.selfAliases[id]
	a.mu.Unlock()
	return ok
}

func (a *Adapter) normPeerID(v interface{}) string {
	s, _ := v.(string)
	return normID(s)
}

func (a *Adapter) normalizeCandidate(v interface{}) *rtcpeer.CandidateInit {
	m, ok := v.(map[string]interface{})
	if !ok {
		return nil
	}
	cand, _ := m["candidate"].(string)
	cand = strings.TrimSpace(cand)
	if cand == "" {
		return nil
	}
	init := &rtcpeer.CandidateInit{Candidate: cand}
	if mid, ok := m["sdpMid"].(string); ok {
		init.SDPMid = &mid
	}
	if idx, ok := m["sdpMLineIndex"].(float64); ok {
		u := uint16(idx)
		init.SDPMLineIndex = &u
	}
	if frag, ok := m["usernameFragment"].(string); ok {
		init.UsernameFragment = &frag
	}
	return init
}

func (a *Adapter) isConnectedLocked() bool {
	return a.socket != nil
}

func (a *Adapter) buildRTCConfig() *webrtc.Configuration {
	if len(a.iceServers) == 0 {
		return &webrtc.Configuration{
			ICEServers: []webrtc.ICEServer{
				{URLs: []string{"stun:stun.l.google.com:19302"}},
			},
		}
	}
	return &webrtc.Configuration{ICEServers: a.iceServers}
}

func (a *Adapter) log(msg string) {
	a.mu.Lock()
	cbs := append(([]func(string))(nil), a.onSignalingLog...)
	a.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(msg) })
	}
}

// ── event fires ────────────────────────────────────────────────────────────

func (a *Adapter) fireConnected(e ConnectedEvent) {
	a.mu.Lock()
	cbs := append(([]func(ConnectedEvent))(nil), a.onConnected...)
	a.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(e) })
	}
}
func (a *Adapter) fireJoined(e JoinedEvent) {
	a.mu.Lock()
	cbs := append(([]func(JoinedEvent))(nil), a.onJoined...)
	a.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(e) })
	}
}
func (a *Adapter) firePeerJoined(id string) {
	a.mu.Lock()
	cbs := append(([]func(string))(nil), a.onPeerJoined...)
	a.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(id) })
	}
}
func (a *Adapter) firePeerLeft(id string) {
	a.mu.Lock()
	cbs := append(([]func(string))(nil), a.onPeerLeft...)
	a.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(id) })
	}
}
func (a *Adapter) fireRTCConnected(id string) {
	a.mu.Lock()
	cbs := append(([]func(string))(nil), a.onRTCConnected...)
	a.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(id) })
	}
}
func (a *Adapter) fireRTCDisconnected(id string) {
	a.mu.Lock()
	cbs := append(([]func(string))(nil), a.onRTCDisconnected...)
	a.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(id) })
	}
}
func (a *Adapter) fireRTCData(e RTCDataEvent) {
	a.mu.Lock()
	cbs := append(([]func(RTCDataEvent))(nil), a.onRTCData...)
	a.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(e) })
	}
}
func (a *Adapter) fireError(err error) {
	a.mu.Lock()
	cbs := append(([]func(error))(nil), a.onError...)
	a.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(err) })
	}
}

// ── utilities ──────────────────────────────────────────────────────────────

func normID(s string) string { return strings.TrimSpace(s) }

func generatePeerID() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

func int64Ptr(v int64) *int64 { return &v }

func safeCall(fn func()) {
	defer func() { recover() }() //nolint:errcheck
	fn()
}
