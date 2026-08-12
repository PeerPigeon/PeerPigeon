package main

import (
	"fmt"
	"log"
	"time"

	"github.com/peerpigeon/peerpigeon-go/pkg/mesh"
)

func main() {
	m := mesh.New(mesh.Config{
		SignalingServer: "wss://peer.ooo/ws",
		SessionID:      "peerpigeon:peerpigeon-app-go",
		MinPeers:       1,
		MaxPeers:       4,
		AutoDiscover:   true,
		AutoConnect:    true,
	})
	m.OnSignalingConnected(func(id string) { log.Println("SIGNALING CONNECTED id=", id) })
	m.OnSignalingDisconnected(func() { log.Println("SIGNALING DISCONNECTED") })
	m.OnSignalingError(func(err error) { log.Println("SIGNALING ERROR", err) })
	m.OnSignalingLog(func(msg string) { fmt.Println("[sig]", msg) })
	m.OnPeerDiscovered(func(id string) { log.Println("PEER DISCOVERED", id) })
	m.OnPeerConnected(func(id string) { log.Println("PEER CONNECTED ✓", id) })
	m.OnPeerDisconnected(func(id string) { log.Println("PEER DISCONNECTED", id) })
	m.Init()
	time.Sleep(30 * time.Second)
}
