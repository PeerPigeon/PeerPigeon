package storage

import (
	"crypto/sha256"
	"fmt"
	"sync"
	"testing"
)

type subscriptionTestBus struct {
	mu      sync.Mutex
	clients map[string]*subscriptionTestGossip
}

type subscriptionTestGossip struct {
	id      string
	bus     *subscriptionTestBus
	handler func(data interface{}, local bool, fromPeer string)
}

func newSubscriptionTestBus() *subscriptionTestBus {
	return &subscriptionTestBus{clients: make(map[string]*subscriptionTestGossip)}
}

func (b *subscriptionTestBus) client(id string) *subscriptionTestGossip {
	g := &subscriptionTestGossip{id: id, bus: b}
	b.mu.Lock()
	b.clients[id] = g
	b.mu.Unlock()
	return g
}

func (g *subscriptionTestGossip) Broadcast(data interface{}, _ map[string]interface{}) string {
	g.bus.mu.Lock()
	clients := make([]*subscriptionTestGossip, 0, len(g.bus.clients))
	for _, client := range g.bus.clients {
		clients = append(clients, client)
	}
	g.bus.mu.Unlock()

	for _, client := range clients {
		if client.id != g.id && client.handler != nil {
			client.handler(data, false, g.id)
		}
	}
	return fmt.Sprintf("msg-%s", g.id)
}

func (g *subscriptionTestGossip) OnMessageReceived(fn func(data interface{}, local bool, fromPeer string)) func() {
	g.handler = fn
	return func() { g.handler = nil }
}

func newSubscriptionTestStore(t *testing.T, id string, gossip GossipInterface) *PeerPigeonStorage {
	t.Helper()
	store, err := New(Options{UserID: id, PeerID: testPeerID(id), SessionID: "subscription-test", Gossip: gossip})
	if err != nil {
		t.Fatalf("New(%s): %v", id, err)
	}
	if err := store.Init(); err != nil {
		t.Fatalf("Init(%s): %v", id, err)
	}
	t.Cleanup(store.Close)
	return store
}

func testPeerID(id string) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(id)))
}

func putSubscriptionTestValue(t *testing.T, store *PeerPigeonStorage, space Space, key string, value interface{}) {
	t.Helper()
	var err error
	if space == SpaceEPublic {
		_, err = store.PutSystem(space, key, value)
	} else {
		_, err = store.Put(space, key, value)
	}
	if err != nil {
		t.Fatalf("put [%s] %s: %v", space, key, err)
	}
}

func TestRemoteStorageRequiresExactKeySubscription(t *testing.T) {
	spaces := []Space{SpacePublic, SpaceUser, SpaceFrozen, SpaceEPublic}
	for _, space := range spaces {
		t.Run(string(space), func(t *testing.T) {
			bus := newSubscriptionTestBus()
			publisher := newSubscriptionTestStore(t, "publisher", bus.client("publisher"))
			subscriber := newSubscriptionTestStore(t, "subscriber", bus.client("subscriber"))
			unsubscribed := newSubscriptionTestStore(t, "unsubscribed", bus.client("unsubscribed"))
			key := "current-value"

			putSubscriptionTestValue(t, publisher, space, key, "v1")
			publisherRecord, err := publisher.Get(space, key)
			if err != nil || publisherRecord == nil {
				t.Fatalf("publisher local record missing: record=%v err=%v", publisherRecord, err)
			}
			if publisherRecord.ModifiedBy != testPeerID("publisher") {
				t.Fatalf("publisher modifiedBy=%q, want peer ID %q", publisherRecord.ModifiedBy, testPeerID("publisher"))
			}
			if got, _ := subscriber.Get(space, key); got != nil {
				t.Fatalf("unsolicited mutation synced to future subscriber: %#v", got)
			}
			if got, _ := unsubscribed.Get(space, key); got != nil {
				t.Fatalf("unsolicited mutation synced to non-subscriber: %#v", got)
			}

			got, err := subscriber.Retrieve(space, key, RetrieveOptions{TimeoutMs: 250})
			if err != nil {
				t.Fatalf("Retrieve: %v", err)
			}
			if got == nil || got.Value != "v1" {
				t.Fatalf("Get did not return current value: %#v", got)
			}
			if got.ModifiedBy != testPeerID("publisher") {
				t.Fatalf("subscriber modifiedBy=%q, want publisher peer ID %q", got.ModifiedBy, testPeerID("publisher"))
			}
			if !subscriber.IsSubscribed(space, key) {
				t.Fatal("Retrieve did not establish subscription")
			}
			if got, _ := unsubscribed.Get(space, key); got != nil {
				t.Fatalf("retrieve response synced to non-subscriber: %#v", got)
			}

			if space != SpaceFrozen {
				putSubscriptionTestValue(t, publisher, space, key, "v2")
				got, _ = subscriber.Get(space, key)
				if got == nil || got.Value != "v2" {
					t.Fatalf("subscribed mutation was not applied: %#v", got)
				}
				if other, _ := unsubscribed.Get(space, key); other != nil {
					t.Fatalf("mutation synced to non-subscriber: %#v", other)
				}

				subscriber.UnsubscribeKey(space, key)
				putSubscriptionTestValue(t, publisher, space, key, "v3")
				got, _ = subscriber.Get(space, key)
				if got == nil || got.Value != "v2" {
					t.Fatalf("mutation applied after unsubscribe: %#v", got)
				}
			}
		})
	}
}

func TestPrivateStorageNeverSyncs(t *testing.T) {
	bus := newSubscriptionTestBus()
	publisher := newSubscriptionTestStore(t, "publisher", bus.client("publisher"))
	subscriber := newSubscriptionTestStore(t, "subscriber", bus.client("subscriber"))

	putSubscriptionTestValue(t, publisher, SpacePrivate, "secret", "local-only")
	local, err := publisher.Get(SpacePrivate, "secret")
	if err != nil || local == nil {
		t.Fatalf("publisher private record missing: record=%v err=%v", local, err)
	}
	if local.ModifiedBy != testPeerID("publisher") {
		t.Fatalf("private modifiedBy=%q, want peer ID %q", local.ModifiedBy, testPeerID("publisher"))
	}
	got, err := subscriber.Retrieve(SpacePrivate, "secret", RetrieveOptions{TimeoutMs: 100})
	if err != nil {
		t.Fatalf("Retrieve private: %v", err)
	}
	if got != nil {
		t.Fatalf("private storage synced to peer: %#v", got)
	}
}
