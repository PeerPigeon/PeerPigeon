// Package gossip implements the epidemic gossip broadcast protocol and
// coordinate-enhanced XOR-routed direct messaging.
// It is a faithful Go port of src/gossip.ts.
package gossip

import (
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"sync"
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
	CECRDisableConsensus bool
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
	ID        string `json:"id"`
	Type      string `json:"type"` // "cecr-state"
	From      string `json:"from"`
	Timestamp int64  `json:"timestamp"`
	SetHash   string `json:"setHash"`
	MinHex    string `json:"minHex"`
	MaxHex    string `json:"maxHex"`
	Size      int    `json:"size"`
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
	mesh            MeshLike
	maxHops         int
	maxDirectHops   int
	cecrCW          float64
	cecrMaxAgeMs    int64
	cecrMaxDrift    float64
	cecrConsensus   bool

	mu              sync.Mutex
	messageLog      map[string]msgLogEntry // id → entry
	seenDirectIDs   map[string]struct{}
	peers           map[string]int64 // peerID → connectedAtMs
	cecrCurrent     *cecrExtrema
	cecrPrevious    *cecrExtrema
	cecrRemote      map[string]*cecrRemoteState

	syncTicker *time.Ticker
	syncDone   chan struct{}

	// callbacks
	onMsgReceived  []func(MessageReceivedEvent)
	onPeerConn     []func(string)
	onPeerDisconn  []func(string)
	onDirectMsg    []func(DirectMessageReceivedEvent)
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
	g := &GossipProtocol{
		mesh:          mesh,
		maxHops:       opts.MaxHops,
		maxDirectHops: opts.MaxDirectHops,
		cecrCW:        clamp01(opts.CECRCoordinateWeight),
		cecrMaxAgeMs:  max64(1_000, opts.CECRExtremaMaxAgeMs),
		cecrMaxDrift:  clamp01(opts.CECRMaxAcceptedDrift),
		cecrConsensus: !opts.CECRDisableConsensus, // default true
		messageLog:    make(map[string]msgLogEntry),
		seenDirectIDs: make(map[string]struct{}),
		peers:         make(map[string]int64),
		cecrRemote:    make(map[string]*cecrRemoteState),
		syncDone:      make(chan struct{}),
	}
	g.setupListeners()
	g.startSyncLoop()
	return g
}

// ── event registration ─────────────────────────────────────────────────────

// OnMessageReceived registers a handler for received gossip broadcasts.
// Returns an unsubscribe function.
func (g *GossipProtocol) OnMessageReceived(fn func(MessageReceivedEvent)) func() {
	g.mu.Lock()
	g.onMsgReceived = append(g.onMsgReceived, fn)
	g.mu.Unlock()
	return func() {
		g.mu.Lock()
		for i, h := range g.onMsgReceived {
			if &h == &fn {
				g.onMsgReceived = append(g.onMsgReceived[:i], g.onMsgReceived[i+1:]...)
				break
			}
		}
		g.mu.Unlock()
	}
}

// OnPeerConnected registers a handler for peer connection events.
func (g *GossipProtocol) OnPeerConnected(fn func(string)) {
	g.mu.Lock(); g.onPeerConn = append(g.onPeerConn, fn); g.mu.Unlock()
}

// OnPeerDisconnected registers a handler for peer disconnection events.
func (g *GossipProtocol) OnPeerDisconnected(fn func(string)) {
	g.mu.Lock(); g.onPeerDisconn = append(g.onPeerDisconn, fn); g.mu.Unlock()
}

// OnDirectMessageReceived registers a handler for direct messages addressed to this peer.
func (g *GossipProtocol) OnDirectMessageReceived(fn func(DirectMessageReceivedEvent)) {
	g.mu.Lock(); g.onDirectMsg = append(g.onDirectMsg, fn); g.mu.Unlock()
}

// ── public API ─────────────────────────────────────────────────────────────

// Broadcast sends data to all peers in the mesh via gossip propagation.
// Returns the generated message ID.
func (g *GossipProtocol) Broadcast(data interface{}, metadata map[string]interface{}) string {
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

	msg := Message{
		ID:        g.generateMsgID(sender),
		Timestamp: nowMs(),
		Hops:      0,
		MaxHops:   maxHops,
		Sender:    sender,
		Data:      data,
		Metadata:  metadata,
		Type:      "gossip",
	}

	g.mu.Lock()
	g.messageLog[msg.ID] = msgLogEntry{timestamp: msg.Timestamp, sender: msg.Sender, hops: 0}
	g.mu.Unlock()

	g.propagate(msg, "")
	g.fireMessageReceived(MessageReceivedEvent{Message: msg, Local: true})
	return msg.ID
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
	g.seenDirectIDs[msg.ID] = struct{}{}
	g.mu.Unlock()
	g.routeDirect(msg, "")
	return msg.ID
}

// Cleanup removes message log entries older than maxAgeMs.
func (g *GossipProtocol) Cleanup(maxAgeMs int64) {
	now := nowMs()
	g.mu.Lock()
	for id, entry := range g.messageLog {
		if now-entry.timestamp > maxAgeMs {
			delete(g.messageLog, id)
		}
	}
	g.mu.Unlock()
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
	g.seenDirectIDs = make(map[string]struct{})
	g.cecrRemote = make(map[string]*cecrRemoteState)
	g.onMsgReceived = nil
	g.onPeerConn = nil
	g.onPeerDisconn = nil
	g.onDirectMsg = nil
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
	ticker := time.NewTicker(2 * time.Second)
	g.syncTicker = ticker
	go func() {
		for {
			select {
			case <-ticker.C:
				g.publishCECRState()
			case <-g.syncDone:
				return
			}
		}
	}()
}

// ── internal: propagation ──────────────────────────────────────────────────

func (g *GossipProtocol) propagate(msg Message, exceptPeerID string) {
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

// ── internal: direct message routing ──────────────────────────────────────

func (g *GossipProtocol) routeDirect(msg DirectMessage, fromPeerID string) {
	self := g.mesh.GetClientID()

	if msg.To == self {
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
	g.seenDirectIDs[msg.ID] = struct{}{}
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
	if ext == nil {
		return
	}
	msg := cecrStateMsg{
		ID:        g.generateMsgID(self),
		Type:      "cecr-state",
		From:      self,
		Timestamp: nowMs(),
		SetHash:   ext.setHash,
		MinHex:    fmt.Sprintf("%x", ext.min),
		MaxHex:    fmt.Sprintf("%x", ext.max),
		Size:      ext.size,
	}
	data, _ := json.Marshal(msg)
	for _, id := range g.mesh.GetConnectedPeers() {
		_ = g.mesh.Send(id, data)
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
	bestScore := float64(1<<62)
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
	g.mu.Lock(); cbs := append(([]func(MessageReceivedEvent))(nil), g.onMsgReceived...); g.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(e) }) }
}
func (g *GossipProtocol) firePeerConnected(id string) {
	g.mu.Lock(); cbs := append(([]func(string))(nil), g.onPeerConn...); g.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(id) }) }
}
func (g *GossipProtocol) firePeerDisconnected(id string) {
	g.mu.Lock(); cbs := append(([]func(string))(nil), g.onPeerDisconn...); g.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(id) }) }
}
func (g *GossipProtocol) fireDirectMessageReceived(e DirectMessageReceivedEvent) {
	g.mu.Lock(); cbs := append(([]func(DirectMessageReceivedEvent))(nil), g.onDirectMsg...); g.mu.Unlock()
	for _, fn := range cbs { safeCall(func() { fn(e) }) }
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
