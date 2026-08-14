package gossip

import (
	"encoding/json"
	"sync"
	"testing"
	"time"
)

type deliveryTestNetwork struct {
	meshes map[string]*deliveryTestMesh
}

type deliveryTestMesh struct {
	mu                 sync.Mutex
	id                 string
	network            *deliveryTestNetwork
	connected          []string
	global             []string
	dataHandlers       []func(string, []byte)
	connectHandlers    []func(string)
	disconnectHandlers []func(string)
	dropNextGossipTo   string
}

func newDeliveryTestNetwork(ids ...string) *deliveryTestNetwork {
	network := &deliveryTestNetwork{meshes: make(map[string]*deliveryTestMesh)}
	for _, id := range ids {
		mesh := &deliveryTestMesh{id: id, network: network}
		for _, peerID := range ids {
			if peerID != id {
				mesh.global = append(mesh.global, peerID)
			}
		}
		network.meshes[id] = mesh
	}
	return network
}

func (m *deliveryTestMesh) OnPeerData(fn func(string, []byte)) {
	m.dataHandlers = append(m.dataHandlers, fn)
}
func (m *deliveryTestMesh) OnPeerConnected(fn func(string)) {
	m.connectHandlers = append(m.connectHandlers, fn)
}
func (m *deliveryTestMesh) OnPeerDisconnected(fn func(string)) {
	m.disconnectHandlers = append(m.disconnectHandlers, fn)
}
func (m *deliveryTestMesh) GetClientID() string          { return m.id }
func (m *deliveryTestMesh) GetConnectedPeers() []string  { return append([]string(nil), m.connected...) }
func (m *deliveryTestMesh) GetDiscoveredPeers() []string { return append([]string(nil), m.global...) }
func (m *deliveryTestMesh) GetGlobalPeers() []string     { return append([]string(nil), m.global...) }

func (m *deliveryTestMesh) Send(peerID string, data []byte) error {
	m.mu.Lock()
	dropTarget := m.dropNextGossipTo
	if dropTarget == peerID {
		var envelope rawEnvelope
		if json.Unmarshal(data, &envelope) == nil && envelope.Type == "gossip" {
			m.dropNextGossipTo = ""
			m.mu.Unlock()
			return nil
		}
	}
	m.mu.Unlock()
	target := m.network.meshes[peerID]
	if target == nil {
		return nil
	}
	for _, handler := range target.dataHandlers {
		handler(m.id, append([]byte(nil), data...))
	}
	return nil
}

func connectDeliveryTestLine(network *deliveryTestNetwork) {
	network.meshes["01"].connected = []string{"02"}
	network.meshes["02"].connected = []string{"01", "03"}
	network.meshes["03"].connected = []string{"02"}
}

func newDeliveryTestProtocols(network *deliveryTestNetwork) map[string]*GossipProtocol {
	protocols := make(map[string]*GossipProtocol)
	for id, mesh := range network.meshes {
		protocols[id] = New(mesh, Options{
			DeliveryTimeoutMs:        10_000,
			DeliveryRepairDelayMs:    1_000,
			DeliveryRepairIntervalMs: 1_000,
		})
	}
	return protocols
}

func destroyDeliveryTestProtocols(protocols map[string]*GossipProtocol) {
	for _, protocol := range protocols {
		protocol.Destroy()
	}
}

func syncDeliveryReceipts(protocols map[string]*GossipProtocol) {
	protocols["03"].publishCECRState()
	protocols["02"].publishCECRState()
	protocols["01"].publishCECRState()
}

func TestTrackedDeliveryAggregatesReceiptsWithoutAckPackets(t *testing.T) {
	network := newDeliveryTestNetwork("01", "02", "03")
	connectDeliveryTestLine(network)
	protocols := newDeliveryTestProtocols(network)
	defer destroyDeliveryTestProtocols(protocols)

	completed := make(chan DeliveryStatus, 1)
	protocols["01"].OnDeliveryComplete(func(status DeliveryStatus) { completed <- status })
	messageID := protocols["01"].BroadcastReliable("hello", nil, BroadcastOptions{})
	syncDeliveryReceipts(protocols)

	status, ok := protocols["01"].GetDeliveryStatus(messageID)
	if !ok {
		t.Fatal("tracked message status was not retained")
	}
	if !status.Complete || status.DeliveredCount != 2 || status.AudienceCount != 2 {
		t.Fatalf("unexpected delivery status: %+v", status)
	}
	select {
	case event := <-completed:
		if event.MessageID != messageID {
			t.Fatalf("completion event was for %q, want %q", event.MessageID, messageID)
		}
	case <-time.After(time.Second):
		t.Fatal("delivery completion event was not emitted")
	}
}

func TestUntrackedBroadcastHasNoDeliveryState(t *testing.T) {
	network := newDeliveryTestNetwork("01", "02", "03")
	connectDeliveryTestLine(network)
	protocols := newDeliveryTestProtocols(network)
	defer destroyDeliveryTestProtocols(protocols)

	messageID := protocols["01"].Broadcast("untracked", nil)
	if _, ok := protocols["01"].GetDeliveryStatus(messageID); ok {
		t.Fatal("ordinary broadcast unexpectedly created delivery state")
	}
}

func TestTrackedDeliverySupportsNonHexPeerIDs(t *testing.T) {
	network := newDeliveryTestNetwork("node-a", "node-b")
	network.meshes["node-a"].connected = []string{"node-b"}
	network.meshes["node-b"].connected = []string{"node-a"}
	protocols := newDeliveryTestProtocols(network)
	defer destroyDeliveryTestProtocols(protocols)

	messageID := protocols["node-a"].BroadcastReliable("hello", nil, BroadcastOptions{})
	protocols["node-b"].publishCECRState()

	status, ok := protocols["node-a"].GetDeliveryStatus(messageID)
	if !ok || !status.Complete || status.DeliveredCount != 1 {
		t.Fatalf("non-hex receipt fallback did not complete: %+v, found=%t", status, ok)
	}
}

func TestTrackedDeliveryRepairsOneMissedGossip(t *testing.T) {
	network := newDeliveryTestNetwork("01", "02", "03")
	connectDeliveryTestLine(network)
	network.meshes["02"].dropNextGossipTo = "03"
	protocols := newDeliveryTestProtocols(network)
	defer destroyDeliveryTestProtocols(protocols)
	leakedDirect := make(chan struct{}, 1)
	protocols["03"].OnDirectMessageReceived(func(DirectMessageReceivedEvent) { leakedDirect <- struct{}{} })

	messageID := protocols["01"].BroadcastReliable("repair-me", nil, BroadcastOptions{})
	protocols["02"].publishCECRState()

	for _, protocol := range protocols {
		protocol.mu.Lock()
		if state := protocol.deliveryStates[messageID]; state != nil {
			state.createdAt = nowMs() - 2_000
		}
		protocol.mu.Unlock()
		protocol.maintainTrackedDeliveries()
	}
	syncDeliveryReceipts(protocols)

	status, ok := protocols["01"].GetDeliveryStatus(messageID)
	if !ok || !status.Complete || status.DeliveredCount != 2 {
		t.Fatalf("repair did not complete tracked delivery: %+v, found=%t", status, ok)
	}
	select {
	case <-leakedDirect:
		t.Fatal("repair envelope leaked through the direct-message callback")
	default:
	}
}

func TestTrackedDeliveryTimeout(t *testing.T) {
	network := newDeliveryTestNetwork("01", "02", "03")
	network.meshes["01"].connected = []string{"02"}
	network.meshes["02"].connected = []string{"01"}
	protocols := newDeliveryTestProtocols(network)
	defer destroyDeliveryTestProtocols(protocols)

	timedOut := make(chan DeliveryStatus, 1)
	protocols["01"].OnDeliveryTimeout(func(status DeliveryStatus) { timedOut <- status })
	messageID := protocols["01"].BroadcastReliable("timeout", nil, BroadcastOptions{})
	protocols["02"].publishCECRState()

	protocols["01"].mu.Lock()
	protocols["01"].deliveryStates[messageID].deadlineAt = nowMs() - 1
	protocols["01"].mu.Unlock()
	protocols["01"].maintainTrackedDeliveries()

	select {
	case status := <-timedOut:
		if !status.TimedOut || status.Complete || len(status.PendingPeerIDs) != 1 || status.PendingPeerIDs[0] != "03" {
			t.Fatalf("unexpected timeout status: %+v", status)
		}
	case <-time.After(time.Second):
		t.Fatal("delivery timeout event was not emitted")
	}
}
