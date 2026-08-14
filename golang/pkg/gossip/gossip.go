// Package gossip implements the epidemic gossip broadcast protocol and
// coordinate-enhanced XOR-routed direct messaging.
// It is a faithful Go port of src/gossip.ts.
package gossip

import (
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ── types ──────────────────────────────────────────────────────────────────

// Options configures a GossipProtocol instance.
type Options struct {
	MaxHops              int
	MaxDirectHops        int
	CECRCoordinateWeight float64
	CECRExtremaMaxAgeMs  int64
	CECRMaxAcceptedDrift float64
	// CECRDisableConsensus disables the requirement that all connected peers
	// agree on the canonical peer set before coordinate routing is used.
	// Default false (consensus required, matching the TypeScript default).
	CECRDisableConsensus     bool
	DeliveryTimeoutMs        int64
	DeliveryRepairDelayMs    int64
	DeliveryRepairIntervalMs int64
}

// BroadcastOptions controls optional behavior for one gossip broadcast.
type BroadcastOptions struct {
	TrackDelivery     bool
	DeliveryTimeoutMs int64
}

// DeliveryStatus is the sender-visible delivery state for a tracked message.
type DeliveryStatus struct {
	MessageID        string   `json:"messageId"`
	Sender           string   `json:"sender"`
	MembershipHash   string   `json:"membershipHash"`
	AudiencePeerIDs  []string `json:"audiencePeerIds"`
	DeliveredPeerIDs []string `json:"deliveredPeerIds"`
	PendingPeerIDs   []string `json:"pendingPeerIds"`
	AudienceCount    int      `json:"audienceCount"`
	DeliveredCount   int      `json:"deliveredCount"`
	Complete         bool     `json:"complete"`
	TimedOut         bool     `json:"timedOut"`
	CreatedAt        int64    `json:"createdAt"`
	UpdatedAt        int64    `json:"updatedAt"`
	DeadlineAt       int64    `json:"deadlineAt"`
}

type DeliveryEnvelope struct {
	SetHash    string `json:"setHash"`
	Size       int    `json:"size"`
	Bits       string `json:"bits"`
	DeadlineAt int64  `json:"deadlineAt"`
}

type deliveryReceipt struct {
	MessageID string `json:"messageId"`
	Sender    string `json:"sender"`
	DeliveryEnvelope
}

// Message is a gossip broadcast message.
type Message struct {
	ID        string                 `json:"id"`
	Timestamp int64                  `json:"timestamp"`
	Hops      int                    `json:"hops"`
	MaxHops   int                    `json:"maxHops"`
	Sender    string                 `json:"sender"`
	Data      interface{}            `json:"data"`
	Metadata  map[string]interface{} `json:"metadata"`
	Type      string                 `json:"type"` // "gossip"
	Delivery  *DeliveryEnvelope      `json:"delivery,omitempty"`
}

// DirectMessage is a routed point-to-point message.
type DirectMessage struct {
	ID        string      `json:"id"`
	Type      string      `json:"type"` // "direct"
	From      string      `json:"from"`
	To        string      `json:"to"`
	Data      interface{} `json:"data"`
	Hops      int         `json:"hops"`
	MaxHops   int         `json:"maxHops"`
	Timestamp int64       `json:"timestamp"`
}

// MessageReceivedEvent is delivered to OnMessageReceived handlers.
type MessageReceivedEvent struct {
	Message  Message
	Local    bool
	FromPeer string
}

// DirectMessageReceivedEvent is delivered for direct messages addressed to us.
type DirectMessageReceivedEvent struct {
	Message DirectMessage
}

type cecrStateMsg struct {
	ID        string            `json:"id"`
	Type      string            `json:"type"` // "cecr-state"
	From      string            `json:"from"`
	Timestamp int64             `json:"timestamp"`
	SetHash   string            `json:"setHash"`
	MinHex    string            `json:"minHex"`
	MaxHex    string            `json:"maxHex"`
	Size      int               `json:"size"`
	Receipts  []deliveryReceipt `json:"receipts,omitempty"`
}

type cecrExtrema struct {
	min         *big.Int
	max         *big.Int
	updatedAtMs int64
	size        int
	setHash     string
}

type cecrRemoteState struct {
	setHash     string
	min         *big.Int
	max         *big.Int
	size        int
	updatedAtMs int64
}

type deliveryRepairAttempt struct {
	attempts      int
	lastAttemptAt int64
}

type deliveryState struct {
	messageID           string
	sender              string
	setHash             string
	size                int
	bits                []byte
	peerIDs             []string
	message             *Message
	createdAt           int64
	updatedAt           int64
	deadlineAt          int64
	completedAt         int64
	timedOut            bool
	lastStatusSignature string
	repairAttempts      map[string]deliveryRepairAttempt
}

const (
	reliableRepairType         = "pp-gossip-repair-v1"
	maxReceiptDeltasPerSync    = 32
	maxDeliveryPeers           = 4096
	maxRepairAttemptsPerTarget = 3
)

// MeshLike is the interface GossipProtocol uses to interact with the mesh layer.
// PartialMesh satisfies this interface.
type MeshLike interface {
	OnPeerData(func(peerID string, data []byte))
	OnPeerConnected(func(peerID string))
	OnPeerDisconnected(func(peerID string))
	GetClientID() string
	GetConnectedPeers() []string
	GetDiscoveredPeers() []string
	GetGlobalPeers() []string
	Send(peerID string, data []byte) error
}

// ── protocol ───────────────────────────────────────────────────────────────

// GossipProtocol manages gossip broadcast and direct routed messaging.
type GossipProtocol struct {
	mesh                     MeshLike
	maxHops                  int
	maxDirectHops            int
	cecrCW                   float64
	cecrMaxAgeMs             int64
	cecrMaxDrift             float64
	cecrConsensus            bool
	deliveryTimeoutMs        int64
	deliveryRepairDelayMs    int64
	deliveryRepairIntervalMs int64

	mu                    sync.Mutex
	messageLog            map[string]msgLogEntry // id → entry
	seenDirectIDs         map[string]int64       // id → first seen timestamp (ms)
	peers                 map[string]int64       // peerID → connectedAtMs
	cecrCurrent           *cecrExtrema
	cecrPrevious          *cecrExtrema
	cecrRemote            map[string]*cecrRemoteState
	deliveryStates        map[string]*deliveryState
	dirtyDeliveryReceipts map[string]struct{}

	// Tracking bounds to prevent unbounded growth
	maxTrackedMessages  int
	maxTrackedDirectIDs int
	trackingRetentionMs int64
	cleanupTickInterval time.Duration

	syncTicker *time.Ticker
	syncDone   chan struct{}

	// callbacks
	onMsgReceived      []msgReceivedHandler
	onPeerConn         []func(string)
	onPeerDisconn      []func(string)
	onDirectMsg        []func(DirectMessageReceivedEvent)
	onDeliveryProgress []func(DeliveryStatus)
	onDeliveryComplete []func(DeliveryStatus)
	onDeliveryTimeout  []func(DeliveryStatus)
	nextMsgHandlerID   uint64
}

type msgReceivedHandler struct {
	id uint64
	fn func(MessageReceivedEvent)
}

type msgLogEntry struct {
	timestamp int64
	sender    string
	hops      int
}

// New creates and returns a new GossipProtocol bound to the given mesh.
func New(mesh MeshLike, opts Options) *GossipProtocol {
	if opts.MaxHops == 0 {
		opts.MaxHops = 5
	}
	if opts.MaxDirectHops == 0 {
		opts.MaxDirectHops = 20
	}
	if opts.CECRCoordinateWeight == 0 {
		opts.CECRCoordinateWeight = 0.35
	}
	if opts.CECRExtremaMaxAgeMs == 0 {
		opts.CECRExtremaMaxAgeMs = 20_000
	}
	if opts.CECRMaxAcceptedDrift == 0 {
		opts.CECRMaxAcceptedDrift = 0.18
	}
	if opts.DeliveryTimeoutMs == 0 {
		opts.DeliveryTimeoutMs = 30_000
	}
	if opts.DeliveryRepairDelayMs == 0 {
		opts.DeliveryRepairDelayMs = 4_000
	}
	if opts.DeliveryRepairIntervalMs == 0 {
		opts.DeliveryRepairIntervalMs = 5_000
	}
	g := &GossipProtocol{
		mesh:                     mesh,
		maxHops:                  opts.MaxHops,
		maxDirectHops:            opts.MaxDirectHops,
		cecrCW:                   clamp01(opts.CECRCoordinateWeight),
		cecrMaxAgeMs:             max64(1_000, opts.CECRExtremaMaxAgeMs),
		cecrMaxDrift:             clamp01(opts.CECRMaxAcceptedDrift),
		cecrConsensus:            !opts.CECRDisableConsensus, // default true
		deliveryTimeoutMs:        max64(2_000, opts.DeliveryTimeoutMs),
		deliveryRepairDelayMs:    max64(1_000, opts.DeliveryRepairDelayMs),
		deliveryRepairIntervalMs: max64(1_000, opts.DeliveryRepairIntervalMs),
		messageLog:               make(map[string]msgLogEntry),
		seenDirectIDs:            make(map[string]int64),
		peers:                    make(map[string]int64),
		cecrRemote:               make(map[string]*cecrRemoteState),
		deliveryStates:           make(map[string]*deliveryState),
		dirtyDeliveryReceipts:    make(map[string]struct{}),
		maxTrackedMessages:       12_000,
		maxTrackedDirectIDs:      12_000,
		trackingRetentionMs:      10 * 60_000, // 10 minutes
		cleanupTickInterval:      2 * time.Second,
		syncDone:                 make(chan struct{}),
	}
	g.setupListeners()
	g.startSyncLoop()
	return g
}

// ── event registration ─────────────────────────────────────────────────────

// OnMessageReceived registers a handler for received gossip broadcasts.
// Returns an unsubscribe function.
func (g *GossipProtocol) OnMessageReceived(fn func(MessageReceivedEvent)) func() {
	id := atomic.AddUint64(&g.nextMsgHandlerID, 1)
	g.mu.Lock()
	g.onMsgReceived = append(g.onMsgReceived, msgReceivedHandler{id: id, fn: fn})
	g.mu.Unlock()
	return func() {
		g.mu.Lock()
		for i, h := range g.onMsgReceived {
			if h.id == id {
				g.onMsgReceived = append(g.onMsgReceived[:i], g.onMsgReceived[i+1:]...)
				break
			}
		}
		g.mu.Unlock()
	}
}

// OnPeerConnected registers a handler for peer connection events.
func (g *GossipProtocol) OnPeerConnected(fn func(string)) {
	g.mu.Lock()
	g.onPeerConn = append(g.onPeerConn, fn)
	g.mu.Unlock()
}

// OnPeerDisconnected registers a handler for peer disconnection events.
func (g *GossipProtocol) OnPeerDisconnected(fn func(string)) {
	g.mu.Lock()
	g.onPeerDisconn = append(g.onPeerDisconn, fn)
	g.mu.Unlock()
}

// OnDirectMessageReceived registers a handler for direct messages addressed to this peer.
func (g *GossipProtocol) OnDirectMessageReceived(fn func(DirectMessageReceivedEvent)) {
	g.mu.Lock()
	g.onDirectMsg = append(g.onDirectMsg, fn)
	g.mu.Unlock()
}

// OnDeliveryProgress registers a handler for sender-visible receipt changes.
func (g *GossipProtocol) OnDeliveryProgress(fn func(DeliveryStatus)) {
	g.mu.Lock()
	g.onDeliveryProgress = append(g.onDeliveryProgress, fn)
	g.mu.Unlock()
}

// OnDeliveryComplete registers a handler fired once all audience peers acknowledge.
func (g *GossipProtocol) OnDeliveryComplete(fn func(DeliveryStatus)) {
	g.mu.Lock()
	g.onDeliveryComplete = append(g.onDeliveryComplete, fn)
	g.mu.Unlock()
}

// OnDeliveryTimeout registers a handler fired when the delivery deadline expires.
func (g *GossipProtocol) OnDeliveryTimeout(fn func(DeliveryStatus)) {
	g.mu.Lock()
	g.onDeliveryTimeout = append(g.onDeliveryTimeout, fn)
	g.mu.Unlock()
}

// ── public API ─────────────────────────────────────────────────────────────

// Broadcast sends data to all peers in the mesh via gossip propagation.
// Returns the generated message ID.
func (g *GossipProtocol) Broadcast(data interface{}, metadata map[string]interface{}) string {
	return g.BroadcastWithOptions(data, metadata, BroadcastOptions{})
}

// BroadcastReliable sends a gossip message with tracked delivery enabled.
func (g *GossipProtocol) BroadcastReliable(data interface{}, metadata map[string]interface{}, opts BroadcastOptions) string {
	opts.TrackDelivery = true
	return g.BroadcastWithOptions(data, metadata, opts)
}

// BroadcastWithOptions sends gossip with optional tracked delivery.
func (g *GossipProtocol) BroadcastWithOptions(data interface{}, metadata map[string]interface{}, opts BroadcastOptions) string {
	if metadata == nil {
		metadata = make(map[string]interface{})
	}
	sender := g.mesh.GetClientID()
	connected := g.mesh.GetConnectedPeers()
	global := g.mesh.GetGlobalPeers()
	networkSize := max(len(connected), len(global))
	if networkSize < 1 {
		networkSize = 1
	}
	maxHops := g.maxHops
	if h := networkSize * 2; h > maxHops {
		maxHops = h
	}

	messageID := g.generateMsgID(sender)
	var delivery *DeliveryEnvelope
	var deliveryPeers []string
	if opts.TrackDelivery && sender != "" {
		deliveryPeers = g.canonicalPeerSet()
		bits := createDeliveryBits(len(deliveryPeers))
		if senderIndex := indexOfString(deliveryPeers, sender); senderIndex >= 0 {
			setDeliveryBit(bits, senderIndex)
		}
		timeout := opts.DeliveryTimeoutMs
		if timeout == 0 {
			timeout = g.deliveryTimeoutMs
		}
		delivery = &DeliveryEnvelope{
			SetHash:    canonicalSetHash(deliveryPeers),
			Size:       len(deliveryPeers),
			Bits:       deliveryBitsToHex(bits),
			DeadlineAt: nowMs() + max64(2_000, timeout),
		}
	}

	msg := Message{
		ID:        messageID,
		Timestamp: nowMs(),
		Hops:      0,
		MaxHops:   maxHops,
		Sender:    sender,
		Data:      data,
		Metadata:  metadata,
		Type:      "gossip",
		Delivery:  delivery,
	}

	g.mu.Lock()
	g.messageLog[msg.ID] = msgLogEntry{timestamp: msg.Timestamp, sender: msg.Sender, hops: 0}
	if len(g.messageLog) > g.maxTrackedMessages {
		g.pruneTracking(nowMs())
	}
	g.mu.Unlock()
	if delivery != nil {
		g.registerTrackedDelivery(msg, deliveryPeers, true)
	}

	g.propagate(msg, "")
	g.fireMessageReceived(MessageReceivedEvent{Message: msg, Local: true})
	return msg.ID
}

// GetDeliveryStatus returns the receipt state for a tracked gossip message.
func (g *GossipProtocol) GetDeliveryStatus(messageID string) (DeliveryStatus, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	state, ok := g.deliveryStates[messageID]
	if !ok {
		return DeliveryStatus{}, false
	}
	return g.deliveryStatusLocked(state), true
}

// SendDirect sends a message directly to a specific peer, routing through the
// mesh using XOR/CECR hybrid distance if there's no direct connection.
// Returns the message ID, or empty string on failure.
func (g *GossipProtocol) SendDirect(targetPeerID string, data interface{}) string {
	from := g.mesh.GetClientID()
	if from == "" {
		return ""
	}
	msg := DirectMessage{
		ID:        g.generateMsgID(from),
		Type:      "direct",
		From:      from,
		To:        targetPeerID,
		Data:      data,
		Hops:      0,
		MaxHops:   g.maxDirectHops,
		Timestamp: nowMs(),
	}
	g.mu.Lock()
	g.seenDirectIDs[msg.ID] = nowMs()
	g.mu.Unlock()
	g.routeDirect(msg, "")
	return msg.ID
}

// Cleanup removes message log entries older than maxAgeMs.
func (g *GossipProtocol) Cleanup(maxAgeMs int64) {
	now := nowMs()
	g.mu.Lock()
	g.pruneTracking(now)
	g.mu.Unlock()
}

// pruneTracking enforces both age-based and size-based limits on tracking maps.
func (g *GossipProtocol) pruneTracking(now int64) {
	minTimestamp := now - g.trackingRetentionMs

	// Time-based pruning first
	for id, entry := range g.messageLog {
		if entry.timestamp < minTimestamp {
			delete(g.messageLog, id)
		}
	}
	for id, firstSeen := range g.seenDirectIDs {
		if firstSeen < minTimestamp {
			delete(g.seenDirectIDs, id)
		}
	}

	// Size-based pruning: remove oldest entries if still over limit
	for len(g.messageLog) > g.maxTrackedMessages {
		var oldestID string
		var oldestTime int64 = math.MaxInt64
		for id, entry := range g.messageLog {
			if entry.timestamp < oldestTime {
				oldestTime = entry.timestamp
				oldestID = id
			}
		}
		if oldestID != "" {
			delete(g.messageLog, oldestID)
		} else {
			break
		}
	}

	for len(g.seenDirectIDs) > g.maxTrackedDirectIDs {
		var oldestID string
		var oldestTime int64 = math.MaxInt64
		for id, firstSeen := range g.seenDirectIDs {
			if firstSeen < oldestTime {
				oldestTime = firstSeen
				oldestID = id
			}
		}
		if oldestID != "" {
			delete(g.seenDirectIDs, oldestID)
		} else {
			break
		}
	}

	for id, state := range g.deliveryStates {
		terminalAt := state.completedAt
		if terminalAt == 0 && state.timedOut {
			terminalAt = state.deadlineAt
		}
		expired := false
		if terminalAt > 0 {
			expired = now-terminalAt > g.trackingRetentionMs
		} else {
			expired = now-state.createdAt > g.trackingRetentionMs
		}
		if expired {
			delete(g.deliveryStates, id)
			delete(g.dirtyDeliveryReceipts, id)
		}
	}
}

// Destroy stops the CECR sync loop and clears internal state.
func (g *GossipProtocol) Destroy() {
	select {
	case <-g.syncDone:
	default:
		close(g.syncDone)
	}
	if g.syncTicker != nil {
		g.syncTicker.Stop()
	}
	g.mu.Lock()
	g.messageLog = make(map[string]msgLogEntry)
	g.peers = make(map[string]int64)
	g.seenDirectIDs = make(map[string]int64)
	g.cecrRemote = make(map[string]*cecrRemoteState)
	g.deliveryStates = make(map[string]*deliveryState)
	g.dirtyDeliveryReceipts = make(map[string]struct{})
	g.onMsgReceived = nil
	g.onPeerConn = nil
	g.onPeerDisconn = nil
	g.onDirectMsg = nil
	g.onDeliveryProgress = nil
	g.onDeliveryComplete = nil
	g.onDeliveryTimeout = nil
	g.mu.Unlock()
}

// ── internal: mesh listeners ───────────────────────────────────────────────

func (g *GossipProtocol) setupListeners() {
	g.mesh.OnPeerData(func(peerID string, data []byte) {
		g.handleRawMessage(data, peerID)
	})
	g.mesh.OnPeerConnected(func(peerID string) {
		g.mu.Lock()
		g.peers[peerID] = nowMs()
		for messageID := range g.deliveryStates {
			g.dirtyDeliveryReceipts[messageID] = struct{}{}
		}
		g.mu.Unlock()
		g.publishCECRState()
		g.firePeerConnected(peerID)
	})
	g.mesh.OnPeerDisconnected(func(peerID string) {
		g.mu.Lock()
		delete(g.peers, peerID)
		delete(g.cecrRemote, peerID)
		g.mu.Unlock()
		g.publishCECRState()
		g.firePeerDisconnected(peerID)
	})
}

func (g *GossipProtocol) startSyncLoop() {
	ticker := time.NewTicker(g.cleanupTickInterval)
	g.syncTicker = ticker
	go func() {
		for {
			select {
			case <-ticker.C:
				g.maintainTrackedDeliveries()
				g.publishCECRState()
				g.mu.Lock()
				g.pruneTracking(nowMs())
				g.mu.Unlock()
			case <-g.syncDone:
				return
			}
		}
	}()
}

// ── internal: propagation ──────────────────────────────────────────────────

func (g *GossipProtocol) propagate(msg Message, exceptPeerID string) {
	if delivery := g.currentDeliveryEnvelope(msg.ID); delivery != nil {
		msg.Delivery = delivery
	}
	for _, peerID := range g.mesh.GetConnectedPeers() {
		if peerID == msg.Sender || peerID == exceptPeerID {
			continue
		}
		forwarded := msg
		forwarded.Hops = msg.Hops + 1
		data, err := json.Marshal(forwarded)
		if err != nil {
			continue
		}
		_ = g.mesh.Send(peerID, data)
	}
}

func (g *GossipProtocol) handleIncomingMessage(msg Message, fromPeer string) {
	if msg.Delivery != nil {
		g.registerTrackedDelivery(msg, nil, true)
	}
	g.mu.Lock()
	if _, seen := g.messageLog[msg.ID]; seen {
		g.mu.Unlock()
		return
	}
	g.messageLog[msg.ID] = msgLogEntry{timestamp: nowMs(), sender: msg.Sender, hops: msg.Hops}
	g.mu.Unlock()

	g.fireMessageReceived(MessageReceivedEvent{Message: msg, Local: false, FromPeer: fromPeer})

	if msg.Hops < msg.MaxHops {
		g.propagate(msg, fromPeer)
	}
}

// ── tracked delivery receipts ─────────────────────────────────────────────

type reliableRepairPayload struct {
	PeerPigeonType string  `json:"__peerPigeonType"`
	Message        Message `json:"message"`
}

type deliveryRepairJob struct {
	target  string
	message Message
}

func createDeliveryBits(size int) []byte {
	if size <= 0 {
		return nil
	}
	return make([]byte, (size+7)/8)
}

func setDeliveryBit(bits []byte, index int) bool {
	if index < 0 || index >= len(bits)*8 {
		return false
	}
	byteIndex := index / 8
	mask := byte(1 << (index % 8))
	before := bits[byteIndex]
	bits[byteIndex] |= mask
	return bits[byteIndex] != before
}

func hasDeliveryBit(bits []byte, index int) bool {
	if index < 0 || index >= len(bits)*8 {
		return false
	}
	return bits[index/8]&(1<<(index%8)) != 0
}

func deliveryBitsToHex(bits []byte) string {
	return fmt.Sprintf("%x", bits)
}

func deliveryBitsFromHex(value string, size int) ([]byte, bool) {
	if size < 1 || size > maxDeliveryPeers {
		return nil, false
	}
	expectedBytes := (size + 7) / 8
	if len(value) != expectedBytes*2 {
		return nil, false
	}
	bits := make([]byte, expectedBytes)
	for i := 0; i < expectedBytes; i++ {
		var parsed uint64
		if _, err := fmt.Sscanf(value[i*2:i*2+2], "%02x", &parsed); err != nil {
			return nil, false
		}
		bits[i] = byte(parsed)
	}
	return bits, true
}

func mergeDeliveryBits(target, incoming []byte) bool {
	if len(target) != len(incoming) {
		return false
	}
	changed := false
	for i := range target {
		merged := target[i] | incoming[i]
		if merged != target[i] {
			target[i] = merged
			changed = true
		}
	}
	return changed
}

func indexOfString(values []string, value string) int {
	for i, candidate := range values {
		if candidate == value {
			return i
		}
	}
	return -1
}

func cloneStrings(values []string) []string {
	if values == nil {
		return nil
	}
	return append([]string(nil), values...)
}

func (g *GossipProtocol) validateDeliveryEnvelope(envelope *DeliveryEnvelope) ([]byte, bool) {
	if envelope == nil || envelope.SetHash == "" || envelope.Size < 1 || envelope.Size > maxDeliveryPeers || envelope.DeadlineAt <= 0 {
		return nil, false
	}
	if len(envelope.SetHash) != 16 || !hexRe.MatchString(envelope.SetHash) {
		return nil, false
	}
	return deliveryBitsFromHex(envelope.Bits, envelope.Size)
}

func (g *GossipProtocol) deliveryEnvelopeLocked(state *deliveryState) *DeliveryEnvelope {
	return &DeliveryEnvelope{
		SetHash:    state.setHash,
		Size:       state.size,
		Bits:       deliveryBitsToHex(state.bits),
		DeadlineAt: state.deadlineAt,
	}
}

func (g *GossipProtocol) currentDeliveryEnvelope(messageID string) *DeliveryEnvelope {
	g.mu.Lock()
	defer g.mu.Unlock()
	state := g.deliveryStates[messageID]
	if state == nil {
		return nil
	}
	return g.deliveryEnvelopeLocked(state)
}

func (g *GossipProtocol) reconstructDeliveryPeersLocked(state *deliveryState) []string {
	if len(state.peerIDs) == state.size {
		return state.peerIDs
	}
	peers := g.canonicalPeerSet()
	if len(peers) != state.size || canonicalSetHash(peers) != state.setHash {
		return nil
	}
	state.peerIDs = cloneStrings(peers)
	return state.peerIDs
}

func (g *GossipProtocol) registerTrackedDelivery(msg Message, knownPeerIDs []string, receivedLocally bool) {
	incomingBits, ok := g.validateDeliveryEnvelope(msg.Delivery)
	if !ok || msg.Sender == "" {
		return
	}
	now := nowMs()
	changed := false

	g.mu.Lock()
	state := g.deliveryStates[msg.ID]
	if state == nil {
		messageCopy := msg
		state = &deliveryState{
			messageID:      msg.ID,
			sender:         msg.Sender,
			setHash:        msg.Delivery.SetHash,
			size:           msg.Delivery.Size,
			bits:           incomingBits,
			peerIDs:        cloneStrings(knownPeerIDs),
			message:        &messageCopy,
			createdAt:      msg.Timestamp,
			updatedAt:      now,
			deadlineAt:     msg.Delivery.DeadlineAt,
			repairAttempts: make(map[string]deliveryRepairAttempt),
		}
		g.deliveryStates[msg.ID] = state
		changed = true
	} else {
		if state.sender != msg.Sender || state.setHash != msg.Delivery.SetHash || state.size != msg.Delivery.Size || state.deadlineAt != msg.Delivery.DeadlineAt {
			g.mu.Unlock()
			return
		}
		changed = mergeDeliveryBits(state.bits, incomingBits)
		if state.message == nil {
			messageCopy := msg
			state.message = &messageCopy
		}
		if knownPeerIDs != nil {
			state.peerIDs = cloneStrings(knownPeerIDs)
		}
	}

	peers := g.reconstructDeliveryPeersLocked(state)
	if receivedLocally && peers != nil {
		if selfIndex := indexOfString(peers, g.mesh.GetClientID()); selfIndex >= 0 && setDeliveryBit(state.bits, selfIndex) {
			changed = true
		}
	}
	if changed {
		state.updatedAt = now
		g.dirtyDeliveryReceipts[state.messageID] = struct{}{}
	}
	g.mu.Unlock()
	if changed {
		g.fireDeliveryEvents(msg.ID, false)
	}
}

func (g *GossipProtocol) mergeDeliveryReceipt(receipt deliveryReceipt) {
	incomingBits, ok := g.validateDeliveryEnvelope(&receipt.DeliveryEnvelope)
	if !ok || receipt.MessageID == "" || receipt.Sender == "" {
		return
	}
	now := nowMs()
	changed := false
	g.mu.Lock()
	state := g.deliveryStates[receipt.MessageID]
	if state == nil {
		state = &deliveryState{
			messageID:      receipt.MessageID,
			sender:         receipt.Sender,
			setHash:        receipt.SetHash,
			size:           receipt.Size,
			bits:           incomingBits,
			createdAt:      now,
			updatedAt:      now,
			deadlineAt:     receipt.DeadlineAt,
			repairAttempts: make(map[string]deliveryRepairAttempt),
		}
		g.deliveryStates[receipt.MessageID] = state
		changed = true
	} else {
		if state.sender != receipt.Sender || state.setHash != receipt.SetHash || state.size != receipt.Size || state.deadlineAt != receipt.DeadlineAt {
			g.mu.Unlock()
			return
		}
		changed = mergeDeliveryBits(state.bits, incomingBits)
	}
	g.reconstructDeliveryPeersLocked(state)
	if changed {
		state.updatedAt = now
		g.dirtyDeliveryReceipts[state.messageID] = struct{}{}
	}
	g.mu.Unlock()
	if changed {
		g.fireDeliveryEvents(receipt.MessageID, false)
	}
}

func (g *GossipProtocol) deliveryStatusLocked(state *deliveryState) DeliveryStatus {
	peers := g.reconstructDeliveryPeersLocked(state)
	audience := make([]string, 0)
	delivered := make([]string, 0)
	pending := make([]string, 0)
	for index, peerID := range peers {
		if peerID == state.sender {
			continue
		}
		audience = append(audience, peerID)
		if hasDeliveryBit(state.bits, index) {
			delivered = append(delivered, peerID)
		} else {
			pending = append(pending, peerID)
		}
	}
	return DeliveryStatus{
		MessageID:        state.messageID,
		Sender:           state.sender,
		MembershipHash:   state.setHash,
		AudiencePeerIDs:  audience,
		DeliveredPeerIDs: delivered,
		PendingPeerIDs:   pending,
		AudienceCount:    len(audience),
		DeliveredCount:   len(delivered),
		Complete:         len(peers) == state.size && len(pending) == 0,
		TimedOut:         state.timedOut,
		CreatedAt:        state.createdAt,
		UpdatedAt:        state.updatedAt,
		DeadlineAt:       state.deadlineAt,
	}
}

func (g *GossipProtocol) fireDeliveryEvents(messageID string, timeoutNow bool) {
	self := g.mesh.GetClientID()
	g.mu.Lock()
	state := g.deliveryStates[messageID]
	if state == nil || state.sender != self {
		g.mu.Unlock()
		return
	}
	status := g.deliveryStatusLocked(state)
	signature := strings.Join(status.DeliveredPeerIDs, "|") + "::" + strings.Join(status.PendingPeerIDs, "|") + fmt.Sprintf("::%t", status.TimedOut)
	progress := signature != state.lastStatusSignature
	if progress {
		state.lastStatusSignature = signature
	}
	complete := status.Complete && state.completedAt == 0
	if complete {
		state.completedAt = nowMs()
	}
	progressHandlers := append([]func(DeliveryStatus){}, g.onDeliveryProgress...)
	completeHandlers := append([]func(DeliveryStatus){}, g.onDeliveryComplete...)
	timeoutHandlers := append([]func(DeliveryStatus){}, g.onDeliveryTimeout...)
	g.mu.Unlock()
	if progress {
		for _, fn := range progressHandlers {
			callback := fn
			safeCall(func() { callback(status) })
		}
	}
	if complete {
		for _, fn := range completeHandlers {
			callback := fn
			safeCall(func() { callback(status) })
		}
	}
	if timeoutNow {
		for _, fn := range timeoutHandlers {
			callback := fn
			safeCall(func() { callback(status) })
		}
	}
}

func (g *GossipProtocol) selectRepairOwnerLocked(state *deliveryState, target string) string {
	peers := g.reconstructDeliveryPeersLocked(state)
	var owner, ownerScore string
	for index, candidate := range peers {
		if !hasDeliveryBit(state.bits, index) {
			continue
		}
		score := canonicalSetHash([]string{state.messageID, target, candidate})
		if ownerScore == "" || score < ownerScore {
			owner = candidate
			ownerScore = score
		}
	}
	return owner
}

func (g *GossipProtocol) maintainTrackedDeliveries() {
	now := nowMs()
	self := g.mesh.GetClientID()
	if self == "" {
		return
	}
	changedIDs := make([]string, 0)
	timeoutIDs := make([]string, 0)
	repairJobs := make([]deliveryRepairJob, 0)

	g.mu.Lock()
	for _, state := range g.deliveryStates {
		peers := g.reconstructDeliveryPeersLocked(state)
		if state.message != nil && peers != nil {
			if selfIndex := indexOfString(peers, self); selfIndex >= 0 && setDeliveryBit(state.bits, selfIndex) {
				state.updatedAt = now
				g.dirtyDeliveryReceipts[state.messageID] = struct{}{}
				changedIDs = append(changedIDs, state.messageID)
			}
		}
		status := g.deliveryStatusLocked(state)
		if status.Complete {
			continue
		}
		if now >= state.deadlineAt {
			if !state.timedOut {
				state.timedOut = true
				state.updatedAt = now
				timeoutIDs = append(timeoutIDs, state.messageID)
			}
			continue
		}
		if state.message == nil || peers == nil || now-state.createdAt < g.deliveryRepairDelayMs {
			continue
		}
		for _, target := range status.PendingPeerIDs {
			if g.selectRepairOwnerLocked(state, target) != self {
				continue
			}
			attempt := state.repairAttempts[target]
			if attempt.attempts >= maxRepairAttemptsPerTarget || now-attempt.lastAttemptAt < g.deliveryRepairIntervalMs {
				continue
			}
			messageCopy := *state.message
			messageCopy.Delivery = g.deliveryEnvelopeLocked(state)
			repairJobs = append(repairJobs, deliveryRepairJob{target: target, message: messageCopy})
			state.repairAttempts[target] = deliveryRepairAttempt{attempts: attempt.attempts + 1, lastAttemptAt: now}
		}
	}
	g.mu.Unlock()

	for _, messageID := range changedIDs {
		g.fireDeliveryEvents(messageID, false)
	}
	for _, messageID := range timeoutIDs {
		g.fireDeliveryEvents(messageID, true)
	}
	for _, job := range repairJobs {
		g.SendDirect(job.target, reliableRepairPayload{PeerPigeonType: reliableRepairType, Message: job.message})
	}
}

func parseReliableRepair(data interface{}) (Message, bool) {
	encoded, err := json.Marshal(data)
	if err != nil {
		return Message{}, false
	}
	var payload reliableRepairPayload
	if err := json.Unmarshal(encoded, &payload); err != nil || payload.PeerPigeonType != reliableRepairType || payload.Message.Type != "gossip" || payload.Message.Delivery == nil {
		return Message{}, false
	}
	return payload.Message, true
}

// ── internal: direct message routing ──────────────────────────────────────

func (g *GossipProtocol) routeDirect(msg DirectMessage, fromPeerID string) {
	self := g.mesh.GetClientID()

	if msg.To == self {
		if repairedMessage, ok := parseReliableRepair(msg.Data); ok {
			g.handleIncomingMessage(repairedMessage, fromPeerID)
			return
		}
		g.fireDirectMessageReceived(DirectMessageReceivedEvent{Message: msg})
		return
	}

	connected := g.mesh.GetConnectedPeers()
	for _, id := range connected {
		if id == msg.To {
			fwd := msg
			fwd.Hops++
			data, _ := json.Marshal(fwd)
			_ = g.mesh.Send(id, data)
			return
		}
	}

	if msg.Hops >= msg.MaxHops {
		return
	}

	next := g.closestPeerHybrid(msg.To, fromPeerID)
	if next == "" {
		return
	}
	fwd := msg
	fwd.Hops++
	data, _ := json.Marshal(fwd)
	_ = g.mesh.Send(next, data)
}

func (g *GossipProtocol) handleIncomingDirect(msg DirectMessage, fromPeer string) {
	g.mu.Lock()
	if _, seen := g.seenDirectIDs[msg.ID]; seen {
		g.mu.Unlock()
		return
	}
	g.seenDirectIDs[msg.ID] = nowMs()
	if len(g.seenDirectIDs) > g.maxTrackedDirectIDs {
		g.pruneTracking(nowMs())
	}
	g.mu.Unlock()
	g.routeDirect(msg, fromPeer)
}

// ── CECR: coordinate-enhanced routing ──────────────────────────────────────

func (g *GossipProtocol) publishCECRState() {
	self := g.mesh.GetClientID()
	if self == "" {
		return
	}
	ext := g.updateCECRExtrema()
	msg := cecrStateMsg{ID: g.generateMsgID(self), Type: "cecr-state", From: self, Timestamp: nowMs()}
	g.mu.Lock()
	receiptIDs := make([]string, 0, maxReceiptDeltasPerSync)
	receiptSnapshots := make(map[string]DeliveryEnvelope)
	for messageID := range g.dirtyDeliveryReceipts {
		state := g.deliveryStates[messageID]
		if state == nil {
			continue
		}
		envelope := g.deliveryEnvelopeLocked(state)
		msg.Receipts = append(msg.Receipts, deliveryReceipt{
			MessageID:        messageID,
			Sender:           state.sender,
			DeliveryEnvelope: *envelope,
		})
		receiptSnapshots[messageID] = *envelope
		receiptIDs = append(receiptIDs, messageID)
		if len(receiptIDs) >= maxReceiptDeltasPerSync {
			break
		}
	}
	g.mu.Unlock()
	// Receipt deltas normally piggyback on the existing CECR frame. If CECR
	// coordinates cannot be formed, emit a control frame only when a receipt is
	// pending so delivery tracking still works for arbitrary peer ID formats.
	if ext == nil && len(receiptIDs) == 0 {
		return
	}
	if ext != nil {
		msg.SetHash = ext.setHash
		msg.MinHex = fmt.Sprintf("%x", ext.min)
		msg.MaxHex = fmt.Sprintf("%x", ext.max)
		msg.Size = ext.size
	} else {
		peers := g.canonicalPeerSet()
		msg.SetHash = canonicalSetHash(peers)
		msg.MinHex = "0"
		msg.MaxHex = "0"
		msg.Size = len(peers)
	}
	data, _ := json.Marshal(msg)
	sent := false
	for _, id := range g.mesh.GetConnectedPeers() {
		if err := g.mesh.Send(id, data); err == nil {
			sent = true
		}
	}
	if sent && len(receiptIDs) > 0 {
		g.mu.Lock()
		for _, messageID := range receiptIDs {
			state := g.deliveryStates[messageID]
			snapshot := receiptSnapshots[messageID]
			if state != nil && deliveryBitsToHex(state.bits) == snapshot.Bits && state.deadlineAt == snapshot.DeadlineAt {
				delete(g.dirtyDeliveryReceipts, messageID)
			}
		}
		g.mu.Unlock()
	}
}

func (g *GossipProtocol) handleCECRState(msg cecrStateMsg, fromPeer string) {
	if msg.From != fromPeer {
		return
	}
	if msg.SetHash == "" || msg.Size < 1 {
		return
	}
	minInt, ok1 := new(big.Int).SetString(msg.MinHex, 16)
	maxInt, ok2 := new(big.Int).SetString(msg.MaxHex, 16)
	if !ok1 || !ok2 || minInt.Cmp(maxInt) > 0 {
		return
	}
	g.mu.Lock()
	g.cecrRemote[fromPeer] = &cecrRemoteState{
		setHash:     msg.SetHash,
		min:         minInt,
		max:         maxInt,
		size:        msg.Size,
		updatedAtMs: nowMs(),
	}
	g.mu.Unlock()
	for index, receipt := range msg.Receipts {
		if index >= maxReceiptDeltasPerSync {
			break
		}
		g.mergeDeliveryReceipt(receipt)
	}
}

func (g *GossipProtocol) updateCECRExtrema() *cecrExtrema {
	peers := g.canonicalPeerSet()
	if len(peers) < 2 {
		return nil
	}
	hash := canonicalSetHash(peers)

	var minV, maxV *big.Int
	for _, p := range peers {
		v := peerIDToNumeric(p)
		if v == nil {
			return nil
		}
		if minV == nil || v.Cmp(minV) < 0 {
			minV = new(big.Int).Set(v)
		}
		if maxV == nil || v.Cmp(maxV) > 0 {
			maxV = new(big.Int).Set(v)
		}
	}
	if minV == nil || maxV == nil || minV.Cmp(maxV) == 0 {
		return nil
	}

	next := &cecrExtrema{min: minV, max: maxV, updatedAtMs: nowMs(), size: len(peers), setHash: hash}

	g.mu.Lock()
	cur := g.cecrCurrent
	if cur == nil || cur.min.Cmp(next.min) != 0 || cur.max.Cmp(next.max) != 0 ||
		cur.size != next.size || cur.setHash != next.setHash {
		g.cecrPrevious = g.cecrCurrent
		g.cecrCurrent = next
	} else {
		g.cecrCurrent.updatedAtMs = next.updatedAtMs
	}
	result := g.cecrCurrent
	g.mu.Unlock()
	return result
}

func (g *GossipProtocol) canonicalPeerSet() []string {
	uni := make(map[string]struct{})
	self := g.mesh.GetClientID()
	if self != "" {
		uni[self] = struct{}{}
	}
	for _, p := range g.mesh.GetGlobalPeers() {
		uni[p] = struct{}{}
	}
	result := make([]string, 0, len(uni))
	for p := range uni {
		result = append(result, p)
	}
	sort.Strings(result)
	return result
}

func (g *GossipProtocol) closestPeerTo(target, exclude string) string {
	connected := g.mesh.GetConnectedPeers()
	var best string
	var bestDist *big.Int
	for _, p := range connected {
		if p == exclude {
			continue
		}
		d := xorDistance(p, target)
		if d == nil {
			if best == "" {
				best = p
			}
			continue
		}
		if bestDist == nil || d.Cmp(bestDist) < 0 {
			bestDist = d
			best = p
		}
	}
	return best
}

func (g *GossipProtocol) closestPeerHybrid(target, exclude string) string {
	cw := g.effectiveCECRWeight(target)
	if cw <= 0.001 {
		return g.closestPeerTo(target, exclude)
	}

	g.mu.Lock()
	ext := g.cecrCurrent
	g.mu.Unlock()
	if ext == nil {
		ext = g.updateCECRExtrema()
	}
	if ext == nil {
		return g.closestPeerTo(target, exclude)
	}

	targetCoord := coordinateFor(target, ext)
	if targetCoord == nil {
		return g.closestPeerTo(target, exclude)
	}

	connected := g.mesh.GetConnectedPeers()
	var filtered []string
	for _, p := range connected {
		if p != exclude {
			filtered = append(filtered, p)
		}
	}
	if len(filtered) == 0 {
		return ""
	}

	var maxXor = big.NewInt(1)
	xorMap := make(map[string]*big.Int)
	for _, p := range filtered {
		d := xorDistance(p, target)
		if d == nil {
			d = new(big.Int).Set(maxXor)
		}
		xorMap[p] = d
		if d.Cmp(maxXor) > 0 {
			maxXor = d
		}
	}

	var best string
	bestScore := float64(1 << 62)
	for _, p := range filtered {
		d := xorMap[p]
		xorScore := normalizedRatio(d, maxXor)
		pCoord := coordinateFor(p, ext)
		ratioScore := 1.0
		if pCoord != nil {
			diff := *targetCoord - *pCoord
			if diff < 0 {
				diff = -diff
			}
			ratioScore = diff
		}
		score := (1-cw)*xorScore + cw*ratioScore
		if score < bestScore {
			bestScore = score
			best = p
		}
	}
	if best == "" {
		return g.closestPeerTo(target, exclude)
	}
	return best
}

func (g *GossipProtocol) effectiveCECRWeight(target string) float64 {
	w := g.cecrCW
	g.mu.Lock()
	ext := g.cecrCurrent
	prev := g.cecrPrevious
	remotes := g.cecrRemote
	g.mu.Unlock()

	if ext == nil {
		ext = g.updateCECRExtrema()
	}
	if ext == nil {
		return 0
	}
	if !g.hasCECRConsensus(ext, remotes) {
		return 0
	}
	age := nowMs() - ext.updatedAtMs
	if age > g.cecrMaxAgeMs {
		w *= 0.2
	}
	if prev != nil {
		pc := coordinateFor(target, prev)
		nc := coordinateFor(target, ext)
		if pc != nil && nc != nil {
			drift := *pc - *nc
			if drift < 0 {
				drift = -drift
			}
			if drift > g.cecrMaxDrift {
				w *= 0.15
			}
		}
	}
	return clamp01(w)
}

func (g *GossipProtocol) hasCECRConsensus(local *cecrExtrema, remotes map[string]*cecrRemoteState) bool {
	if !g.cecrConsensus {
		return true
	}
	now := nowMs()
	if now-local.updatedAtMs > g.cecrMaxAgeMs {
		return false
	}
	for _, peerID := range g.mesh.GetConnectedPeers() {
		r, ok := remotes[peerID]
		if !ok {
			return false
		}
		if now-r.updatedAtMs > g.cecrMaxAgeMs {
			return false
		}
		if r.setHash != local.setHash || r.size != local.size ||
			r.min.Cmp(local.min) != 0 || r.max.Cmp(local.max) != 0 {
			return false
		}
	}
	return true
}

// ── internal: message parsing ──────────────────────────────────────────────

type rawEnvelope struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

func (g *GossipProtocol) handleRawMessage(data []byte, fromPeer string) {
	var env rawEnvelope
	if err := json.Unmarshal(data, &env); err != nil || env.ID == "" {
		return
	}

	switch env.Type {
	case "gossip":
		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			return
		}
		g.handleIncomingMessage(msg, fromPeer)
	case "direct":
		var msg DirectMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			return
		}
		if msg.From == "" || msg.To == "" {
			return
		}
		g.handleIncomingDirect(msg, fromPeer)
	case "cecr-state":
		var msg cecrStateMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			return
		}
		g.handleCECRState(msg, fromPeer)
	}
}

// ── event fires ────────────────────────────────────────────────────────────

func (g *GossipProtocol) fireMessageReceived(e MessageReceivedEvent) {
	g.mu.Lock()
	cbs := make([]func(MessageReceivedEvent), 0, len(g.onMsgReceived))
	for _, h := range g.onMsgReceived {
		cbs = append(cbs, h.fn)
	}
	g.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(e) })
	}
}
func (g *GossipProtocol) firePeerConnected(id string) {
	g.mu.Lock()
	cbs := append(([]func(string))(nil), g.onPeerConn...)
	g.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(id) })
	}
}
func (g *GossipProtocol) firePeerDisconnected(id string) {
	g.mu.Lock()
	cbs := append(([]func(string))(nil), g.onPeerDisconn...)
	g.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(id) })
	}
}
func (g *GossipProtocol) fireDirectMessageReceived(e DirectMessageReceivedEvent) {
	g.mu.Lock()
	cbs := append(([]func(DirectMessageReceivedEvent))(nil), g.onDirectMsg...)
	g.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(e) })
	}
}

// ── utilities ──────────────────────────────────────────────────────────────

var hexRe = regexp.MustCompile(`^[0-9a-fA-F]+$`)

func peerIDToNumeric(id string) *big.Int {
	h := strings.ToLower(strings.ReplaceAll(id, "-", ""))
	if h == "" || !hexRe.MatchString(h) {
		return nil
	}
	n, ok := new(big.Int).SetString(h, 16)
	if !ok {
		return nil
	}
	return n
}

func xorDistance(a, b string) *big.Int {
	ai := peerIDToNumeric(a)
	bi := peerIDToNumeric(b)
	if ai == nil || bi == nil {
		return nil
	}
	return new(big.Int).Xor(ai, bi)
}

func coordinateFor(peerID string, ext *cecrExtrema) *float64 {
	v := peerIDToNumeric(peerID)
	if v == nil {
		return nil
	}
	span := new(big.Int).Sub(ext.max, ext.min)
	if span.Sign() <= 0 {
		return nil
	}
	num := new(big.Int).Sub(v, ext.min)
	// ratio = num / span as float64
	ratio := new(big.Float).Quo(
		new(big.Float).SetInt(num),
		new(big.Float).SetInt(span),
	)
	f, _ := ratio.Float64()
	return &f
}

func normalizedRatio(numerator, denominator *big.Int) float64 {
	if denominator.Sign() <= 0 {
		return 1
	}
	if numerator.Sign() <= 0 {
		return 0
	}
	scale := big.NewInt(1_000_000)
	scaled := new(big.Int).Mul(numerator, scale)
	scaled.Div(scaled, denominator)
	return float64(scaled.Int64()) / float64(scale.Int64())
}

func canonicalSetHash(peers []string) string {
	input := strings.Join(peers, "\n")
	var h uint64 = 0xcbf29ce484222325
	const prime uint64 = 0x100000001b3
	for _, c := range input {
		h ^= uint64(c)
		h = (h * prime) & 0xFFFFFFFFFFFFFFFF
	}
	return fmt.Sprintf("%016x", h)
}

func (g *GossipProtocol) generateMsgID(sender string) string {
	if sender == "" {
		sender = "unknown"
	}
	return fmt.Sprintf("%s-%d-%d", sender, nowMs(), fastRand())
}

var randState uint64 = 0xcafebabe12345678

func fastRand() uint64 {
	// xorshift64
	randState ^= randState << 13
	randState ^= randState >> 7
	randState ^= randState << 17
	return randState
}

func nowMs() int64 { return time.Now().UnixMilli() }

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func safeCall(fn func()) {
	defer func() { recover() }() //nolint:errcheck
	fn()
}
