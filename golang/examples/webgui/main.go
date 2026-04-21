// Command webgui serves a browser dashboard for a PeerPigeon Go node.
// Open http://localhost:8080 after starting.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/peerpigeon/peerpigeon-go/pkg/gossip"
	"github.com/peerpigeon/peerpigeon-go/pkg/mesh"
	"github.com/peerpigeon/peerpigeon-go/pkg/storage"
)

// ── SSE hub ────────────────────────────────────────────────────────────────

type hub struct {
	mu      sync.Mutex
	clients map[chan string]struct{}
}

func newHub() *hub { return &hub{clients: make(map[chan string]struct{})} }

func (h *hub) subscribe() chan string {
	ch := make(chan string, 64)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *hub) unsubscribe(ch chan string) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
}

func (h *hub) broadcast(eventType string, data interface{}) {
	b, _ := json.Marshal(data)
	msg := fmt.Sprintf("event: %s\ndata: %s\n\n", eventType, b)
	h.mu.Lock()
	for ch := range h.clients {
		select {
		case ch <- msg:
		default:
		}
	}
	h.mu.Unlock()
}

// ── main ───────────────────────────────────────────────────────────────────

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	signalURL := flag.String("signal", "wss://freewebrtc.cloud", "Signaling server WebSocket URL")
	networkID := flag.String("network", "peerpigeon-webgui-go", "Network / session ID")
	flag.Parse()

	h := newHub()

	emit := func(t string, v interface{}) { h.broadcast(t, v) }

	// ── mesh ──────────────────────────────────────────────────────────────
	m := mesh.New(mesh.Config{
		SignalingServer: *signalURL,
		SessionID:       *networkID,
		MinPeers:        2,
		MaxPeers:        6,
		AutoDiscover:    true,
		AutoConnect:     true,
	})

	// ── gossip ────────────────────────────────────────────────────────────
	g := gossip.New(m, gossip.Options{MaxHops: 6})

	// ── storage ───────────────────────────────────────────────────────────
	gs := &gossipAdapter{g}
	store, err := storage.New(storage.Options{
		UserID:     "webgui-user",
		SessionID:  *networkID,
		SyncSecret: "webgui-demo-secret",
		Gossip:     gs,
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := store.Init(); err != nil {
		log.Fatal(err)
	}

	// ── wire events → SSE ─────────────────────────────────────────────────
	m.OnPeerConnected(func(id string) {
		emit("peer_connected", map[string]interface{}{
			"peer": id, "connected": m.GetConnectedPeers(), "ts": nowMs(),
		})
	})
	m.OnPeerDisconnected(func(id string) {
		emit("peer_disconnected", map[string]interface{}{
			"peer": id, "connected": m.GetConnectedPeers(), "ts": nowMs(),
		})
	})
	m.OnSignalingConnected(func(id string) {
		emit("signaling_connected", map[string]interface{}{"clientId": id, "ts": nowMs()})
	})
	m.OnSignalingDisconnected(func() {
		emit("signaling_disconnected", map[string]interface{}{"ts": nowMs()})
	})
	m.OnMeshReady(func() {
		emit("mesh_ready", map[string]interface{}{
			"clientId": m.GetClientID(), "ts": nowMs(),
		})
	})

	g.OnMessageReceived(func(e gossip.MessageReceivedEvent) {
		emit("gossip_message", map[string]interface{}{
			"id": e.Message.ID, "sender": e.Message.Sender,
			"hops": e.Message.Hops, "data": e.Message.Data,
			"local": e.Local, "ts": nowMs(),
		})
	})

	store.OnChange(func(e storage.ChangeEvent) {
		emit("storage_change", map[string]interface{}{
			"origin": e.Origin, "op": e.Op,
			"space": e.Space, "key": e.Key,
			"actor": e.ActorID, "ts": nowMs(),
		})
	})

	// heartbeat ticker
	go func() {
		for range time.NewTicker(3 * time.Second).C {
			emit("heartbeat", map[string]interface{}{
				"clientId":   m.GetClientID(),
				"connected":  m.GetConnectedPeers(),
				"discovered": m.GetDiscoveredPeers(),
				"global":     m.GetGlobalPeers(),
				"ts":         nowMs(),
			})
		}
	}()

	// ── start mesh ────────────────────────────────────────────────────────
	m.Init()

	// ── HTTP handlers ──────────────────────────────────────────────────────
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, indexHTML)
	})

	http.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		ch := h.subscribe()
		defer h.unsubscribe(ch)

		// send initial state
		init, _ := json.Marshal(map[string]interface{}{
			"clientId":   m.GetClientID(),
			"connected":  m.GetConnectedPeers(),
			"discovered": m.GetDiscoveredPeers(),
			"global":     m.GetGlobalPeers(),
			"network":    *networkID,
			"signal":     *signalURL,
			"ts":         nowMs(),
		})
		fmt.Fprintf(w, "event: init\ndata: %s\n\n", init)
		flusher.Flush()

		for {
			select {
			case msg, ok := <-ch:
				if !ok {
					return
				}
				fmt.Fprint(w, msg)
				flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	})

	http.HandleFunc("/broadcast", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		var body struct{ Message string }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Message == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		id := g.Broadcast(body.Message, nil)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"id": id})
	})

	http.HandleFunc("/put", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		var body struct{ Key, Value string }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Key == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		rec, err := store.Put(storage.SpacePublic, body.Key, body.Value)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rec)
	})

	log.Printf("Dashboard → http://localhost%s   (network: %s)", *addr, *networkID)
	log.Fatal(http.ListenAndServe(*addr, nil))
}

func nowMs() int64 { return time.Now().UnixMilli() }

type gossipAdapter struct{ g *gossip.GossipProtocol }

func (a *gossipAdapter) Broadcast(data interface{}, meta map[string]interface{}) string {
	return a.g.Broadcast(data, meta)
}
func (a *gossipAdapter) OnMessageReceived(fn func(interface{}, bool, string)) func() {
	return a.g.OnMessageReceived(func(e gossip.MessageReceivedEvent) {
		fn(e.Message.Data, e.Local, e.FromPeer)
	})
}

// ── embedded HTML ──────────────────────────────────────────────────────────

const indexHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PeerPigeon Go — Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;padding:24px}
  h1{font-size:1.4rem;font-weight:700;color:#7c3aed;margin-bottom:20px;display:flex;align-items:center;gap:10px}
  .dot{width:10px;height:10px;border-radius:50%;background:#374151;display:inline-block;transition:background .3s}
  .dot.on{background:#22c55e;box-shadow:0 0 6px #22c55e}
  .dot.warn{background:#f59e0b}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
  .card{background:#1e2130;border:1px solid #2d3148;border-radius:10px;padding:16px}
  .card h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:10px}
  .stat{font-size:2rem;font-weight:700;color:#a78bfa}
  .id{font-size:.75rem;color:#6b7280;word-break:break-all;margin-top:4px;font-family:monospace}
  ul{list-style:none;padding:0;max-height:180px;overflow-y:auto}
  ul li{font-size:.78rem;padding:4px 6px;border-radius:4px;margin-bottom:2px;background:#12141e;font-family:monospace;display:flex;justify-content:space-between;align-items:center}
  ul li .badge{font-size:.65rem;padding:1px 5px;border-radius:10px;background:#2d3148;color:#7c3aed}
  #log{max-height:280px;overflow-y:auto}
  #log li{border-left:2px solid #2d3148;padding-left:6px}
  #log li.gossip{border-left-color:#7c3aed}
  #log li.storage{border-left-color:#06b6d4}
  #log li.peer{border-left-color:#22c55e}
  #log li.sig{border-left-color:#f59e0b}
  .send-row{display:flex;gap:8px;margin-top:10px}
  input,textarea{background:#12141e;border:1px solid #2d3148;color:#e2e8f0;border-radius:6px;padding:6px 10px;font-size:.82rem;outline:none;width:100%}
  input:focus,textarea:focus{border-color:#7c3aed}
  button{background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:.82rem;white-space:nowrap}
  button:hover{background:#6d28d9}
  .ts{font-size:.65rem;color:#4b5563;margin-left:6px}
  .label{display:inline-block;font-size:.65rem;padding:1px 5px;border-radius:3px;margin-right:4px;background:#2d3148;color:#94a3b8}
</style>
</head>
<body>
<h1><span class="dot" id="dot"></span> PeerPigeon Go — Dashboard</h1>
<div class="grid">

  <div class="card">
    <h2>Node</h2>
    <div class="stat" id="peerCount">0</div>
    <div class="id" id="clientId">connecting…</div>
    <div class="id" style="margin-top:4px" id="networkId"></div>
  </div>

  <div class="card">
    <h2>Connected peers</h2>
    <ul id="connectedList"><li style="color:#4b5563">none</li></ul>
  </div>

  <div class="card">
    <h2>Discovered peers</h2>
    <ul id="discoveredList"><li style="color:#4b5563">none</li></ul>
  </div>

  <div class="card">
    <h2>Broadcast gossip</h2>
    <div class="send-row">
      <input id="msgInput" placeholder="type a message…" />
      <button onclick="sendMsg()">Send</button>
    </div>
  </div>

  <div class="card">
    <h2>Put to public storage</h2>
    <input id="storeKey" placeholder="key" style="margin-bottom:6px" />
    <div class="send-row">
      <input id="storeVal" placeholder="value" />
      <button onclick="putStore()">Put</button>
    </div>
  </div>

</div>

<div class="card" style="margin-top:16px">
  <h2>Event log</h2>
  <ul id="log"></ul>
</div>

<script>
const $ = id => document.getElementById(id);
const dot = $('dot');
let connected = [];

function log(cls, text, ts) {
  const li = document.createElement('li');
  li.className = cls;
  li.innerHTML = text + '<span class="ts">' + new Date(ts).toLocaleTimeString() + '</span>';
  const ul = $('log');
  ul.prepend(li);
  while (ul.children.length > 120) ul.removeChild(ul.lastChild);
}

function renderPeers(list, elId) {
  const ul = $(elId);
  if (!list || list.length === 0) {
    ul.innerHTML = '<li style="color:#4b5563">none</li>';
    return;
  }
  ul.innerHTML = list.map(p =>
    '<li><span>' + p.slice(0,20) + '…</span></li>'
  ).join('');
}

function applyHeartbeat(d) {
  $('clientId').textContent = d.clientId || '(unknown)';
  $('peerCount').textContent = (d.connected || []).length;
  connected = d.connected || [];
  renderPeers(d.connected, 'connectedList');
  renderPeers(d.discovered, 'discoveredList');
}

const es = new EventSource('/events');

es.addEventListener('init', e => {
  const d = JSON.parse(e.data);
  $('networkId').textContent = 'network: ' + d.network + '  ·  ' + d.signal;
  applyHeartbeat(d);
  dot.className = 'dot warn';
  log('sig', '<span class="label">init</span>waiting for signaling…', d.ts);
});

es.addEventListener('heartbeat', e => {
  applyHeartbeat(JSON.parse(e.data));
});

es.addEventListener('signaling_connected', e => {
  const d = JSON.parse(e.data);
  dot.className = 'dot warn';
  $('clientId').textContent = d.clientId || $('clientId').textContent;
  log('sig', '<span class="label">signal</span>connected — id: ' + d.clientId, d.ts);
});

es.addEventListener('signaling_disconnected', e => {
  const d = JSON.parse(e.data);
  dot.className = 'dot';
  log('sig', '<span class="label">signal</span>disconnected', d.ts);
});

es.addEventListener('mesh_ready', e => {
  const d = JSON.parse(e.data);
  dot.className = 'dot on';
  $('clientId').textContent = d.clientId;
  log('sig', '<span class="label">mesh</span>ready — ' + d.clientId, d.ts);
});

es.addEventListener('peer_connected', e => {
  const d = JSON.parse(e.data);
  $('peerCount').textContent = (d.connected || []).length;
  connected = d.connected || [];
  renderPeers(d.connected, 'connectedList');
  log('peer', '<span class="label">+peer</span>' + d.peer.slice(0,28), d.ts);
});

es.addEventListener('peer_disconnected', e => {
  const d = JSON.parse(e.data);
  $('peerCount').textContent = (d.connected || []).length;
  connected = d.connected || [];
  renderPeers(d.connected, 'connectedList');
  log('peer', '<span class="label">-peer</span>' + d.peer.slice(0,28), d.ts);
});

es.addEventListener('gossip_message', e => {
  const d = JSON.parse(e.data);
  const local = d.local ? ' <span class="badge">local</span>' : '';
  log('gossip', '<span class="label">gossip</span>' + JSON.stringify(d.data).slice(0,60) + local, d.ts);
});

es.addEventListener('storage_change', e => {
  const d = JSON.parse(e.data);
  log('storage', '<span class="label">storage</span>[' + d.space + '] ' + d.op + ' ' + d.key, d.ts);
});

es.onerror = () => { dot.className = 'dot'; };

async function sendMsg() {
  const msg = $('msgInput').value.trim();
  if (!msg) return;
  $('msgInput').value = '';
  await fetch('/broadcast', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({Message: msg})
  });
}

async function putStore() {
  const key = $('storeKey').value.trim();
  const val = $('storeVal').value.trim();
  if (!key) return;
  await fetch('/put', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({Key: key, Value: val})
  });
  $('storeVal').value = '';
}

$('msgInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });
$('storeVal').addEventListener('keydown', e => { if (e.key === 'Enter') putStore(); });
</script>
</body>
</html>
`
