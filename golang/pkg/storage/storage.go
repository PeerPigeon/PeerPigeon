// Package storage implements PeerPigeonStorage, an encrypted gossip-synced
// key-value store with five ACL spaces.
// It is a faithful Go port of src/storage.ts.
package storage

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ── types ──────────────────────────────────────────────────────────────────

// Space is one of the five ACL namespaces.
type Space string

const (
	SpacePublic  Space = "public"
	SpaceUser    Space = "user"
	SpaceFrozen  Space = "frozen"
	SpacePrivate Space = "private"
	SpaceEPublic Space = "epublic"
)

func isValidSpace(s Space) bool {
	return s == SpacePublic || s == SpaceUser || s == SpaceFrozen || s == SpacePrivate || s == SpaceEPublic
}

// Record is the public view of a stored record.
type Record struct {
	Space      Space
	Key        string
	Value      interface{}
	OwnerID    string
	ModifiedBy string
	CreatedAt  int64
	UpdatedAt  int64
	Version    StorageVersion
}

type StorageVersion string

func (v *StorageVersion) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*v = StorageVersion("0")
		return nil
	}

	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		*v = StorageVersion(strings.TrimSpace(s))
		return nil
	}

	var n float64
	if err := json.Unmarshal(data, &n); err == nil {
		*v = StorageVersion(strconv.FormatInt(int64(n), 10))
		return nil
	}

	return fmt.Errorf("invalid storage version payload")
}

// ChangeOrigin indicates whether a change was local or remote.
type ChangeOrigin string

const (
	OriginLocal  ChangeOrigin = "local"
	OriginRemote ChangeOrigin = "remote"
)

// ChangeEvent is delivered to OnChange listeners.
type ChangeEvent struct {
	Origin  ChangeOrigin
	Op      string // "upsert" or "delete"
	Record  *Record
	Space   Space
	Key     string
	ActorID string
}

// Options configures a PeerPigeonStorage instance.
type Options struct {
	// UserID is the local identity used for ACL checks (required).
	UserID string
	// PeerID is the mesh peer ID recorded as modification provenance.
	PeerID     string
	SessionID  string
	SyncSecret string
	DBName     string
	// Gossip is the optional GossipInterface for network sync.
	Gossip GossipInterface
	// SyncFilter optionally gates incoming remote sync payloads.
	SyncFilter func(space Space, key string, kind string, actorID string) bool
}

// PutOptions allows overriding the owner for the first write to a user-space key.
type PutOptions struct {
	OwnerID string
}

// RetrieveOptions configures a network-assisted retrieve call.
type RetrieveOptions struct {
	TimeoutMs int64
}

// GossipInterface is the subset of GossipProtocol that PeerPigeonStorage needs.
type GossipInterface interface {
	Broadcast(data interface{}, metadata map[string]interface{}) string
	OnMessageReceived(fn func(data interface{}, local bool, fromPeer string)) func()
}

// ── internal types ─────────────────────────────────────────────────────────

type persistedRecord struct {
	PK          string         `json:"pk"`
	Space       Space          `json:"space"`
	Key         string         `json:"key"`
	OwnerID     string         `json:"ownerId"`
	ModifiedBy  string         `json:"modifiedBy"`
	Value       interface{}    `json:"value"`
	ValueCipher *cipher64      `json:"valueCipher"`
	CreatedAt   int64          `json:"createdAt"`
	UpdatedAt   int64          `json:"updatedAt"`
	Version     StorageVersion `json:"version"`
}

type cipher64 struct {
	Alg string `json:"alg"` // "A256GCM"
	IV  string `json:"iv"`  // base64url
	CT  string `json:"ct"`  // base64url
}

type storageMutation struct {
	PPType    string           `json:"__ppType"` // "pp-storage-op-v1"
	OpID      string           `json:"opId"`
	Op        string           `json:"op"` // "upsert"|"delete"
	Space     Space            `json:"space"`
	Key       string           `json:"key"`
	ActorID   string           `json:"actorId"`
	Timestamp int64            `json:"timestamp"`
	Record    *persistedRecord `json:"record"`
}

type storageRetrieveReq struct {
	PPType    string `json:"__ppType"` // "pp-storage-req-v1"
	ReqID     string `json:"reqId"`
	Space     Space  `json:"space"`
	Key       string `json:"key"`
	ActorID   string `json:"actorId"`
	Timestamp int64  `json:"timestamp"`
}

type storageRetrieveResp struct {
	PPType    string           `json:"__ppType"` // "pp-storage-res-v1"
	ReqID     string           `json:"reqId"`
	Space     Space            `json:"space"`
	Key       string           `json:"key"`
	ActorID   string           `json:"actorId"`
	Timestamp int64            `json:"timestamp"`
	Record    *persistedRecord `json:"record"`
}

type syncEnvelope struct {
	PPType    string   `json:"__ppType"` // "pp-storage-sync-v1"
	From      string   `json:"from"`
	Timestamp int64    `json:"timestamp"`
	Cipher    cipher64 `json:"cipher"`
}

// ── storage driver ─────────────────────────────────────────────────────────

// StorageDriver is the persistence interface. Implement this to use a different
// backend (e.g., bbolt, SQLite, Redis).
type StorageDriver interface {
	Get(pk string) (*persistedRecord, error)
	Put(record *persistedRecord) error
	Delete(pk string) error
	ListBySpace(space Space) ([]*persistedRecord, error)
}

// MemoryDriver is an in-memory implementation of StorageDriver.
type MemoryDriver struct {
	mu   sync.RWMutex
	data map[string]*persistedRecord
}

// NewMemoryDriver returns a new in-memory storage driver.
func NewMemoryDriver() *MemoryDriver { return &MemoryDriver{data: make(map[string]*persistedRecord)} }

func (d *MemoryDriver) Get(pk string) (*persistedRecord, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	r := d.data[pk]
	if r == nil {
		return nil, nil
	}
	return r, nil
}

func (d *MemoryDriver) Put(r *persistedRecord) error {
	d.mu.Lock()
	d.data[r.PK] = r
	d.mu.Unlock()
	return nil
}

func (d *MemoryDriver) Delete(pk string) error {
	d.mu.Lock()
	delete(d.data, pk)
	d.mu.Unlock()
	return nil
}

func (d *MemoryDriver) ListBySpace(space Space) ([]*persistedRecord, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	var out []*persistedRecord
	for _, r := range d.data {
		if r.Space == space {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out, nil
}

// ── PeerPigeonStorage ──────────────────────────────────────────────────────

// PeerPigeonStorage is a subscription-gated, encrypted key-value store.
type PeerPigeonStorage struct {
	userID     string
	peerID     string
	sessionID  string
	syncSecret string
	gossip     GossipInterface
	syncFilter func(Space, string, string, string) bool
	instanceID string

	mu          sync.Mutex
	driver      StorageDriver
	closed      bool
	listeners   []func(ChangeEvent)
	pending     map[string]*pendingRetrieve
	subscribed  map[string]struct{}
	gossipUnsub func()
}

type pendingRetrieve struct {
	resolve func(*Record)
	timer   *time.Timer
	space   Space
	key     string
}

func storageTraceEnabled() bool {
	return strings.TrimSpace(os.Getenv("PP_STORAGE_TRACE")) == "1"
}

func storageTracef(format string, args ...interface{}) {
	if !storageTraceEnabled() {
		return
	}
	fmt.Printf("[storage-trace] "+format+"\n", args...)
}

// New creates a new PeerPigeonStorage with the given options.
// Call Init() before using Put/Get/Delete/List.
func New(opts Options) (*PeerPigeonStorage, error) {
	userID := strings.TrimSpace(opts.UserID)
	if userID == "" {
		return nil, fmt.Errorf("storage: UserID must be non-empty")
	}
	sessionID := strings.TrimSpace(opts.SessionID)
	if sessionID == "" {
		sessionID = "default-session"
	}
	dbName := strings.TrimSpace(opts.DBName)
	if dbName == "" {
		dbName = "peerpigeon-storage-v1"
	}
	s := &PeerPigeonStorage{
		userID:     userID,
		peerID:     strings.TrimSpace(opts.PeerID),
		sessionID:  sessionID,
		syncSecret: strings.TrimSpace(opts.SyncSecret),
		gossip:     opts.Gossip,
		syncFilter: opts.SyncFilter,
		instanceID: fmt.Sprintf("storage-%d", time.Now().UnixNano()),
		pending:    make(map[string]*pendingRetrieve),
		subscribed: make(map[string]struct{}),
	}
	return s, nil
}

// SetPeerID updates the mesh peer ID used as modification provenance.
func (s *PeerPigeonStorage) SetPeerID(peerID string) {
	s.mu.Lock()
	s.peerID = strings.TrimSpace(peerID)
	s.mu.Unlock()
}

func (s *PeerPigeonStorage) localPeerID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.peerID
}

// Init initialises the storage driver and connects gossip sync.
func (s *PeerPigeonStorage) Init() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return fmt.Errorf("storage: already closed")
	}
	if s.driver != nil {
		s.mu.Unlock()
		return nil
	}
	s.driver = NewMemoryDriver()
	s.mu.Unlock()

	if s.gossip != nil {
		s.gossipUnsub = s.gossip.OnMessageReceived(func(data interface{}, local bool, fromPeer string) {
			if local {
				return
			}
			_ = s.handleGossipMessage(data)
		})
	}
	return nil
}

// OnChange registers a listener for storage change events.
// Returns an unsubscribe function.
func (s *PeerPigeonStorage) OnChange(fn func(ChangeEvent)) func() {
	s.mu.Lock()
	// Create a unique marker to identify this listener later
	listenerIdx := len(s.listeners)
	s.listeners = append(s.listeners, fn)
	s.mu.Unlock()

	unsubscribed := false
	return func() {
		s.mu.Lock()
		if !unsubscribed && listenerIdx < len(s.listeners) {
			s.listeners = append(s.listeners[:listenerIdx], s.listeners[listenerIdx+1:]...)
			unsubscribed = true
		}
		s.mu.Unlock()
	}
}

// SubscribeKey enables remote mutation and retrieve-response sync for one key.
func (s *PeerPigeonStorage) SubscribeKey(space Space, key string) func() {
	normKey := strings.TrimSpace(key)
	if normKey == "" {
		return func() {}
	}
	pk := s.makePK(space, normKey)
	s.mu.Lock()
	s.subscribed[pk] = struct{}{}
	s.mu.Unlock()
	return func() { s.UnsubscribeKey(space, normKey) }
}

// UnsubscribeKey stops accepting remote sync for one key.
func (s *PeerPigeonStorage) UnsubscribeKey(space Space, key string) {
	pk := s.makePK(space, strings.TrimSpace(key))
	s.mu.Lock()
	delete(s.subscribed, pk)
	s.mu.Unlock()
}

// IsSubscribed reports whether remote sync is enabled for one key.
func (s *PeerPigeonStorage) IsSubscribed(space Space, key string) bool {
	pk := s.makePK(space, strings.TrimSpace(key))
	s.mu.Lock()
	_, ok := s.subscribed[pk]
	s.mu.Unlock()
	return ok
}

// Close shuts down the storage instance.
func (s *PeerPigeonStorage) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	pending := s.pending
	s.pending = make(map[string]*pendingRetrieve)
	s.subscribed = make(map[string]struct{})
	listeners := s.listeners
	s.listeners = nil
	s.mu.Unlock()

	if s.gossipUnsub != nil {
		s.gossipUnsub()
	}
	for _, p := range pending {
		if p.timer != nil {
			p.timer.Stop()
		}
		p.resolve(nil)
	}
	// Ensure all listeners are cleared
	_ = listeners
}

// ── CRUD ───────────────────────────────────────────────────────────────────

// Put stores a value in the given space under key.
func (s *PeerPigeonStorage) Put(space Space, key string, value interface{}, opts ...PutOptions) (*Record, error) {
	var putOpts PutOptions
	if len(opts) > 0 {
		putOpts = opts[0]
	}
	mutation, err := s.applyLocalUpsert(space, key, value, putOpts, false)
	if err != nil {
		return nil, err
	}
	if space != SpacePrivate {
		_ = s.broadcastMutation(mutation)
	}
	return s.Get(space, key)
}

// PutSystem stores a value in epublic space. This bypasses user-write ACL and
// is intended for internal runtime updates.
func (s *PeerPigeonStorage) PutSystem(space Space, key string, value interface{}, opts ...PutOptions) (*Record, error) {
	if space != SpaceEPublic {
		return nil, fmt.Errorf("storage: PutSystem is only allowed for epublic space")
	}

	var putOpts PutOptions
	if len(opts) > 0 {
		putOpts = opts[0]
	}
	mutation, err := s.applyLocalUpsert(space, key, value, putOpts, true)
	if err != nil {
		return nil, err
	}
	_ = s.broadcastMutation(mutation)
	return s.Get(space, key)
}

// Get retrieves a record from local storage.
func (s *PeerPigeonStorage) Get(space Space, key string) (*Record, error) {
	pr, err := s.lookupPersistedRecord(space, strings.TrimSpace(key))
	if err != nil {
		return nil, err
	}
	if pr == nil {
		return nil, nil
	}
	val, err := s.decodeValue(pr)
	if err != nil {
		if space == SpacePrivate {
			return nil, nil
		}
		return nil, err
	}
	return &Record{
		Space:      pr.Space,
		Key:        pr.Key,
		Value:      val,
		OwnerID:    pr.OwnerID,
		ModifiedBy: pr.ModifiedBy,
		CreatedAt:  pr.CreatedAt,
		UpdatedAt:  pr.UpdatedAt,
		Version:    pr.Version,
	}, nil
}

// Retrieve fetches a key, requesting it from the network if not present locally.
func (s *PeerPigeonStorage) Retrieve(space Space, key string, opts ...RetrieveOptions) (*Record, error) {
	normKey := strings.TrimSpace(key)
	s.SubscribeKey(space, normKey)
	existing, err := s.Get(space, normKey)
	if err != nil {
		return nil, err
	}
	if space == SpacePrivate || s.gossip == nil {
		return existing, nil
	}

	var timeoutMs int64 = 2_000
	if len(opts) > 0 && opts[0].TimeoutMs > 0 {
		timeoutMs = opts[0].TimeoutMs
	}

	reqID := fmt.Sprintf("%s-%d-req", s.makeMutationID(s.userID), time.Now().UnixNano())
	req := storageRetrieveReq{
		PPType:    "pp-storage-req-v1",
		ReqID:     reqID,
		Space:     space,
		Key:       normKey,
		ActorID:   s.userID,
		Timestamp: nowMs(),
	}
	storageTracef("retrieve start user=%s space=%s key=%s reqId=%s timeoutMs=%d", s.userID, space, normKey, reqID, timeoutMs)

	resultCh := make(chan *Record, 1)
	stopRetry := make(chan struct{})
	stopRetryOnce := sync.Once{}
	stopRetries := func() {
		stopRetryOnce.Do(func() {
			close(stopRetry)
		})
	}

	timer := time.AfterFunc(time.Duration(timeoutMs)*time.Millisecond, func() {
		s.mu.Lock()
		delete(s.pending, reqID)
		s.mu.Unlock()
		stopRetries()
		latest, _ := s.Get(space, normKey)
		storageTracef("retrieve timeout space=%s key=%s reqId=%s hit=%t", space, normKey, reqID, latest != nil)
		select {
		case resultCh <- latest:
		default:
		}
	})

	s.mu.Lock()
	s.pending[reqID] = &pendingRetrieve{
		resolve: func(r *Record) {
			stopRetries()
			select {
			case resultCh <- r:
			default:
			}
		},
		timer: timer,
		space: space,
		key:   normKey,
	}
	s.mu.Unlock()

	_ = s.broadcastSyncPayload(req)

	go func() {
		ticker := time.NewTicker(700 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopRetry:
				return
			case <-ticker.C:
				storageTracef("retrieve retry space=%s key=%s reqId=%s", space, normKey, reqID)
				_ = s.broadcastSyncPayload(req)
			}
		}
	}()

	return <-resultCh, nil
}

// Delete removes a record.
func (s *PeerPigeonStorage) Delete(space Space, key string) (bool, error) {
	mutation, err := s.applyLocalDelete(space, key, false)
	if err != nil || mutation == nil {
		return false, err
	}
	if space != SpacePrivate {
		_ = s.broadcastMutation(mutation)
	}
	return true, nil
}

// DeleteSystem deletes an epublic key and is intended for internal runtime use.
func (s *PeerPigeonStorage) DeleteSystem(space Space, key string) (bool, error) {
	if space != SpaceEPublic {
		return false, fmt.Errorf("storage: DeleteSystem is only allowed for epublic space")
	}
	mutation, err := s.applyLocalDelete(space, key, true)
	if err != nil || mutation == nil {
		return false, err
	}
	_ = s.broadcastMutation(mutation)
	return true, nil
}

// List returns all records in a space.
func (s *PeerPigeonStorage) List(space Space) ([]*Record, error) {
	driver := s.requireDriver()
	records, err := driver.ListBySpace(space)
	if err != nil {
		return nil, err
	}
	var out []*Record
	for _, pr := range records {
		val, err := s.decodeValue(pr)
		if err != nil {
			if pr.Space == SpacePrivate {
				continue
			}
			return nil, err
		}
		out = append(out, &Record{
			Space:      pr.Space,
			Key:        pr.Key,
			Value:      val,
			OwnerID:    pr.OwnerID,
			ModifiedBy: pr.ModifiedBy,
			CreatedAt:  pr.CreatedAt,
			UpdatedAt:  pr.UpdatedAt,
			Version:    pr.Version,
		})
	}
	return out, nil
}

// ── local apply ────────────────────────────────────────────────────────────

func (s *PeerPigeonStorage) applyLocalUpsert(space Space, key string, value interface{}, opts PutOptions, allowSystemWrite bool) (*storageMutation, error) {
	normKey := strings.TrimSpace(key)
	if normKey == "" {
		return nil, fmt.Errorf("storage: key must be non-empty")
	}
	driver := s.requireDriver()
	pk := s.makePK(space, normKey)
	existing, err := driver.Get(pk)
	if err != nil {
		return nil, err
	}
	now := nowMs()

	if err := s.assertCanWrite(space, existing, s.userID, opts.OwnerID, allowSystemWrite); err != nil {
		return nil, err
	}

	ownerID := s.resolveOwnerID(space, existing, s.userID, opts.OwnerID)
	modifiedBy := s.localPeerID()
	versionActor := modifiedBy
	if versionActor == "" {
		versionActor = ownerID
	}
	if versionActor == "" {
		versionActor = s.userID
	}
	nextVersion := s.nextVersion(versionOrZero(existing), versionActor)
	encoded, err := s.encodeValue(space, value)
	if err != nil {
		return nil, err
	}

	createdAt := now
	if existing != nil {
		createdAt = existing.CreatedAt
	}

	pr := &persistedRecord{
		PK:          pk,
		Space:       space,
		Key:         normKey,
		OwnerID:     ownerID,
		ModifiedBy:  modifiedBy,
		Value:       encoded.value,
		ValueCipher: encoded.cipher,
		CreatedAt:   createdAt,
		UpdatedAt:   now,
		Version:     nextVersion,
	}
	if err := driver.Put(pr); err != nil {
		return nil, err
	}

	opID := s.makeMutationID(s.userID)
	mutation := &storageMutation{
		PPType:    "pp-storage-op-v1",
		OpID:      opID,
		Op:        "upsert",
		Space:     space,
		Key:       normKey,
		ActorID:   s.userID,
		Timestamp: now,
		Record:    pr,
	}
	s.emitChange(ChangeEvent{
		Origin:  OriginLocal,
		Op:      "upsert",
		Record:  toRecord(pr, value),
		Space:   space,
		Key:     normKey,
		ActorID: s.userID,
	})
	return mutation, nil
}

func (s *PeerPigeonStorage) applyLocalDelete(space Space, key string, allowSystemWrite bool) (*storageMutation, error) {
	normKey := strings.TrimSpace(key)
	if normKey == "" {
		return nil, nil
	}
	driver := s.requireDriver()
	pk := s.makePK(space, normKey)
	existing, err := driver.Get(pk)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}
	if err := s.assertCanDelete(space, existing, s.userID, allowSystemWrite); err != nil {
		return nil, err
	}
	if err := driver.Delete(pk); err != nil {
		return nil, err
	}

	opID := s.makeMutationID(s.userID)
	mutation := &storageMutation{
		PPType:    "pp-storage-op-v1",
		OpID:      opID,
		Op:        "delete",
		Space:     space,
		Key:       normKey,
		ActorID:   s.userID,
		Timestamp: nowMs(),
		Record:    nil,
	}
	s.emitChange(ChangeEvent{
		Origin:  OriginLocal,
		Op:      "delete",
		Record:  nil,
		Space:   space,
		Key:     normKey,
		ActorID: s.userID,
	})
	return mutation, nil
}

// ── remote apply ───────────────────────────────────────────────────────────

func (s *PeerPigeonStorage) applyRemoteMutation(mutation *storageMutation) (bool, error) {
	driver := s.requireDriver()
	pk := s.makePK(mutation.Space, mutation.Key)
	existing, err := driver.Get(pk)
	if err != nil {
		return false, err
	}

	if mutation.Op == "delete" {
		if existing == nil {
			return false, nil
		}
		if mutation.Timestamp <= existing.UpdatedAt {
			return false, nil
		}
		if !s.canDelete(mutation.Space, existing, mutation.ActorID, mutation.Space == SpaceEPublic) {
			return false, nil
		}
		if err := driver.Delete(pk); err != nil {
			return false, err
		}
		s.emitChange(ChangeEvent{Origin: OriginRemote, Op: "delete", Record: nil,
			Space: mutation.Space, Key: mutation.Key, ActorID: mutation.ActorID})
		return true, nil
	}

	if mutation.Record == nil {
		return false, nil
	}

	if existing != nil {
		inVersion := mutation.Record.Version
		inTs := mutation.Timestamp
		cmp := s.compareVersions(inVersion, existing.Version)
		if cmp < 0 {
			return false, nil
		}
		if cmp == 0 && inTs <= existing.UpdatedAt {
			return false, nil
		}
	}

	if !s.canWrite(mutation.Space, existing, mutation.ActorID, "", mutation.Space == SpaceEPublic) {
		return false, nil
	}

	if mutation.Space == SpaceUser && existing == nil {
		inOwner := strings.TrimSpace(mutation.Record.OwnerID)
		if inOwner != "" && inOwner != mutation.ActorID {
			return false, nil
		}
	}

	resolvedOwner := mutation.Record.OwnerID
	if mutation.Space == SpaceUser && existing != nil {
		resolvedOwner = existing.OwnerID
	}

	createdAt := mutation.Record.CreatedAt
	if existing != nil && existing.CreatedAt < createdAt {
		createdAt = existing.CreatedAt
	}

	incoming := &persistedRecord{
		PK:          pk,
		Space:       mutation.Space,
		Key:         mutation.Key,
		OwnerID:     resolvedOwner,
		ModifiedBy:  mutation.Record.ModifiedBy,
		Value:       mutation.Record.Value,
		ValueCipher: mutation.Record.ValueCipher,
		CreatedAt:   createdAt,
		UpdatedAt:   mutation.Timestamp,
		Version:     s.normalizeVersion(mutation.Record.Version, resolvedOwner),
	}
	if err := driver.Put(incoming); err != nil {
		return false, err
	}

	s.resolvePendingRetrievesForKey(incoming.Space, incoming.Key)

	val, err := s.decodeValue(incoming)
	if err != nil {
		val = nil
	}
	s.emitChange(ChangeEvent{
		Origin: OriginRemote, Op: "upsert",
		Record: toRecord(incoming, val),
		Space:  incoming.Space, Key: incoming.Key, ActorID: mutation.ActorID,
	})
	return true, nil
}

// ── gossip sync ────────────────────────────────────────────────────────────

func (s *PeerPigeonStorage) handleGossipMessage(raw interface{}) error {
	payload, ok := raw.(map[string]interface{})
	if !ok {
		// try via JSON round-trip
		b, err := json.Marshal(raw)
		if err != nil {
			return nil
		}
		if err := json.Unmarshal(b, &payload); err != nil {
			return nil
		}
	}

	ppType, _ := payload["__ppType"].(string)
	if ppType != "pp-storage-sync-v1" {
		return nil
	}

	cipherRaw, _ := payload["cipher"].(map[string]interface{})
	if cipherRaw == nil {
		return nil
	}
	alg, _ := cipherRaw["alg"].(string)
	iv, _ := cipherRaw["iv"].(string)
	ct, _ := cipherRaw["ct"].(string)
	if alg != "A256GCM" || iv == "" || ct == "" {
		return nil
	}

	decrypted, err := s.decryptSyncEnvelope(cipher64{Alg: alg, IV: iv, CT: ct})
	if err != nil || decrypted == nil {
		if err != nil {
			storageTracef("sync decrypt failed session=%s err=%v", s.sessionID, err)
		}
		return nil
	}

	decBytes, err := json.Marshal(decrypted)
	if err != nil {
		return nil
	}

	var inner map[string]interface{}
	if err := json.Unmarshal(decBytes, &inner); err != nil {
		return nil
	}

	innerType, _ := inner["__ppType"].(string)
	storageTracef("sync received innerType=%s", innerType)
	switch innerType {
	case "pp-storage-op-v1":
		var mut storageMutation
		if err := json.Unmarshal(decBytes, &mut); err != nil {
			return nil
		}
		if mut.Space == SpacePrivate {
			return nil
		}
		if !s.shouldAcceptRemote(mut.Space, mut.Key, "mutation", mut.ActorID) {
			return nil
		}
		_, err := s.applyRemoteMutation(&mut)
		if err == nil {
			storageTracef("sync mutation applied op=%s space=%s key=%s actor=%s", mut.Op, mut.Space, mut.Key, mut.ActorID)
			_ = s.broadcastMutation(&mut)
		}
	case "pp-storage-req-v1":
		var req storageRetrieveReq
		if err := json.Unmarshal(decBytes, &req); err != nil {
			return nil
		}
		if req.Space == SpacePrivate {
			return nil
		}
		if !s.shouldAcceptRemote(req.Space, req.Key, "retrieve-request", req.ActorID) {
			return nil
		}
		_ = s.handleRetrieveRequest(&req)
	case "pp-storage-res-v1":
		var resp storageRetrieveResp
		if err := json.Unmarshal(decBytes, &resp); err != nil {
			return nil
		}
		_ = s.handleRetrieveResponse(&resp)
	}
	return nil
}

func (s *PeerPigeonStorage) handleRetrieveRequest(req *storageRetrieveReq) error {
	if req.ActorID == s.userID || req.Space == SpacePrivate {
		storageTracef("retrieve request ignored space=%s key=%s reqId=%s actor=%s self=%s", req.Space, req.Key, req.ReqID, req.ActorID, s.userID)
		return nil
	}
	existing, err := s.lookupPersistedRecord(req.Space, req.Key)
	if err != nil || existing == nil {
		storageTracef("retrieve request miss space=%s key=%s reqId=%s", req.Space, req.Key, req.ReqID)
		return err
	}
	storageTracef("retrieve request hit space=%s key=%s reqId=%s responding", req.Space, req.Key, req.ReqID)
	resp := &storageRetrieveResp{
		PPType:    "pp-storage-res-v1",
		ReqID:     req.ReqID,
		Space:     req.Space,
		Key:       req.Key,
		ActorID:   s.userID,
		Timestamp: nowMs(),
		Record:    existing,
	}
	return s.broadcastSyncPayload(resp)
}

func (s *PeerPigeonStorage) handleRetrieveResponse(resp *storageRetrieveResp) error {
	storageTracef("retrieve response received space=%s key=%s reqId=%s hasRecord=%t actor=%s", resp.Space, resp.Key, resp.ReqID, resp.Record != nil, resp.ActorID)
	s.mu.Lock()
	p := s.pending[resp.ReqID]
	if p != nil {
		delete(s.pending, resp.ReqID)
	}
	s.mu.Unlock()
	if p != nil && p.timer != nil {
		p.timer.Stop()
	}

	if resp.Record != nil && resp.Space != SpacePrivate {
		if s.shouldAcceptRemote(resp.Space, resp.Key, "retrieve-response", resp.ActorID) {
			mut := &storageMutation{
				PPType: "pp-storage-op-v1",
				OpID:   fmt.Sprintf("retrieve-%s-%s", resp.ReqID, resp.ActorID),
				Op:     "upsert", Space: resp.Space, Key: resp.Key,
				ActorID: resp.ActorID, Timestamp: resp.Timestamp, Record: resp.Record,
			}
			_, _ = s.applyRemoteMutation(mut)
		}
	}

	if p != nil {
		latest, _ := s.Get(resp.Space, resp.Key)
		storageTracef("retrieve response resolved space=%s key=%s reqId=%s hit=%t", resp.Space, resp.Key, resp.ReqID, latest != nil)
		p.resolve(latest)
	}
	return nil
}

func (s *PeerPigeonStorage) broadcastMutation(mut *storageMutation) error {
	return s.broadcastSyncPayload(mut)
}

func (s *PeerPigeonStorage) broadcastSyncPayload(payload interface{}) error {
	if s.gossip == nil {
		return nil
	}
	cipherPl, err := s.encryptSyncPayload(payload)
	if err != nil {
		return err
	}
	env := syncEnvelope{
		PPType:    "pp-storage-sync-v1",
		From:      s.userID,
		Timestamp: nowMs(),
		Cipher:    cipherPl,
	}
	s.gossip.Broadcast(env, nil)
	return nil
}

func (s *PeerPigeonStorage) shouldAcceptRemote(space Space, key, kind, actorID string) bool {
	if space == SpacePrivate {
		return false
	}
	// Retrieve requests contain no value and must reach record holders. Values
	// and later mutations are accepted only by explicit subscribers.
	if kind != "retrieve-request" && !s.IsSubscribed(space, key) {
		return false
	}
	if s.syncFilter == nil {
		return true
	}
	defer func() { recover() }() //nolint:errcheck
	return s.syncFilter(space, key, kind, actorID) != false
}

// ── ACL ────────────────────────────────────────────────────────────────────

func (s *PeerPigeonStorage) canWrite(space Space, existing *persistedRecord, actorID, ownerOverride string, allowSystemWrite bool) bool {
	switch space {
	case SpacePublic:
		return true
	case SpaceEPublic:
		return allowSystemWrite
	case SpacePrivate:
		return actorID == s.userID
	case SpaceUser:
		if existing == nil {
			return true
		}
		if existing.OwnerID == actorID {
			return true
		}
		if ownerOverride != "" {
			return true
		}
		// Migration: if existing owner is old peer-ID hex format and new actor is epub format
		if isPeerIDFormat(existing.OwnerID) && !isPeerIDFormat(actorID) {
			return true
		}
		return false
	case SpaceFrozen:
		return existing == nil
	}
	return false
}

func (s *PeerPigeonStorage) assertCanWrite(space Space, existing *persistedRecord, actorID, ownerOverride string, allowSystemWrite bool) error {
	if !s.canWrite(space, existing, actorID, ownerOverride, allowSystemWrite) {
		return fmt.Errorf("storage: write denied for %s space", space)
	}
	return nil
}

func (s *PeerPigeonStorage) canDelete(space Space, existing *persistedRecord, actorID string, allowSystemWrite bool) bool {
	switch space {
	case SpacePublic:
		return true
	case SpaceEPublic:
		return allowSystemWrite
	case SpacePrivate:
		return actorID == s.userID
	case SpaceUser:
		return existing.OwnerID == actorID
	case SpaceFrozen:
		return false
	}
	return false
}

func (s *PeerPigeonStorage) assertCanDelete(space Space, existing *persistedRecord, actorID string, allowSystemWrite bool) error {
	if !s.canDelete(space, existing, actorID, allowSystemWrite) {
		return fmt.Errorf("storage: delete denied for %s space", space)
	}
	return nil
}

func (s *PeerPigeonStorage) resolveOwnerID(space Space, existing *persistedRecord, actorID, override string) string {
	if space == SpaceUser {
		if existing != nil && existing.OwnerID != "" {
			if isPeerIDFormat(existing.OwnerID) && !isPeerIDFormat(actorID) {
				return actorID
			}
			return existing.OwnerID
		}
		if override != "" {
			return override
		}
		return actorID
	}
	if space == SpacePublic || space == SpaceFrozen || space == SpaceEPublic {
		return ""
	}
	if existing != nil {
		return existing.OwnerID
	}
	return ""
}

var peerIDRe = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

func isPeerIDFormat(id string) bool {
	return peerIDRe.MatchString(strings.TrimSpace(id))
}

// ── crypto ─────────────────────────────────────────────────────────────────

type encodedValue struct {
	value  interface{}
	cipher *cipher64
}

func (s *PeerPigeonStorage) encodeValue(space Space, value interface{}) (encodedValue, error) {
	if space != SpacePrivate {
		return encodedValue{value: value}, nil
	}
	c, err := s.encryptPrivateValue(value)
	if err != nil {
		return encodedValue{}, err
	}
	return encodedValue{value: nil, cipher: &c}, nil
}

func (s *PeerPigeonStorage) decodeValue(pr *persistedRecord) (interface{}, error) {
	if pr.Space != SpacePrivate {
		return pr.Value, nil
	}
	if pr.ValueCipher == nil {
		return nil, fmt.Errorf("storage: missing cipher for private value")
	}
	return s.decryptPrivateValue(*pr.ValueCipher)
}

func (s *PeerPigeonStorage) encryptSyncPayload(payload interface{}) (cipher64, error) {
	key, err := s.deriveAESKey(fmt.Sprintf("peerpigeon:storage-sync:v1:%s:%s", s.sessionID, s.syncSecret))
	if err != nil {
		return cipher64{}, err
	}
	return encryptJSON(payload, key)
}

func (s *PeerPigeonStorage) decryptSyncEnvelope(c cipher64) (interface{}, error) {
	key, err := s.deriveAESKey(fmt.Sprintf("peerpigeon:storage-sync:v1:%s:%s", s.sessionID, s.syncSecret))
	if err != nil {
		return nil, err
	}
	return decryptJSON(c, key)
}

func (s *PeerPigeonStorage) encryptPrivateValue(value interface{}) (cipher64, error) {
	key, err := s.deriveAESKey(fmt.Sprintf("peerpigeon:storage-private:v1:%s:%s:%s", s.userID, s.sessionID, s.syncSecret))
	if err != nil {
		return cipher64{}, err
	}
	return encryptJSON(value, key)
}

func (s *PeerPigeonStorage) decryptPrivateValue(c cipher64) (interface{}, error) {
	key, err := s.deriveAESKey(fmt.Sprintf("peerpigeon:storage-private:v1:%s:%s:%s", s.userID, s.sessionID, s.syncSecret))
	if err != nil {
		return nil, err
	}
	return decryptJSON(c, key)
}

func (s *PeerPigeonStorage) deriveAESKey(seed string) ([]byte, error) {
	digest := sha256.Sum256([]byte(seed))
	return digest[:], nil
}

func encryptJSON(value interface{}, key []byte) (cipher64, error) {
	plaintext, err := json.Marshal(value)
	if err != nil {
		return cipher64{}, err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return cipher64{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return cipher64{}, err
	}

	iv := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		return cipher64{}, err
	}

	ciphertext := gcm.Seal(nil, iv, plaintext, nil)
	return cipher64{
		Alg: "A256GCM",
		IV:  base64url(iv),
		CT:  base64url(ciphertext),
	}, nil
}

func decryptJSON(c cipher64, key []byte) (interface{}, error) {
	iv, err := fromBase64url(c.IV)
	if err != nil {
		return nil, fmt.Errorf("storage: decode IV: %w", err)
	}
	ct, err := fromBase64url(c.CT)
	if err != nil {
		return nil, fmt.Errorf("storage: decode CT: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	plaintext, err := gcm.Open(nil, iv, ct, nil)
	if err != nil {
		return nil, fmt.Errorf("storage: AES-GCM decrypt: %w", err)
	}

	var out interface{}
	if err := json.Unmarshal(plaintext, &out); err != nil {
		return nil, fmt.Errorf("storage: unmarshal decrypted value: %w", err)
	}
	return out, nil
}

func base64url(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

func fromBase64url(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

// ── helpers ────────────────────────────────────────────────────────────────

func (s *PeerPigeonStorage) requireDriver() StorageDriver {
	s.mu.Lock()
	d := s.driver
	s.mu.Unlock()
	if d == nil {
		panic("storage: Init() must be called before use")
	}
	return d
}

func (s *PeerPigeonStorage) makePK(space Space, key string) string {
	if space == SpacePrivate {
		return fmt.Sprintf("private:%s:%s", s.userID, key)
	}
	return fmt.Sprintf("%s:%s", space, key)
}

// lookupPersistedRecord resolves records by exact key and includes a user-space
// compatibility fallback for owner-prefixed keys (owner::key).
func (s *PeerPigeonStorage) lookupPersistedRecord(space Space, key string) (*persistedRecord, error) {
	driver := s.requireDriver()
	normKey := strings.TrimSpace(key)
	pk := s.makePK(space, normKey)

	pr, err := driver.Get(pk)
	if err != nil || pr != nil {
		return pr, err
	}

	if space != SpaceUser || strings.Contains(normKey, "::") || normKey == "" {
		return nil, nil
	}

	recs, err := driver.ListBySpace(space)
	if err != nil {
		return nil, err
	}

	suffix := "::" + normKey
	var best *persistedRecord
	for _, r := range recs {
		if r == nil {
			continue
		}
		rk := strings.TrimSpace(r.Key)
		if rk == normKey || strings.HasSuffix(rk, suffix) {
			if best == nil || r.UpdatedAt > best.UpdatedAt {
				best = r
			}
		}
	}
	return best, nil
}

func (s *PeerPigeonStorage) makeMutationID(actorID string) string {
	return fmt.Sprintf("%s-%d-%d", actorID, nowMs(), fastRand())
}

func (s *PeerPigeonStorage) emitChange(event ChangeEvent) {
	s.mu.Lock()
	cbs := append(([]func(ChangeEvent))(nil), s.listeners...)
	s.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(event) })
	}
}

func (s *PeerPigeonStorage) resolvePendingRetrievesForKey(space Space, key string) {
	normKey := strings.TrimSpace(key)
	if normKey == "" {
		return
	}

	var matches []*pendingRetrieve
	s.mu.Lock()
	for reqID, pending := range s.pending {
		if pending == nil {
			continue
		}
		if pending.space != space || pending.key != normKey {
			continue
		}
		delete(s.pending, reqID)
		if pending.timer != nil {
			pending.timer.Stop()
		}
		matches = append(matches, pending)
	}
	s.mu.Unlock()

	if len(matches) == 0 {
		return
	}

	latest, _ := s.Get(space, normKey)
	for _, pending := range matches {
		pending.resolve(latest)
	}
}

func toRecord(pr *persistedRecord, value interface{}) *Record {
	return &Record{
		Space:      pr.Space,
		Key:        pr.Key,
		Value:      value,
		OwnerID:    pr.OwnerID,
		ModifiedBy: pr.ModifiedBy,
		CreatedAt:  pr.CreatedAt,
		UpdatedAt:  pr.UpdatedAt,
		Version:    pr.Version,
	}
}

func versionOrZero(pr *persistedRecord) StorageVersion {
	if pr == nil {
		return StorageVersion("0")
	}
	return pr.Version
}

func (s *PeerPigeonStorage) parseVersion(v StorageVersion) ([4]int64, string) {
	out := [4]int64{0, 0, 0, 0}
	raw := strings.TrimSpace(string(v))
	if raw == "" {
		return out, "0"
	}

	if isAllDigits(raw) {
		n, _ := strconv.ParseInt(raw, 10, 64)
		if n < 0 {
			n = 0
		}
		out[0] = n
		return out, "0"
	}

	parts := strings.Split(raw, ".")
	for i := 0; i < 4 && i < len(parts); i++ {
		n, err := strconv.ParseInt(strings.TrimSpace(parts[i]), 10, 64)
		if err != nil || n < 0 {
			n = 0
		}
		out[i] = n
	}

	source := "0"
	if len(parts) > 4 {
		source = s.versionSourceToken(parts[4])
	}
	return out, source
}

func (s *PeerPigeonStorage) versionSourceToken(value string) string {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return "0"
	}

	digits := onlyDigits(raw)
	if digits != "" {
		if len(digits) > 10 {
			digits = digits[:10]
		}
		n, err := strconv.ParseUint(digits, 10, 64)
		if err != nil {
			return "0"
		}
		return strconv.FormatUint(n, 10)
	}

	cleaned := normalizeAlphaNumLower(raw)
	if cleaned == "" {
		return "0"
	}

	hexPrefix := onlyHex(cleaned)
	if len(hexPrefix) > 8 {
		hexPrefix = hexPrefix[:8]
	}
	if len(hexPrefix) >= 4 {
		n, err := strconv.ParseUint(hexPrefix, 16, 64)
		if err == nil {
			return strconv.FormatUint(n, 10)
		}
	}

	h := fnv.New32a()
	_, _ = h.Write([]byte(cleaned))
	return strconv.FormatUint(uint64(h.Sum32()), 10)
}

func (s *PeerPigeonStorage) normalizeVersion(version StorageVersion, fallbackSource string) StorageVersion {
	parts, source := s.parseVersion(version)
	if source == "0" {
		source = s.versionSourceToken(fallbackSource)
	}
	return StorageVersion(fmt.Sprintf("%d.%d.%d.%d.%s", parts[0], parts[1], parts[2], parts[3], source))
}

func (s *PeerPigeonStorage) nextVersion(previous StorageVersion, actorID string) StorageVersion {
	parts, _ := s.parseVersion(previous)
	parts[0] += 1
	return StorageVersion(fmt.Sprintf("%d.0.0.0.%s", parts[0], s.versionSourceToken(actorID)))
}

func (s *PeerPigeonStorage) compareVersions(a, b StorageVersion) int {
	left, _ := s.parseVersion(a)
	right, _ := s.parseVersion(b)
	for i := 0; i < 4; i++ {
		if left[i] > right[i] {
			return 1
		}
		if left[i] < right[i] {
			return -1
		}
	}
	return 0
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func onlyDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func onlyHex(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func normalizeAlphaNumLower(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func nowMs() int64 { return time.Now().UnixMilli() }

var randState uint64 = 0xdeadbeef12345678

func fastRand() uint64 {
	randState ^= randState << 13
	randState ^= randState >> 7
	randState ^= randState << 17
	return randState
}

func safeCall(fn func()) {
	defer func() { recover() }() //nolint:errcheck
	fn()
}
