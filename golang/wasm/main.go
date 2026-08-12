//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"syscall/js"

	"github.com/peerpigeon/peerpigeon-go/pkg/gossip"
	"github.com/peerpigeon/peerpigeon-go/pkg/storage"
)

type jsMesh struct {
	mu                 sync.RWMutex
	bridge             js.Value
	clientID           string
	connectedPeers     map[string]struct{}
	discoveredPeers    map[string]struct{}
	globalPeers        map[string]struct{}
	onPeerData         []func(string, []byte)
	onPeerConnected    []func(string)
	onPeerDisconnected []func(string)
}

func newJSMesh(bridge js.Value) *jsMesh {
	return &jsMesh{
		bridge:          bridge,
		connectedPeers:  make(map[string]struct{}),
		discoveredPeers: make(map[string]struct{}),
		globalPeers:     make(map[string]struct{}),
	}
}

func (m *jsMesh) OnPeerData(fn func(peerID string, data []byte)) {
	m.mu.Lock()
	m.onPeerData = append(m.onPeerData, fn)
	m.mu.Unlock()
}

func (m *jsMesh) OnPeerConnected(fn func(peerID string)) {
	m.mu.Lock()
	m.onPeerConnected = append(m.onPeerConnected, fn)
	m.mu.Unlock()
}

func (m *jsMesh) OnPeerDisconnected(fn func(peerID string)) {
	m.mu.Lock()
	m.onPeerDisconnected = append(m.onPeerDisconnected, fn)
	m.mu.Unlock()
}

func (m *jsMesh) GetClientID() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.clientID
}

func (m *jsMesh) GetConnectedPeers() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return mapKeys(m.connectedPeers)
}

func (m *jsMesh) GetDiscoveredPeers() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return mapKeys(m.discoveredPeers)
}

func (m *jsMesh) GetGlobalPeers() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.globalPeers) == 0 {
		peers := make(map[string]struct{}, len(m.connectedPeers)+len(m.discoveredPeers))
		for p := range m.connectedPeers {
			peers[p] = struct{}{}
		}
		for p := range m.discoveredPeers {
			peers[p] = struct{}{}
		}
		return mapKeys(peers)
	}
	return mapKeys(m.globalPeers)
}

func (m *jsMesh) Send(peerID string, data []byte) error {
	if !m.bridge.Truthy() {
		return fmt.Errorf("wasm bridge missing")
	}
	sendFn := m.bridge.Get("send")
	if sendFn.Type() != js.TypeFunction {
		return fmt.Errorf("wasm bridge.send is not a function")
	}
	sendFn.Invoke(peerID, bytesToUint8Array(data))
	return nil
}

func (m *jsMesh) setClientID(id string) {
	m.mu.Lock()
	m.clientID = id
	m.mu.Unlock()
}

func (m *jsMesh) setConnectedPeers(peers []string) {
	m.mu.Lock()
	m.connectedPeers = makeStringSet(peers)
	m.mu.Unlock()
}

func (m *jsMesh) setDiscoveredPeers(peers []string) {
	m.mu.Lock()
	m.discoveredPeers = makeStringSet(peers)
	m.mu.Unlock()
}

func (m *jsMesh) setGlobalPeers(peers []string) {
	m.mu.Lock()
	m.globalPeers = makeStringSet(peers)
	m.mu.Unlock()
}

func (m *jsMesh) handlePeerData(peerID string, data []byte) {
	m.mu.RLock()
	handlers := append([]func(string, []byte){}, m.onPeerData...)
	m.mu.RUnlock()
	for _, h := range handlers {
		h(peerID, data)
	}
}

func (m *jsMesh) handlePeerConnected(peerID string) {
	m.mu.RLock()
	handlers := append([]func(string){}, m.onPeerConnected...)
	m.mu.RUnlock()
	for _, h := range handlers {
		h(peerID)
	}
}

func (m *jsMesh) handlePeerDisconnected(peerID string) {
	m.mu.RLock()
	handlers := append([]func(string){}, m.onPeerDisconnected...)
	m.mu.RUnlock()
	for _, h := range handlers {
		h(peerID)
	}
}

type gossipAdapter struct{ g *gossip.GossipProtocol }

func (a *gossipAdapter) Broadcast(data interface{}, metadata map[string]interface{}) string {
	return a.g.Broadcast(data, metadata)
}

func (a *gossipAdapter) OnMessageReceived(fn func(data interface{}, local bool, fromPeer string)) func() {
	return a.g.OnMessageReceived(func(e gossip.MessageReceivedEvent) {
		fn(e.Message.Data, e.Local, e.FromPeer)
	})
}

type wasmNode struct {
	id           int
	mesh         *jsMesh
	gossip       *gossip.GossipProtocol
	storage      *storage.PeerPigeonStorage
	bridge       js.Value
	storageUnsub func()
}

func (n *wasmNode) close() {
	if n.storageUnsub != nil {
		n.storageUnsub()
		n.storageUnsub = nil
	}
	if n.storage != nil {
		n.storage.Close()
		n.storage = nil
	}
	if n.gossip != nil {
		n.gossip.Destroy()
		n.gossip = nil
	}
}

var (
	nodesMu    sync.Mutex
	nodes      = make(map[int]*wasmNode)
	nextNodeID = 1
	registered []js.Func
)

func main() {
	register("peerpigeonCreateNode", jsCreateNode)
	register("peerpigeonDestroyNode", jsDestroyNode)
	register("peerpigeonBroadcast", jsBroadcast)
	register("peerpigeonSendDirect", jsSendDirect)
	register("peerpigeonStoragePut", jsStoragePut)
	register("peerpigeonStorageGet", jsStorageGet)
	register("peerpigeonStorageList", jsStorageList)
	register("peerpigeonStorageRetrieve", jsStorageRetrieve)
	register("peerpigeonStorageSubscribe", jsStorageSubscribe)
	register("peerpigeonStorageUnsubscribe", jsStorageUnsubscribe)
	register("peerpigeonStorageDelete", jsStorageDelete)
	register("peerpigeonSetClientID", jsSetClientID)
	register("peerpigeonSetConnectedPeers", jsSetConnectedPeers)
	register("peerpigeonSetDiscoveredPeers", jsSetDiscoveredPeers)
	register("peerpigeonSetGlobalPeers", jsSetGlobalPeers)
	register("peerpigeonHandlePeerConnected", jsHandlePeerConnected)
	register("peerpigeonHandlePeerDisconnected", jsHandlePeerDisconnected)
	register("peerpigeonHandlePeerData", jsHandlePeerData)

	js.Global().Get("console").Call("info", "peerpigeon wasm runtime ready")
	select {}
}

func register(name string, fn func(js.Value, []js.Value) interface{}) {
	wrapped := js.FuncOf(fn)
	registered = append(registered, wrapped)
	js.Global().Set(name, wrapped)
}

func jsCreateNode(_ js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return jsError("peerpigeonCreateNode(config, bridge) expects 2 arguments")
	}
	cfg := args[0]
	bridge := args[1]
	if !bridge.Truthy() {
		return jsError("bridge is required")
	}

	mesh := newJSMesh(bridge)
	if id := stringsOrEmpty(cfg.Get("clientId")); id != "" {
		mesh.setClientID(id)
	}

	maxHops := intOrDefault(cfg.Get("maxHops"), 6)
	g := gossip.New(mesh, gossip.Options{MaxHops: maxHops})
	ga := &gossipAdapter{g: g}

	uID := stringsOrEmpty(cfg.Get("userId"))
	if uID == "" {
		uID = "wasm-user"
	}
	sID := stringsOrEmpty(cfg.Get("sessionId"))
	if sID == "" {
		sID = "peerpigeon:wasm"
	}

	st, err := storage.New(storage.Options{
		UserID:     uID,
		PeerID:     stringsOrEmpty(cfg.Get("clientId")),
		SessionID:  sID,
		SyncSecret: stringsOrEmpty(cfg.Get("syncSecret")),
		Gossip:     ga,
	})
	if err != nil {
		g.Destroy()
		return jsError(err.Error())
	}
	if err := st.Init(); err != nil {
		st.Close()
		g.Destroy()
		return jsError(err.Error())
	}

	node := &wasmNode{mesh: mesh, gossip: g, storage: st, bridge: bridge}
	node.storageUnsub = st.OnChange(func(ev storage.ChangeEvent) {
		notifyBridgeEvent(node.bridge, "onStorageChange", map[string]interface{}{
			"origin":  string(ev.Origin),
			"op":      ev.Op,
			"space":   string(ev.Space),
			"key":     ev.Key,
			"actorId": ev.ActorID,
		})
	})

	g.OnMessageReceived(func(ev gossip.MessageReceivedEvent) {
		notifyBridgeEvent(node.bridge, "onMessageReceived", map[string]interface{}{
			"fromPeer": ev.FromPeer,
			"local":    ev.Local,
			"hops":     ev.Message.Hops,
			"sender":   ev.Message.Sender,
			"data":     ev.Message.Data,
		})
	})
	g.OnDirectMessageReceived(func(ev gossip.DirectMessageReceivedEvent) {
		notifyBridgeEvent(node.bridge, "onDirectMessageReceived", map[string]interface{}{
			"message": map[string]interface{}{
				"id":        ev.Message.ID,
				"from":      ev.Message.From,
				"to":        ev.Message.To,
				"data":      ev.Message.Data,
				"hops":      ev.Message.Hops,
				"maxHops":   ev.Message.MaxHops,
				"timestamp": ev.Message.Timestamp,
			},
		})
	})

	nodesMu.Lock()
	node.id = nextNodeID
	nodes[node.id] = node
	nextNodeID++
	nodesMu.Unlock()
	return node.id
}

func jsDestroyNode(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok {
		return jsError("peerpigeonDestroyNode(nodeId) expects a valid nodeId")
	}
	nodesMu.Lock()
	delete(nodes, n.id)
	nodesMu.Unlock()
	n.close()
	return nil
}

func jsBroadcast(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 2 {
		return jsError("peerpigeonBroadcast(nodeId, data, metadata?) expects at least 2 arguments")
	}
	var metadata map[string]interface{}
	if len(args) >= 3 {
		if m, ok := jsValueToAny(args[2]).(map[string]interface{}); ok {
			metadata = m
		}
	}
	msgID := n.gossip.Broadcast(jsValueToAny(args[1]), metadata)
	return msgID
}

func jsSendDirect(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 3 {
		return jsError("peerpigeonSendDirect(nodeId, peerId, data) expects 3 arguments")
	}
	peerID := stringsOrEmpty(args[1])
	if peerID == "" {
		return jsError("peerId is required")
	}
	msgID := n.gossip.SendDirect(peerID, jsValueToAny(args[2]))
	return msgID
}

func jsStoragePut(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 4 {
		return jsError("peerpigeonStoragePut(nodeId, space, key, value) expects 4 arguments")
	}
	space := storage.Space(stringsOrEmpty(args[1]))
	key := stringsOrEmpty(args[2])
	if key == "" {
		return jsError("storage key is required")
	}
	var (
		rec *storage.Record
		err error
	)
	if space == storage.SpaceEPublic {
		rec, err = n.storage.PutSystem(space, key, jsValueToAny(args[3]))
	} else {
		rec, err = n.storage.Put(space, key, jsValueToAny(args[3]))
	}
	if err != nil {
		return jsError(err.Error())
	}
	return toJSObject(map[string]interface{}{
		"space":      string(rec.Space),
		"key":        rec.Key,
		"ownerId":    rec.OwnerID,
		"modifiedBy": rec.ModifiedBy,
		"value":      rec.Value,
		"createdAt":  rec.CreatedAt,
		"updatedAt":  rec.UpdatedAt,
		"version":    rec.Version,
	})
}

func jsStorageGet(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 3 {
		return jsError("peerpigeonStorageGet(nodeId, space, key) expects 3 arguments")
	}
	space := storage.Space(stringsOrEmpty(args[1]))
	key := stringsOrEmpty(args[2])
	rec, err := n.storage.Get(space, key)
	if err != nil {
		return jsError(err.Error())
	}
	if rec == nil {
		return js.Null()
	}
	return toJSObject(map[string]interface{}{
		"space":      string(rec.Space),
		"key":        rec.Key,
		"ownerId":    rec.OwnerID,
		"modifiedBy": rec.ModifiedBy,
		"value":      rec.Value,
		"createdAt":  rec.CreatedAt,
		"updatedAt":  rec.UpdatedAt,
		"version":    rec.Version,
	})
}

func jsStorageList(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 2 {
		return jsError("peerpigeonStorageList(nodeId, space) expects 2 arguments")
	}
	space := storage.Space(stringsOrEmpty(args[1]))
	recs, err := n.storage.List(space)
	if err != nil {
		return jsError(err.Error())
	}
	out := make([]map[string]interface{}, 0, len(recs))
	for _, rec := range recs {
		if rec == nil {
			continue
		}
		out = append(out, map[string]interface{}{
			"space":      string(rec.Space),
			"key":        rec.Key,
			"ownerId":    rec.OwnerID,
			"modifiedBy": rec.ModifiedBy,
			"value":      rec.Value,
			"createdAt":  rec.CreatedAt,
			"updatedAt":  rec.UpdatedAt,
			"version":    rec.Version,
		})
	}
	return toJSObject(out)
}

func jsStorageRetrieve(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 3 {
		return jsError("peerpigeonStorageRetrieve(nodeId, space, key, options?) expects at least 3 arguments")
	}
	space := storage.Space(stringsOrEmpty(args[1]))
	key := stringsOrEmpty(args[2])
	if key == "" {
		return jsError("storage key is required")
	}
	opts := storage.RetrieveOptions{TimeoutMs: 2500}
	if len(args) >= 4 {
		optsVal := args[3]
		if optsVal.Truthy() {
			timeout := optsVal.Get("timeoutMs")
			if timeout.Truthy() && timeout.Type() == js.TypeNumber {
				opts.TimeoutMs = int64(timeout.Int())
			}
		}
	}
	// Return local value immediately and perform network retrieval in background.
	// Blocking here can freeze the browser main thread in wasm mode.
	rec, err := n.storage.Get(space, key)
	if err != nil {
		return jsError(err.Error())
	}

	go func(node *wasmNode, sp storage.Space, k string, ro storage.RetrieveOptions) {
		_, _ = node.storage.Retrieve(sp, k, ro)
	}(n, space, key, opts)

	if rec == nil {
		return js.Null()
	}
	return toJSObject(map[string]interface{}{
		"space":      string(rec.Space),
		"key":        rec.Key,
		"ownerId":    rec.OwnerID,
		"modifiedBy": rec.ModifiedBy,
		"value":      rec.Value,
		"createdAt":  rec.CreatedAt,
		"updatedAt":  rec.UpdatedAt,
		"version":    rec.Version,
	})
}

func jsStorageSubscribe(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 3 {
		return jsError("peerpigeonStorageSubscribe(nodeId, space, key) expects 3 arguments")
	}
	n.storage.SubscribeKey(storage.Space(stringsOrEmpty(args[1])), stringsOrEmpty(args[2]))
	return nil
}

func jsStorageUnsubscribe(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 3 {
		return jsError("peerpigeonStorageUnsubscribe(nodeId, space, key) expects 3 arguments")
	}
	n.storage.UnsubscribeKey(storage.Space(stringsOrEmpty(args[1])), stringsOrEmpty(args[2]))
	return nil
}

func jsStorageDelete(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 3 {
		return jsError("peerpigeonStorageDelete(nodeId, space, key) expects 3 arguments")
	}
	space := storage.Space(stringsOrEmpty(args[1]))
	key := stringsOrEmpty(args[2])
	var err error
	if space == storage.SpaceEPublic {
		_, err = n.storage.DeleteSystem(space, key)
	} else {
		_, err = n.storage.Delete(space, key)
	}
	if err != nil {
		return jsError(err.Error())
	}
	return nil
}

func jsSetClientID(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 2 {
		return jsError("peerpigeonSetClientID(nodeId, clientId) expects 2 arguments")
	}
	peerID := stringsOrEmpty(args[1])
	n.mesh.setClientID(peerID)
	n.storage.SetPeerID(peerID)
	return nil
}

func jsSetConnectedPeers(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 2 {
		return jsError("peerpigeonSetConnectedPeers(nodeId, peers[]) expects 2 arguments")
	}
	n.mesh.setConnectedPeers(jsArrayToStrings(args[1]))
	return nil
}

func jsSetDiscoveredPeers(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 2 {
		return jsError("peerpigeonSetDiscoveredPeers(nodeId, peers[]) expects 2 arguments")
	}
	n.mesh.setDiscoveredPeers(jsArrayToStrings(args[1]))
	return nil
}

func jsSetGlobalPeers(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 2 {
		return jsError("peerpigeonSetGlobalPeers(nodeId, peers[]) expects 2 arguments")
	}
	n.mesh.setGlobalPeers(jsArrayToStrings(args[1]))
	return nil
}

func jsHandlePeerConnected(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 2 {
		return jsError("peerpigeonHandlePeerConnected(nodeId, peerId) expects 2 arguments")
	}
	n.mesh.handlePeerConnected(stringsOrEmpty(args[1]))
	return nil
}

func jsHandlePeerDisconnected(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 2 {
		return jsError("peerpigeonHandlePeerDisconnected(nodeId, peerId) expects 2 arguments")
	}
	n.mesh.handlePeerDisconnected(stringsOrEmpty(args[1]))
	return nil
}

func jsHandlePeerData(_ js.Value, args []js.Value) interface{} {
	n, ok := getNodeArg(args)
	if !ok || len(args) < 3 {
		return jsError("peerpigeonHandlePeerData(nodeId, peerId, data) expects 3 arguments")
	}
	peerID := stringsOrEmpty(args[1])
	payload := uint8ArrayToBytes(args[2])
	n.mesh.handlePeerData(peerID, payload)
	return nil
}

func getNodeArg(args []js.Value) (*wasmNode, bool) {
	if len(args) == 0 {
		return nil, false
	}
	nodeID := args[0].Int()
	nodesMu.Lock()
	defer nodesMu.Unlock()
	n, ok := nodes[nodeID]
	return n, ok
}

func stringsOrEmpty(v js.Value) string {
	if !v.Truthy() {
		return ""
	}
	if v.Type() == js.TypeString {
		return v.String()
	}
	if v.Type() == js.TypeNumber || v.Type() == js.TypeBoolean {
		return v.String()
	}
	return ""
}

func intOrDefault(v js.Value, def int) int {
	if !v.Truthy() {
		return def
	}
	if v.Type() == js.TypeNumber {
		return v.Int()
	}
	return def
}

func jsValueToAny(v js.Value) interface{} {
	if !v.Truthy() {
		return nil
	}
	switch v.Type() {
	case js.TypeString:
		return v.String()
	case js.TypeBoolean:
		return v.Bool()
	case js.TypeNumber:
		return v.Float()
	case js.TypeObject:
		jsonVal := js.Global().Get("JSON")
		if jsonVal.Type() == js.TypeObject {
			str := jsonVal.Call("stringify", v).String()
			var out interface{}
			if err := json.Unmarshal([]byte(str), &out); err == nil {
				return out
			}
		}
		return v.String()
	default:
		return v.String()
	}
}

func jsArrayToStrings(v js.Value) []string {
	if !v.Truthy() {
		return nil
	}
	length := v.Length()
	out := make([]string, 0, length)
	for i := 0; i < length; i++ {
		s := stringsOrEmpty(v.Index(i))
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

func makeStringSet(values []string) map[string]struct{} {
	out := make(map[string]struct{}, len(values))
	for _, v := range values {
		if v == "" {
			continue
		}
		out[v] = struct{}{}
	}
	return out
}

func mapKeys(set map[string]struct{}) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	return out
}

func uint8ArrayToBytes(v js.Value) []byte {
	if !v.Truthy() {
		return nil
	}
	buf := make([]byte, v.Get("byteLength").Int())
	js.CopyBytesToGo(buf, v)
	return buf
}

func bytesToUint8Array(b []byte) js.Value {
	arr := js.Global().Get("Uint8Array").New(len(b))
	if len(b) > 0 {
		js.CopyBytesToJS(arr, b)
	}
	return arr
}

func notifyBridgeEvent(bridge js.Value, fnName string, payload map[string]interface{}) {
	if !bridge.Truthy() {
		return
	}
	fn := bridge.Get(fnName)
	if fn.Type() != js.TypeFunction {
		return
	}
	fn.Invoke(toJSObject(payload))
}

func toJSObject(v interface{}) js.Value {
	jsonVal := js.Global().Get("JSON")
	if jsonVal.Type() != js.TypeObject {
		return js.Null()
	}
	bytes, err := json.Marshal(v)
	if err != nil {
		return js.Null()
	}
	return jsonVal.Call("parse", string(bytes))
}

func jsError(message string) interface{} {
	return js.Global().Get("Error").New(message)
}
