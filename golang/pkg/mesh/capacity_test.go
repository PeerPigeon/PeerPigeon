package mesh

import (
	"reflect"
	"sort"
	"testing"
)

func TestMixedCapacityCandidatesPrioritizeScarceUnderfilledPeers(t *testing.T) {
	m := New(Config{MinPeers: 1, MaxPeers: 20, TolerantPeers: 3})
	now := nowMs()

	m.mu.Lock()
	m.clientID = "self"
	m.peerCapacityByID["low"] = peerCapacityAdvertisement{
		maxPeers: 2, connectedPeers: 1, updatedAt: now,
	}
	m.peerCapacityByID["high"] = peerCapacityAdvertisement{
		maxPeers: 20, connectedPeers: 1, updatedAt: now,
	}
	m.peerCapacityByID["full"] = peerCapacityAdvertisement{
		maxPeers: 2, connectedPeers: 2, updatedAt: now,
	}
	candidates := []string{"unknown", "full", "high", "low"}
	sort.Slice(candidates, func(i, j int) bool {
		return m.compareDialCandidatesLocked(candidates[i], candidates[j], now) < 0
	})
	m.mu.Unlock()

	want := []string{"low", "high", "unknown", "full"}
	if !reflect.DeepEqual(candidates, want) {
		t.Fatalf("capacity-prioritized candidates = %v, want %v", candidates, want)
	}
}

func TestMembershipCapacityAdvertisementIsBackwardCompatible(t *testing.T) {
	legacy := tryParseMembership([]byte(`{"__membership":true,"peers":["peer-a"]}`))
	if legacy == nil || len(legacy.Peers) != 1 || len(legacy.Capacities) != 0 {
		t.Fatalf("legacy membership did not parse: %#v", legacy)
	}

	current := tryParseMembership([]byte(`{"__membership":true,"peers":["peer-a"],"capacities":{"peer-a":[2,1,123]}}`))
	if current == nil || !reflect.DeepEqual(current.Capacities["peer-a"], []int64{2, 1, 123}) {
		t.Fatalf("capacity membership did not parse: %#v", current)
	}
}

func TestTolerantPeersNeverRaisesRetainedDegreeAboveMaxPeers(t *testing.T) {
	m := New(Config{MinPeers: 1, MaxPeers: 2, TolerantPeers: 10})
	m.peers["old-a"] = &peerConn{id: "old-a", connected: true}
	m.peers["old-b"] = &peerConn{id: "old-b", connected: true}
	m.peers["newest"] = &peerConn{id: "newest", connected: true}
	m.peerConnectedAt["old-a"] = 1
	m.peerConnectedAt["old-b"] = 2
	m.peerConnectedAt["newest"] = 3

	m.trimExcessPeers()

	m.mu.Lock()
	defer m.mu.Unlock()
	if got := m.connectedCountLocked(); got != 2 {
		t.Fatalf("retained degree = %d, want 2", got)
	}
	if _, retained := m.peers["newest"]; retained {
		t.Fatal("newest overflow connection was retained")
	}
}
