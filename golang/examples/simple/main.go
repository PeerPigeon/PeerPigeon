// -network my-network \
// -peer my-unique-peer-id
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/peerpigeon/peerpigeon-go/pkg/gossip"
	"github.com/peerpigeon/peerpigeon-go/pkg/mesh"
	"github.com/peerpigeon/peerpigeon-go/pkg/storage"
)

func main() {
	signalURL := flag.String("signal", "wss://freewebrtc.cloud", "Signaling server WebSocket URL")
	networkID := flag.String("network", "peerpigeon-example-go", "Network / session ID")
	peerID := flag.String("peer", "", "Unique peer ID (hex string, random if empty)")
	flag.Parse()

	// ── mesh ──────────────────────────────────────────────────────────────
	m := mesh.New(mesh.Config{
		SignalingServer: *signalURL,
		SessionID:       *networkID,
		MinPeers:        2,
		MaxPeers:        6,
		AutoDiscover:    true,
		AutoConnect:     true,
	})

	if *peerID != "" {
		// If the library supports setting a custom ID, do so here.
		// The current implementation assigns IDs via signaling;
		// passing a non-empty peer here logs it for info only.
		log.Printf("Preferred peer ID: %s (actual ID assigned by signaling server)", *peerID)
	}

	// ── gossip ────────────────────────────────────────────────────────────
	g := gossip.New(m, gossip.Options{
		MaxHops:              6,
		CECRCoordinateWeight: 0.35,
	})

	g.OnMessageReceived(func(e gossip.MessageReceivedEvent) {
		log.Printf("[gossip] message %s from %s (hops=%d local=%v): %v",
			e.Message.ID, e.Message.Sender, e.Message.Hops, e.Local, e.Message.Data)
	})
	g.OnDirectMessageReceived(func(e gossip.DirectMessageReceivedEvent) {
		log.Printf("[gossip] direct message %s from %s: %v",
			e.Message.ID, e.Message.From, e.Message.Data)
	})

	// ── storage ───────────────────────────────────────────────────────────
	// GossipWrapper adapts *gossip.GossipProtocol to storage.GossipInterface.
	gs := &gossipStorage{g}
	store, err := storage.New(storage.Options{
		UserID:     "go-example-user",
		SessionID:  *networkID,
		SyncSecret: "example-secret-change-me",
		Gossip:     gs,
	})
	if err != nil {
		log.Fatalf("create storage: %v", err)
	}
	if err := store.Init(); err != nil {
		log.Fatalf("init storage: %v", err)
	}

	store.OnChange(func(e storage.ChangeEvent) {
		log.Printf("[storage] change origin=%s op=%s space=%s key=%s actor=%s",
			e.Origin, e.Op, e.Space, e.Key, e.ActorID)
	})

	// ── mesh events ───────────────────────────────────────────────────────
	m.OnPeerConnected(func(id string) {
		log.Printf("[mesh] peer connected: %s (total=%d)", id, len(m.GetConnectedPeers()))
	})
	m.OnPeerDisconnected(func(id string) {
		log.Printf("[mesh] peer disconnected: %s", id)
	})
	m.OnPeerData(func(id string, data []byte) {
		log.Printf("[mesh] raw data from %s: %d bytes", id, len(data))
	})

	// ── start ─────────────────────────────────────────────────────────────
	log.Println("Initializing mesh…")
	m.Init()
	log.Printf("Client ID: %s", m.GetClientID())

	// Demo: write to public space every 10 seconds.
	go func() {
		for i := 0; ; i++ {
			time.Sleep(10 * time.Second)
			_, err := store.Put(storage.SpacePublic, "heartbeat", map[string]interface{}{
				"from":  m.GetClientID(),
				"count": i,
				"at":    time.Now().UTC().Format(time.RFC3339),
			})
			if err != nil {
				log.Printf("put heartbeat: %v", err)
			}
			_ = g.Broadcast(fmt.Sprintf("hello from %s #%d", m.GetClientID(), i), nil)
		}
	}()

	// ── block until signal ────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down…")
	store.Close()
	g.Destroy()
	m.Destroy()
}

// gossipStorage adapts *gossip.GossipProtocol to storage.GossipInterface.
type gossipStorage struct {
	g *gossip.GossipProtocol
}

func (a *gossipStorage) Broadcast(data interface{}, metadata map[string]interface{}) string {
	return a.g.Broadcast(data, metadata)
}

func (a *gossipStorage) OnMessageReceived(fn func(data interface{}, local bool, fromPeer string)) func() {
	return a.g.OnMessageReceived(func(e gossip.MessageReceivedEvent) {
		fn(e.Message.Data, e.Local, e.FromPeer)
	})
}
