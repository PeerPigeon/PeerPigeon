<template>
  <div id="app">
    <header>
      <h1>🕊️ PeerPigeon Demo</h1>
      <p>Distributed peer messaging using WebRTC and PartialMesh</p>
    </header>

    <main>
      <!-- Control Panel -->
      <section class="control-panel">
        <div class="button-group">
          <div class="effective-session-inline" :title="effectiveSessionId">
            <span class="field-label">Effective Session</span>
            <span class="effective-session-value">{{ effectiveSessionId }}</span>
          </div>
          <div class="share-link-inline">
            <span class="field-label">Share</span>
            <div class="share-link-actions">
              <button
                type="button"
                class="btn btn-small"
                data-testid="copy-share-link"
                @click="copyShareLink"
              >
                Copy Link
              </button>
              <button
                type="button"
                class="btn btn-small"
                data-testid="copy-perf-dump-link"
                @click="copyPerfDumpLink"
              >
                Perf Dump
              </button>
            </div>
          </div>
          <label class="field field-topology-inline">
            <span class="field-label">Topology</span>
            <select
              v-model="topology"
              @change="onTopologyChange"
              :disabled="isConnecting"
              class="input"
              data-testid="topology"
            >
              <option value="token-ring">Token Ring (target 2, tolerant 1)</option>
              <option value="star">Star (1-20)</option>
              <option value="partial-mesh">Partial Mesh (2-5)</option>
              <option value="dense-mesh">Dense Mesh (3-10)</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <div class="button-actions">
            <button 
              @click="startMesh" 
              :disabled="isRunning || isConnecting"
              class="btn btn-primary"
              data-testid="start-mesh"
            >
              {{ isConnecting ? 'Connecting...' : 'Start Mesh' }}
            </button>
            <button 
              @click="stopMesh" 
              :disabled="!isRunning"
              class="btn btn-danger"
              data-testid="stop-mesh"
            >
              Stop Mesh
            </button>
          </div>

          <div class="status-field" :class="`status-${status.type}`" data-testid="status-message">
            {{ status.message || 'Idle' }}
          </div>
        </div>

        <div class="config-grid">
          <label class="field">
            <span class="field-label">Server</span>
            <input
              v-model.trim="signalingServer"
              :disabled="isRunning || isConnecting"
              class="input"
              data-testid="signaling-server"
              placeholder="wss://peer.ooo/ws"
            />
          </label>

          <label class="field">
            <span class="field-label">Network Name</span>
            <input
              v-model.trim="networkName"
              :disabled="isRunning || isConnecting"
              class="input"
              data-testid="network-name"
              placeholder="peerpigeon"
            />
          </label>

          <label class="field">
            <span class="field-label">Room / Session ID</span>
            <input
              v-model.trim="roomSessionId"
              :disabled="isRunning || isConnecting"
              class="input"
              data-testid="room-session-id"
              placeholder="my-room"
            />
          </label>

          <label class="field field-number">
            <span class="field-label">Min Peers</span>
            <input
              v-model.number="minPeers"
              @input="onPeerBoundsInput"
              type="number"
              min="1"
              max="50"
              :disabled="isRunning || isConnecting"
              class="input"
              data-testid="min-peers"
            />
          </label>

          <label class="field field-number">
            <span class="field-label">Max Peers</span>
            <input
              v-model.number="maxPeers"
              @input="onPeerBoundsInput"
              type="number"
              min="1"
              max="50"
              :disabled="isRunning || isConnecting"
              class="input"
              data-testid="max-peers"
            />
          </label>

          <label class="field field-number">
            <span class="field-label">Tolerant</span>
            <input
              v-model.number="tolerantPeers"
              @input="onPeerBoundsInput"
              type="number"
              min="0"
              max="20"
              :disabled="isRunning || isConnecting"
              class="input"
              data-testid="tolerant-peers"
            />
          </label>

        </div>

        <div v-if="isRunning" class="control-stats-row">
          <div class="control-stat">
            <span class="control-stat-label">Peer ID</span>
            <span class="control-stat-value mono" :title="clientId" data-testid="client-id">{{ peerIdDisplay }}</span>
          </div>
          <div class="control-stat">
            <span class="control-stat-label">Connected</span>
            <span class="control-stat-value" data-testid="connected-peers">{{ connectedPeers }} / {{ maxPeers }}</span>
          </div>
          <div class="control-stat">
            <span class="control-stat-label">Discovered</span>
            <span class="control-stat-value" data-testid="discovered-peers">{{ discoveredPeers }}</span>
          </div>
          <div class="control-stat">
            <span class="control-stat-label">Gossips</span>
            <span class="control-stat-value" data-testid="messages-seen">{{ messagesSeen }}</span>
          </div>
        </div>

        <div class="workspace-tabs" v-if="isRunning">
          <div class="tab-nav" role="tablist" aria-label="PeerPigeon panels">
            <button
              v-for="tab in uiTabs"
              :key="tab.id"
              type="button"
              role="tab"
              class="tab-btn"
              :aria-selected="activeTab === tab.id"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>

          <div v-if="activeTab === 'message'" class="tab-panel chat" role="tabpanel" aria-label="Message panel">
            <h3>💬 Message</h3>
            <div class="log-controls">
              <button @click="clearLog" class="btn btn-small">Clear</button>
              <label>
                <input v-model="autoScroll" type="checkbox" />
                Auto-scroll
              </label>
            </div>
            <div ref="logContainer" class="log-container chat-container">
              <div
                v-for="(entry, idx) in chatMessages"
                :key="idx"
                :class="['log-entry', entry.type, { local: entry.local }]"
              >
                <div class="bubble" :class="entryBubbleClass(entry)">
                  <div class="bubble-meta">
                    <span class="sender">{{ entry.local ? 'You' : entry.sender.slice(0, 6) }}</span>
                    <span class="timestamp">{{ formatTime(entry.timestamp) }}</span>
                  </div>
                  <div class="bubble-text">{{ entry.text }}</div>
                  <div v-if="entry.hops > 0" class="bubble-hops">{{ entry.hops === 1 ? '1 hop' : entry.hops + ' hops' }}</div>
                </div>
              </div>
            </div>

            <div class="message-input">
              <div class="message-mode-controls">
                <label class="mode-toggle">
                  <input v-model="directMode" type="checkbox" />
                  Direct
                </label>
                <select
                  v-if="directMode"
                  v-model="dmTarget"
                  class="input message-target-select"
                  data-testid="dm-target"
                >
                  <option value="" disabled>{{ globalPeersList.length ? 'Select peer…' : 'Waiting for peers…' }}</option>
                  <option v-for="p in globalPeersList" :key="p" :value="p">{{ p.slice(0,8) }}…</option>
                </select>
              </div>
              <input
                v-model="messageInput"
                @keyup.enter="sendMessage"
                :disabled="!isRunning"
                :placeholder="directMode ? 'Type a direct message…' : 'Type a message...'"
                data-testid="dm-input"
                class="input"
              />
              <button
                @click="sendMessage"
                :disabled="!isRunning || !messageInput.trim() || (directMode && !dmTarget)"
                class="btn btn-secondary"
                data-testid="dm-send"
              >
                {{ directMode ? 'Send Direct' : 'Send' }}
              </button>
            </div>
          </div>

          <div v-else-if="activeTab === 'media'" class="tab-panel feature-panel" role="tabpanel" aria-label="Media panel">
            <h3>🎬 Media</h3>
            <p class="feature-copy">Media controls are scaffolded here for upcoming file and stream sharing workflows.</p>
          </div>

          <div v-else-if="activeTab === 'storage'" class="tab-panel feature-panel" role="tabpanel" aria-label="Storage panel">
            <h3>🗄 Storage</h3>
            <p class="feature-copy">Key/value storage synced across peers over gossip.</p>

            <div class="storage-head">
              <div class="storage-badge" :class="storageReady ? 'ready' : 'idle'">
                {{ storageReady ? 'Synced' : 'Waiting for mesh identity' }}
              </div>
              <div class="storage-help">Session: <span class="mono">{{ effectiveSessionId }}</span></div>
            </div>

            <div class="storage-controls">
              <label class="field storage-space-field">
                <span class="field-label">Space</span>
                <select v-model="storageActiveSpace" class="input" @change="refreshStorageList">
                  <option value="user">user</option>
                  <option value="private">private</option>
                  <option value="public">public</option>
                  <option value="frozen">frozen</option>
                  <option value="epublic">epublic (read-only)</option>
                </select>
              </label>

              <label v-if="storageActiveSpace === 'user'" class="field storage-owner-field">
                <span class="field-label">Lookup owner pub key</span>
                <input
                  v-model="storageLookupOwnerId"
                  class="input"
                  placeholder="blank = your pub key"
                  @input="refreshStorageList"
                />
              </label>

              <label class="field storage-key-field">
                <span class="field-label">Key</span>
                <div class="storage-key-row">
                  <input v-model="storageFormKey" class="input" placeholder="e.g. profile.theme" />
                  <button
                    class="btn btn-small storage-get-sync-btn"
                    :class="{ active: isStorageKeyInterested(storageActiveSpace, storageFormKey) }"
                    :disabled="!storageFormKey.trim() || !isRunning || !storageReady"
                    @click="getSyncStorageKey"
                  >GET &amp; SYNC</button>
                </div>
              </label>

              <label class="field storage-value-field">
                <span class="field-label">Value (JSON or text)</span>
                <input v-model="storageFormValue" class="input" placeholder='{"darkMode":true}' :disabled="storageActiveSpace === 'epublic'" />
              </label>

              <div class="storage-actions">
                <button class="btn btn-secondary" :disabled="storageActiveSpace === 'epublic' || !isRunning || !storageReady || storageBusy || !storageFormKey.trim()" @click="saveStorageEntry">
                  Save
                </button>
                <button class="btn btn-danger" :disabled="storageActiveSpace === 'epublic' || !isRunning || !storageReady || storageBusy || !storageFormKey.trim()" @click="deleteStorageEntry">
                  Delete
                </button>
                <button class="btn" :disabled="!isRunning || storageBusy" @click="refreshStorageList">
                  Refresh
                </button>
              </div>
            </div>

            <div class="storage-space-note">{{ storageSpaceDescription }}</div>

            <div class="storage-interest-list" v-if="interestedKeysForSpace(storageActiveSpace).length">
              <div class="storage-interest-head">
                <span class="storage-interest-title">Interested keys ({{ storageActiveSpace }})</span>
                <button class="btn btn-small" @click="clearStorageKeyInterestForSpace(storageActiveSpace)">Clear all</button>
              </div>
              <div class="storage-interest-chips">
                <button
                  v-for="interest in interestedKeysForSpace(storageActiveSpace)"
                  :key="interest.pk"
                  class="storage-interest-chip"
                  @click="setStorageKeyInterest(storageActiveSpace, interest.key, false, interest.ownerId)"
                  :title="`Stop syncing ${interest.key}`"
                >
                  <span class="mono">{{ interest.key }}</span>
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </div>

            <div v-if="storageError" class="storage-error">{{ storageError }}</div>

            <div class="storage-table-wrap">
              <table class="storage-table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                    <th>{{ storageOwnerLabel() }}</th>
                    <th>Ver</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="storageRecords.length === 0">
                    <td colspan="5" class="storage-empty">No records in {{ storageActiveSpace }} space.</td>
                  </tr>
                  <tr v-for="record in storageRecords" :key="`${record.space}:${record.key}`" @click="selectStorageRecord(record)">
                    <td class="mono">{{ record.key }}</td>
                    <td class="mono storage-value-cell">{{ storageRecordPreview(record.value) }}</td>
                    <td class="mono">{{ record.ownerId ? `${record.ownerId}${record.ownerId === storageUserId() ? ' (You)' : ''}` : '-' }}</td>
                    <td>{{ formatStorageVersion(record.version) }}</td>
                    <td>{{ formatTime(record.updatedAt) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-else-if="activeTab === 'crypto'" class="tab-panel feature-panel" role="tabpanel" aria-label="Crypto panel">
            <h3>🔐 Crypto</h3>
            <p class="feature-copy">Broadcasts use room-scoped encryption. Direct messages use peer-targeted UNSEA envelopes.</p>

            <div class="crypto-grid">
              <div class="crypto-card">
                <h4>Public Info</h4>
                <div class="crypto-row">
                  <span class="crypto-label">Peer ID</span>
                  <span class="crypto-value mono">{{ clientId || (isRunning ? 'Reconnecting…' : 'Not connected') }}</span>
                </div>
                <div class="crypto-row">
                  <span class="crypto-label">Sign Public</span>
                  <span class="crypto-value mono">{{ localPublicCryptoInfo?.pub || 'Loading…' }}</span>
                </div>
                <div class="crypto-row">
                  <span class="crypto-label">Encrypt Public</span>
                  <span class="crypto-value mono">{{ localPublicCryptoInfo?.epub || 'Loading…' }}</span>
                </div>
              </div>

              <div class="crypto-card">
                <div class="crypto-private-head">
                  <h4>Private Info</h4>
                  <button
                    type="button"
                    class="btn btn-small crypto-visibility-btn"
                    @click="showPrivateCrypto = !showPrivateCrypto"
                    :aria-pressed="showPrivateCrypto"
                  >
                    <span class="icon-eye" aria-hidden="true">{{ showPrivateCrypto ? '🙈' : '👁' }}</span>
                    <span>{{ showPrivateCrypto ? 'Hide' : 'Show' }}</span>
                  </button>
                </div>
                <div class="crypto-row">
                  <span class="crypto-label">Sign Private</span>
                  <span class="crypto-value mono">{{ showPrivateCrypto ? (localPrivateCryptoInfo?.priv || 'Loading…') : maskSecret(localPrivateCryptoInfo?.priv) }}</span>
                </div>
                <div class="crypto-row">
                  <span class="crypto-label">Encrypt Private</span>
                  <span class="crypto-value mono">{{ showPrivateCrypto ? (localPrivateCryptoInfo?.epriv || 'Loading…') : maskSecret(localPrivateCryptoInfo?.epriv) }}</span>
                </div>
              </div>

              <div class="crypto-card crypto-card-wide">
                <h4>Known Peer Public Keys</h4>
                <div v-if="remoteCryptoPeers.length === 0" class="crypto-empty">No remote public keys learned yet.</div>
                <div v-else class="crypto-peer-list">
                  <div v-for="([peerId, info], idx) in remoteCryptoPeers" :key="`${peerId}-${idx}`" class="crypto-peer-row">
                    <span class="crypto-peer-id mono">{{ peerId }}</span>
                    <span class="crypto-peer-key mono">pub: {{ info.pub }}</span>
                    <span class="crypto-peer-key mono">epub: {{ info.epub }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Peer Network Visualization -->
      <section v-if="isRunning" class="network-viz">
        <h3>📊 Network Graph</h3>
        <div ref="networkGraphContainer" class="network-graph-container" data-testid="mesh-visualizer">
          <svg ref="networkGraphSvg" class="network-graph-svg"></svg>
        </div>
        <div class="mesh-visualizer-caption">Live connected topology from <code>epublic/mesh:peers</code>; labels are each peer ID's first 4 characters (hover for the full ID)</div>
      </section>

      <!-- Diagnostics -->
      <section class="chat diagnostics" v-if="isRunning">
        <h3>🛠 Diagnostics</h3>
        <div ref="diagLogContainer" class="log-container diag-container" data-testid="diag-log">
          <div
            v-for="(entry, idx) in diagnosticMessages"
            :key="`diag-${idx}`"
            class="diag-entry"
          >
            <span class="diag-time">{{ formatTime(entry.timestamp) }}</span>
            <span class="diag-sender">{{ entry.sender }}</span>
            <span class="diag-text">{{ entry.text }}</span>
          </div>
          <div v-if="diagnosticMessages.length === 0" class="diag-empty">No diagnostics yet</div>
        </div>
      </section>

    </main>
  </div>
</template>

<script>
import { PartialMesh } from 'peerpigeon';
import { GossipProtocol } from 'peerpigeon';
import { PeerPigeonStorage } from 'peerpigeon';
import { generateRandomPair, encryptMessageWithMeta, decryptMessageWithMeta } from 'unsea';
import * as d3 from 'd3';

const DEFAULT_TOPOLOGY = 'token-ring';
const CRYPTO_PUBLIC_INFO_TYPE = 'pp-crypto-public-info-v1';
const CRYPTO_PUBLIC_REQUEST_TYPE = 'pp-crypto-public-request-v1';
const ENCRYPTED_BROADCAST_TYPE = 'pp-encrypted-broadcast-v1';
const ENCRYPTED_DIRECT_TYPE = 'pp-encrypted-direct-v1';
const STORAGE_SYNC_ENVELOPE_TYPE = 'pp-storage-sync-v1';
const MESH_PEERS_STORAGE_KEY = 'mesh:peers';
const MESH_PEERS_STORAGE_SPACE = 'epublic';
const MESH_PEERS_HEARTBEAT_MS = 12_000;
const MESH_PEERS_STALE_AFTER_MS = MESH_PEERS_HEARTBEAT_MS * 6;
const MESH_PEERS_MAX_SNAPSHOTS = 80;
const DEBUG_MONITOR_INTERVAL_MS = 1000;
const DEBUG_MONITOR_PEER_LOG_MIN_GAP_MS = 2500;

function toBase64Url(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(base64url) {
  const raw = String(base64url || '');
  const padded = raw.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(raw.length / 4) * 4, '=');
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export default {
  name: 'PeerPigeonDemo',
  data() {
    return {
      mesh: null,
      gossip: null,
      isRunning: false,
      isConnecting: false,
      signalingConnected: false,
      messageInput: '',
      directMode: false,
      activeTab: 'message',
      dmTarget: '',
      showPrivateCrypto: false,
      clientId: '',
      connectedPeersList: [],
      discoveredPeersList: [],
      globalPeersList: [],
      messagesSeen: 0,
      maxPeers: 5,
      minPeers: 2,
      tolerantPeers: 1,
      topology: DEFAULT_TOPOLOGY,
      networkName: 'peerpigeon',
      roomSessionId: '',
      signalingServer: 'wss://peer.ooo/ws',
      messageLog: [],
      autoScroll: true,
      status: {
        title: '',
        message: '',
        type: 'info'
      },
      cryptoKeys: null,
      cryptoPublicDirectory: {},
      pendingDirectMessages: {},
      cryptoStorageKey: 'peerpigeon:unsea:keypair:v1',
      cryptoAnnounceTimer: null,
      storage: null,
      storageIdentity: '',
      storageReady: false,
      storageBusy: false,
      storageError: '',
      storageActiveSpace: 'user',
      storageLookupOwnerId: '',
      storageFormKey: '',
      storageFormValue: '',
      storageRecords: [],
      storageChangeUnsubscribe: null,
      storageInterestedKeys: {},
      storageInterestSyncInFlight: false,
      storageInterestSyncQueued: false,
      storageInterestSyncPendingSpaces: new Set(),
      meshPeersStorageSpace: MESH_PEERS_STORAGE_SPACE,
      meshPeersStorageKey: MESH_PEERS_STORAGE_KEY,
      sharedMeshPeerSnapshots: {},
      meshPeersPublishTimer: null,
      meshPeersRetrieveTimer: null,
      meshPeersPublishInFlight: false,
      meshPeersLastLocalSignature: '',
      meshPeersLastPublishedAt: 0,
      meshPeersLastSignature: '',
      uiStateKey: 'peerpigeon:ui-state',
      uiTabs: [
        { id: 'message', label: 'Message' },
        { id: 'media', label: 'Media' },
        { id: 'storage', label: 'Storage' },
        { id: 'crypto', label: 'Crypto' }
      ],
      graphStabilizeTimer: null,
      graphUpdateTimer: null,
      meshConnectWarnTimer: null,
      graphLastSignature: '',
      networkGraphState: null,
      networkGraphResizeHandler: null,
      networkGraphResizeObserver: null,
      networkGraphResizeObservedElement: null,
      debugMonitorTimer: null,
      debugLastByPeer: {},
      debugLastLogAtByPeer: {},
      runtimeMode: 'go-wasm',
      goWasmNodeId: null,
      goWasmHandlers: {
        messageReceived: new Set(),
        directMessageReceived: new Set(),
      },
      goWasmStorageNotify: null,
      goWasmLoadPromise: null,
      goWasmStarted: false,
    };
  },
  mounted() {
    window.__app = this;
    const params = new URLSearchParams(window.location.search);
    const runtimeParam = String(params.get('runtime') || params.get('engine') || '').trim().toLowerCase();
    if (runtimeParam === 'js' || runtimeParam === 'javascript') {
      this.runtimeMode = 'js';
    } else if (runtimeParam === 'go' || runtimeParam === 'go-wasm' || runtimeParam === 'wasm') {
      this.runtimeMode = 'go-wasm';
    }

    // ==== IMPORTANT: URL params take ABSOLUTE priority for test isolation ====
    // Check for explicit sessionId param FIRST (before any session-state fallback)
    const sessionIdParam = params.get('sessionId') || params.get('roomSessionId') || params.get('room');
    const hasExplicitSessionId = sessionIdParam != null;

    // Parse all other URL params
    const topologyParam = (params.get('topology') || '').trim().toLowerCase();
    if (this.isKnownTopology(topologyParam)) {
      this.topology = topologyParam;
    } else {
      this.topology = DEFAULT_TOPOLOGY;
    }

    const hasMaxPeersParam = params.get('maxPeers') != null;
    const hasMinPeersParam = params.get('minPeers') != null;
    const hasTolerantPeersParam = params.get('tolerantPeers') != null || params.get('tolerant') != null;

    if (!hasMaxPeersParam && !hasMinPeersParam && !hasTolerantPeersParam) {
      this.applyTopologyPreset(this.topology);
    }

    // If URL does not provide a sessionId, use a fresh random room by default.
    if (hasExplicitSessionId) {
      this.roomSessionId = sessionIdParam;
    } else {
      this.roomSessionId = this.generateRandomRoomSessionId();
    }

    const maxPeersParam = Number(params.get('maxPeers'));
    if (Number.isFinite(maxPeersParam) && maxPeersParam >= 1) {
      this.maxPeers = Math.min(50, Math.floor(maxPeersParam));
    }

    const minPeersParam = Number(params.get('minPeers'));
    if (Number.isFinite(minPeersParam) && minPeersParam >= 1) {
      this.minPeers = Math.min(50, Math.floor(minPeersParam));
    }

    const tolerantRaw = params.get('tolerantPeers') ?? params.get('tolerant');
    if (tolerantRaw != null) {
      const tolerantPeersParam = Number(tolerantRaw);
      if (Number.isFinite(tolerantPeersParam) && tolerantPeersParam >= 0) {
        this.tolerantPeers = Math.min(20, Math.floor(tolerantPeersParam));
      }
    }

    if (this.minPeers > this.maxPeers) {
      this.minPeers = this.maxPeers;
    }

    this.reconcileTopologyWithPeerBounds();

    const networkNameParam = params.get('networkName') || params.get('network');
    if (networkNameParam) {
      this.networkName = networkNameParam;
    }

    const signalingServerParam = params.get('signalingServer') || params.get('signalUrl');
    if (signalingServerParam) {
      this.signalingServer = signalingServerParam;
    }

    // Restore persisted UI state before any autostart/network events can write defaults.
    this.loadUiState();

    // Local-first storage should be available even before mesh/gossip is connected.
    // In go-wasm mode, wait for node creation to avoid a transient js-storage -> wasm-storage swap.
    if (this.activeTab === 'storage') {
      this.ensureStorageReady({ fastPath: true }).catch((error) => {
        this.storageError = String(error?.message || error || 'Failed to initialize storage');
      });
    }

    const autostart = (params.get('autostart') || '1').toLowerCase();
    if (autostart === '1' || autostart === 'true' || autostart === 'yes') {
      this.startMesh();
    }

    // Normalize/shareable URL immediately on load so defaults are explicit
    // and subsequent topology changes reuse the same URL state.
    this.updateUrlState();
    this.networkGraphResizeHandler = () => {
      this.scheduleNetworkGraphRender({ immediate: true, reason: 'resize' });
    };
    window.addEventListener('resize', this.networkGraphResizeHandler);
  },
  computed: {
    effectiveSessionId() {
      const network = this.activeNetworkName;
      const room = this.activeRoomSessionId;

      if (network && room) return `${network}:${room}`;
      return network || room || 'default';
    },
    activeNetworkName() {
      return String(this.networkName || '').trim();
    },
    activeRoomSessionId() {
      return String(this.roomSessionId || '').trim();
    },
    connectedPeers() {
      return this.connectedPeersList.length;
    },
    peerIdDisplay() {
      const id = String(this.clientId || '').trim();
      if (!id) return '';
      if (id.length <= 18) return id;
      return `${id.slice(0, 10)}...${id.slice(-6)}`;
    },
    discoveredPeers() {
      return this.discoveredPeersList.length;
    },
    chatMessages() {
      return this.messageLog.filter(e => e.type === 'sent' || e.type === 'received');
    },
    diagnosticMessages() {
      return this.messageLog.filter(e => e.type !== 'sent' && e.type !== 'received');
    },
    localPublicCryptoInfo() {
      if (!this.cryptoKeys?.pub || !this.cryptoKeys?.epub) return null;
      return {
        pub: this.cryptoKeys.pub,
        epub: this.cryptoKeys.epub
      };
    },
    localPrivateCryptoInfo() {
      if (!this.cryptoKeys?.priv || !this.cryptoKeys?.epriv) return null;
      return {
        priv: this.cryptoKeys.priv,
        epriv: this.cryptoKeys.epriv
      };
    },
    remoteCryptoPeers() {
      const self = String(this.clientId || '').trim();
      return Object.entries(this.cryptoPublicDirectory)
        .filter(([peerId, info]) => peerId && peerId !== self && info?.pub && info?.epub)
        .sort(([a], [b]) => a.localeCompare(b));
    },
    storageSpaceDescription() {
      if (this.storageActiveSpace === 'epublic') {
        return 'epublic: shared internal/system space. Read-only in UI.';
      }
      if (this.storageActiveSpace === 'public') {
        return 'public: anyone can read and mutate.';
      }
      if (this.storageActiveSpace === 'user') {
        return 'user: public read, only owning user can mutate.';
      }
      if (this.storageActiveSpace === 'frozen') {
        return 'frozen: public read, immutable after first write.';
      }
      return 'private: only local user can read/mutate; value is locally encrypted.';
    }
  },
  watch: {
    messageLog() {
      const last = this.messageLog[this.messageLog.length - 1];
      if (!last) return;
      if ((last.type === 'sent' || last.type === 'received') && this.autoScroll) {
        this.$nextTick(() => this.scrollToBottom());
      }
      if ((last.type !== 'sent' && last.type !== 'received') && this.autoScroll) {
        this.$nextTick(() => this.scrollDiagToBottom());
      }
    },
    activeTab(nextTab) {
      if (nextTab === 'storage') {
        this.ensureStorageReady({ fastPath: true }).catch((error) => {
          this.storageError = String(error?.message || error || 'Failed to initialize storage');
        });
      }
      this.saveUiState();
    },
    clientId() {
      this.$nextTick(() => this.scheduleNetworkGraphRender({ reason: 'client' }));
    },
    connectedPeersList: {
      deep: false,
      handler() {
        this.$nextTick(() => this.scheduleNetworkGraphRender({ reason: 'connected' }));
      }
    },
    networkName() {
      this.updateUrlState();
    },
    roomSessionId() {
      this.updateUrlState();
    }
  },
  methods: {
    shouldDeferStorageInit() {
      return false;
    },

    async copyShareLink() {
      this.updateUrlState();
      try {
        await navigator.clipboard.writeText(window.location.href);
        this.showStatus('Share link copied', 'Copied current session link to clipboard.', 'info');
      } catch (error) {
        this.showStatus('Copy failed', String(error?.message || error || 'Clipboard write failed'), 'error');
      }
    },

    perfNowMs() {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return Math.round(performance.now());
      }
      return 0;
    },

    getBrowserMemorySnapshot() {
      const out = {
        memory: null,
        uaSpecificMemory: null,
      };

      try {
        if (typeof performance !== 'undefined' && performance && performance.memory) {
          const memory = performance.memory;
          out.memory = {
            jsHeapSizeLimit: Number(memory.jsHeapSizeLimit || 0),
            totalJSHeapSize: Number(memory.totalJSHeapSize || 0),
            usedJSHeapSize: Number(memory.usedJSHeapSize || 0),
          };
        }
      } catch {
        // ignore unsupported memory API
      }

      return out;
    },

    summarizeResourceEntries() {
      try {
        if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
          return null;
        }

        const resources = performance.getEntriesByType('resource') || [];
        if (!Array.isArray(resources) || resources.length === 0) {
          return {
            count: 0,
            transferSizeTotal: 0,
            decodedBodySizeTotal: 0,
            topSlow: [],
          };
        }

        let transferSizeTotal = 0;
        let decodedBodySizeTotal = 0;
        const slowest = [];

        for (const entry of resources) {
          const transferSize = Number(entry?.transferSize || 0);
          const decodedBodySize = Number(entry?.decodedBodySize || 0);
          transferSizeTotal += Number.isFinite(transferSize) ? transferSize : 0;
          decodedBodySizeTotal += Number.isFinite(decodedBodySize) ? decodedBodySize : 0;

          slowest.push({
            name: String(entry?.name || '').slice(0, 180),
            initiatorType: String(entry?.initiatorType || ''),
            duration: Math.round(Number(entry?.duration || 0)),
            transferSize: Math.round(transferSize),
          });
        }

        slowest.sort((a, b) => b.duration - a.duration);

        return {
          count: resources.length,
          transferSizeTotal: Math.round(transferSizeTotal),
          decodedBodySizeTotal: Math.round(decodedBodySizeTotal),
          topSlow: slowest.slice(0, 8),
        };
      } catch {
        return null;
      }
    },

    summarizeNavigationEntry() {
      try {
        if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
          return null;
        }
        const navEntries = performance.getEntriesByType('navigation') || [];
        const nav = navEntries[0];
        if (!nav) return null;

        return {
          type: String(nav.type || ''),
          duration: Math.round(Number(nav.duration || 0)),
          domComplete: Math.round(Number(nav.domComplete || 0)),
          domContentLoaded: Math.round(Number(nav.domContentLoadedEventEnd || 0)),
          loadEventEnd: Math.round(Number(nav.loadEventEnd || 0)),
        };
      } catch {
        return null;
      }
    },

    async measureUaSpecificMemory() {
      try {
        const fn = globalThis?.performance?.measureUserAgentSpecificMemory;
        if (typeof fn !== 'function') return null;
        const sample = await Promise.race([
          fn.call(globalThis.performance),
          new Promise((resolve) => setTimeout(() => resolve(null), 1200)),
        ]);
        if (!sample) return null;

        return {
          bytes: Number(sample?.bytes || 0),
          breakdownCount: Array.isArray(sample?.breakdown) ? sample.breakdown.length : 0,
        };
      } catch {
        return null;
      }
    },

    toBase64UrlJson(payload) {
      const json = JSON.stringify(payload);
      const bytes = new TextEncoder().encode(json);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
      }
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    },

    async buildPerfDumpLink() {
      const startedAtMs = Date.now();
      const memory = this.getBrowserMemorySnapshot();
      memory.uaSpecificMemory = await this.measureUaSpecificMemory();

      const networkGraphNodeCount = Number(
        Object.keys(this.networkGraphState?.positions || {}).length || 0
      );

      const payload = {
        v: 1,
        kind: 'peerpigeon-perf-dump',
        createdAt: new Date().toISOString(),
        href: window.location.href,
        runtimeMode: this.runtimeMode,
        build: {
          mode: import.meta.env.MODE,
          dev: Boolean(import.meta.env.DEV),
          prod: Boolean(import.meta.env.PROD),
          baseUrl: import.meta.env.BASE_URL,
        },
        browser: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          languages: Array.isArray(navigator.languages) ? navigator.languages.slice(0, 8) : [],
          platform: navigator.platform,
          vendor: navigator.vendor,
          onLine: navigator.onLine,
          hardwareConcurrency: Number(navigator.hardwareConcurrency || 0),
          deviceMemory: Number(navigator.deviceMemory || 0),
          maxTouchPoints: Number(navigator.maxTouchPoints || 0),
          isSafariLike: /Safari\//.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent),
        },
        viewport: {
          innerWidth: Number(window.innerWidth || 0),
          innerHeight: Number(window.innerHeight || 0),
          pixelRatio: Number(window.devicePixelRatio || 1),
          visibilityState: document.visibilityState,
        },
        memory,
        perf: {
          nowMs: this.perfNowMs(),
          eventLoopHintMs: Date.now() - startedAtMs,
          navigation: this.summarizeNavigationEntry(),
          resources: this.summarizeResourceEntries(),
        },
        app: {
          isRunning: this.isRunning,
          isConnecting: this.isConnecting,
          signalingConnected: this.signalingConnected,
          status: {
            title: String(this.status?.title || ''),
            message: String(this.status?.message || ''),
            type: String(this.status?.type || ''),
          },
          activeTab: this.activeTab,
          connectedPeers: this.connectedPeersList.length,
          discoveredPeers: this.discoveredPeersList.length,
          globalPeers: this.globalPeersList.length,
          messagesSeen: Number(this.messagesSeen || 0),
          messageLogSize: this.messageLog.length,
          diagLogSize: this.diagnosticMessages.length,
          chatLogSize: this.chatMessages.length,
          storageReady: this.storageReady,
          storageSpace: this.storageActiveSpace,
          storageRecords: this.storageRecords.length,
          storageError: String(this.storageError || ''),
          meshSnapshots: Object.keys(this.sharedMeshPeerSnapshots || {}).length,
          graph: {
            hasState: Boolean(this.networkGraphState),
            width: Number(this.networkGraphState?.width || 0),
            height: Number(this.networkGraphState?.height || 0),
            nodeCount: networkGraphNodeCount,
            layoutVersion: Number(this.networkGraphState?.layoutVersion || 0),
          },
        },
      };

      const encoded = this.toBase64UrlJson(payload);
      const url = new URL(window.location.href);
      url.searchParams.set('ppPerfDump', encoded);
      return url.toString();
    },

    async copyPerfDumpLink() {
      try {
        const link = await this.buildPerfDumpLink();
        await navigator.clipboard.writeText(link);
        this.showStatus('Perf dump copied', 'Copied perf dump link to clipboard. Paste it in chat.', 'info');
      } catch (error) {
        this.showStatus('Perf dump failed', String(error?.message || error || 'Failed to build perf dump link'), 'error');
      }
    },

    storageNormalizeUserKey(ownerId, key) {
      const owner = String(ownerId || '').trim();
      let out = String(key || '').trim();
      if (!owner || !out) return out;
      const prefix = `${owner}::`;
      while (out.startsWith(prefix)) {
        out = out.slice(prefix.length);
      }
      return out;
    },

    storageLogicalKey(space, storeKey, record = null) {
      const normalizedSpace = String(space || '').trim();
      if (normalizedSpace !== 'user') {
        const key = String(record?.key || storeKey || '').trim();
        return key;
      }

      const owner = String(record?.ownerId || '').trim();
      const candidate = String(record?.key || '').trim() || String(storeKey || '').trim();
      if (!candidate) return '';
      return this.storageNormalizeUserKey(owner, candidate);
    },

    storageRecordPk(space, key, ownerId = null) {
      const normalizedSpace = String(space || '').trim();
      const normalizedKey = String(key || '').trim();
      if (!normalizedSpace || !normalizedKey) return '';
      if (normalizedSpace !== 'user') return normalizedKey;

      const owner = String(ownerId ?? this.storageUserId() ?? '').trim();
      if (!owner) return '';
      return `${owner}::${normalizedKey}`;
    },

    storageLookupUserId() {
      const lookup = String(this.storageLookupOwnerId || '').trim();
      if (lookup) return lookup;
      return this.storageUserId();
    },

    inferInterestedUserOwner() {
      const owners = new Set();
      for (const [pk, enabled] of Object.entries(this.storageInterestedKeys || {})) {
        if (enabled !== true || typeof pk !== 'string') continue;
        if (!pk.startsWith('user:')) continue;
        const rest = pk.slice('user:'.length);
        const splitAt = rest.indexOf(':');
        if (splitAt <= 0) continue;
        const owner = rest.slice(0, splitAt).trim();
        if (owner) owners.add(owner);
      }
      if (owners.size === 1) {
        return Array.from(owners)[0];
      }
      return '';
    },

    storageInterestPk(space, key, ownerId = null) {
      const normalizedSpace = String(space || '').trim();
      const normalizedKey = String(key || '').trim();
      if (!normalizedSpace || !normalizedKey) return '';
      if (normalizedSpace === 'user') {
        const owner = String(ownerId ?? this.storageLookupUserId() ?? '').trim();
        if (!owner) return '';
        return `${normalizedSpace}:${owner}:${normalizedKey}`;
      }
      return `${normalizedSpace}:${normalizedKey}`;
    },

    isStorageKeyInterested(space, key, ownerId = null) {
      const pk = this.storageInterestPk(space, key, ownerId);
      if (!pk) return false;
      return this.storageInterestedKeys[pk] === true;
    },

    interestedKeysForSpace(space, ownerId = null) {
      const normalizedSpace = String(space || '').trim();
      if (!normalizedSpace) return [];

      const out = [];
      const userOwner = normalizedSpace === 'user'
        ? String(ownerId ?? this.storageLookupUserId() ?? '').trim()
        : '';
      for (const [pk, enabled] of Object.entries(this.storageInterestedKeys)) {
        if (!enabled) continue;
        if (normalizedSpace !== 'user') {
          const prefix = `${normalizedSpace}:`;
          if (!pk.startsWith(prefix)) continue;
          const key = pk.slice(prefix.length);
          if (key) {
            out.push({ pk, key, ownerId: null });
          }
          continue;
        }

        if (!pk.startsWith('user:')) continue;
        const rest = pk.slice('user:'.length);
        const splitAt = rest.indexOf(':');

        // Backward-compatible handling for legacy persisted keys: "user:<key>"
        if (splitAt < 0) {
          const legacyKey = rest.trim();
          if (!legacyKey) continue;
          out.push({ pk, key: legacyKey, ownerId: userOwner || null });
          continue;
        }

        const owner = rest.slice(0, splitAt).trim();
        const key = rest.slice(splitAt + 1);
        if (!key) continue;
        if (userOwner && owner && owner !== userOwner) continue;
        if (userOwner && !owner) continue;
        out.push({ pk, key, ownerId: owner || null });
      }

      out.sort((a, b) => a.key.localeCompare(b.key));
      return out;
    },

    setStorageKeyInterest(space, key, enabled, ownerId = null) {
      const pk = this.storageInterestPk(space, key, ownerId);
      if (!pk) return;

      this.storageInterestedKeys = {
        ...this.storageInterestedKeys,
        [pk]: Boolean(enabled),
      };
      this.saveUiState();
      if (enabled === true) {
        this.requestInterestedKeySync('interest-added', [space]);
      }

      if (this.activeTab === 'storage') {
        this.refreshStorageList();
      }
    },

    getSyncStorageKey() {
      if (!this.storage) return;
      const space = this.storageActiveSpace;
      const key = String(this.storageFormKey || '').trim();
      if (!key) return;
      const isGoWasm = this.runtimeMode === 'go-wasm';

      const ownerId = this.storageActiveSpace === 'user'
        ? this.storageLookupUserId()
        : null;

      const wasInterested = this.isStorageKeyInterested(space, key, ownerId);
      if (!wasInterested) {
        this.setStorageKeyInterest(space, key, true, ownerId);
      }

      const wireKey = this.storageWireKey(space, key, ownerId);
      if (!wireKey) return;
      this.storage.retrieve(space, wireKey, { timeoutMs: 2500 })
        .then(() => {
          this.refreshStorageList({ silent: true });
          // go-wasm retrieve runs network fetch in background to avoid main-thread stalls.
          // Do a couple of delayed refreshes so newly fetched values surface even if no event races in.
          if (isGoWasm) {
            setTimeout(() => {
              this.refreshStorageList({ silent: true });
            }, 250);
            setTimeout(() => {
              this.refreshStorageList({ silent: true });
            }, 900);
          }
        })
        .catch((error) => {
          this.storageError = String(error?.message || error || 'Failed to sync storage key');
        });
    },

    async syncInterestedKeysForSpace(space, options = {}) {
      if (!this.storage || !this.storageReady) return;

      const normalizedSpace = String(space || '').trim();
      if (!this.isKnownStorageSpace(normalizedSpace)) return;

      const timeoutMs = Number(options?.timeoutMs ?? 1200);
      const interested = this.interestedKeysForSpace(normalizedSpace);
      if (!interested.length) return;

      const requests = [];
      for (const interest of interested) {
        const key = String(interest?.key || '').trim();
        if (!key) continue;
        const ownerId = normalizedSpace === 'user'
          ? String(interest?.ownerId || this.storageLookupUserId() || '').trim()
          : null;
        const wireKey = this.storageWireKey(normalizedSpace, key, ownerId);
        if (!wireKey) continue;
        requests.push(this.storage.retrieve(normalizedSpace, wireKey, { timeoutMs }));
      }

      if (!requests.length) return;
      await Promise.allSettled(requests);
    },

    async syncInterestedKeysForAllSpaces(options = {}) {
      if (!this.storage || !this.storageReady) return;
      const spaces = ['public', 'user', 'frozen', 'private', 'epublic']
        .filter((space) => this.interestedKeysForSpace(space).length > 0);
      if (!spaces.length) return;
      for (const space of spaces) {
        try {
          await this.syncInterestedKeysForSpace(space, options);
        } catch {
          // best-effort sync per space
        }
      }
    },

    requestInterestedKeySync(_reason = 'update', spaces = null, options = {}) {
      if (!this.storage || !this.storageReady) return;
      const requestedSpaces = Array.isArray(spaces)
        ? spaces
        : ['public', 'user', 'frozen', 'private', 'epublic'];
      for (const space of requestedSpaces) {
        if (!this.isKnownStorageSpace(space)) continue;
        this.storageInterestSyncPendingSpaces.add(space);
      }
      this.processInterestedKeySyncQueue(options).catch(() => {
        // best-effort background sync
      });
    },

    async processInterestedKeySyncQueue(options = {}) {
      if (!this.storage || !this.storageReady) return;
      if (this.storageInterestSyncInFlight) {
        this.storageInterestSyncQueued = true;
        return;
      }

      this.storageInterestSyncInFlight = true;
      try {
        const timeoutMs = Number(options?.timeoutMs ?? 1200);
        while (this.storageInterestSyncPendingSpaces.size > 0) {
          const [space] = Array.from(this.storageInterestSyncPendingSpaces);
          this.storageInterestSyncPendingSpaces.delete(space);
          await this.syncInterestedKeysForSpace(space, { timeoutMs });
        }
        if (this.activeTab === 'storage') {
          await this.refreshStorageList({ silent: true, syncInterested: false });
        }
      } finally {
        this.storageInterestSyncInFlight = false;
        if (this.storageInterestSyncQueued) {
          this.storageInterestSyncQueued = false;
          this.processInterestedKeySyncQueue(options).catch(() => {
            // best-effort background sync
          });
        }
      }
    },

    clearStorageKeyInterestForSpace(space, ownerId = null) {
      const normalizedSpace = String(space || '').trim();
      if (!normalizedSpace) return;

      const next = { ...this.storageInterestedKeys };
      if (normalizedSpace === 'user') {
        const owner = String(ownerId ?? this.storageLookupUserId() ?? '').trim();
        for (const pk of Object.keys(next)) {
          if (!pk.startsWith('user:')) continue;
          if (!owner) {
            delete next[pk];
            continue;
          }
          if (pk.startsWith(`user:${owner}:`)) {
            delete next[pk];
          }
        }
      } else {
        const prefix = `${normalizedSpace}:`;
        for (const pk of Object.keys(next)) {
          if (pk.startsWith(prefix)) {
            delete next[pk];
          }
        }
      }

      this.storageInterestedKeys = next;
      this.saveUiState();
      this.requestInterestedKeySync('interest-cleared', [normalizedSpace], { timeoutMs: 1000 });

      if (this.activeTab === 'storage') {
        this.refreshStorageList();
      }
    },

    parseStorageInput(text) {
      const raw = String(text ?? '').trim();
      if (!raw) return '';
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },

    storageRecordPreview(value) {
      if (typeof value === 'string') {
        return value.length > 140 ? `${value.slice(0, 137)}...` : value;
      }
      try {
        const json = JSON.stringify(value);
        return json.length > 140 ? `${json.slice(0, 137)}...` : json;
      } catch {
        return String(value);
      }
    },

    storageOwnerLabel() {
      if (this.storageActiveSpace === 'public' || this.storageActiveSpace === 'frozen' || this.storageActiveSpace === 'epublic') {
        return 'Modified By';
      }
      return 'Owner';
    },

    parseStorageVersionParts(version) {
      const raw = String(version ?? '').trim();
      if (!raw) {
        return { parts: [0, 0, 0, 0], source: '0' };
      }

      if (/^\d+$/.test(raw)) {
        const major = Math.max(0, Math.floor(Number(raw)));
        return { parts: [major, 0, 0, 0], source: '0' };
      }

      const split = raw.split('.');
      const numericParts = split.slice(0, 4);
      while (numericParts.length < 4) numericParts.push('0');
      const parts = numericParts.map((part) => {
        const n = Number(part);
        if (!Number.isFinite(n) || n < 0) return 0;
        return Math.floor(n);
      });

      const source = this.versionSourceToken(split[4] || '0');
      return { parts, source };
    },

    versionSourceToken(value) {
      const raw = String(value || '').trim();
      if (!raw) return '0';

      const digitsOnly = raw.replace(/\D/g, '');
      if (digitsOnly) {
        const trimmed = digitsOnly.slice(0, 10);
        return String(Number(trimmed));
      }

      const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (!cleaned) return '0';

      const hexPrefix = cleaned.replace(/[^0-9a-f]/g, '').slice(0, 8);
      if (hexPrefix.length >= 4) {
        return String(parseInt(hexPrefix, 16));
      }

      let hash = 2166136261;
      for (let i = 0; i < cleaned.length; i += 1) {
        hash ^= cleaned.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return String(hash >>> 0);
    },

    normalizeStorageVersion(version, fallbackSource = '0') {
      const parsed = this.parseStorageVersionParts(version);
      const [major, minor, patch, build] = parsed.parts;
      const source = parsed.source === '0'
        ? this.versionSourceToken(fallbackSource)
        : parsed.source;
      return `${major}.${minor}.${patch}.${build}.${source}`;
    },

    compareStorageVersions(a, b) {
      const left = this.parseStorageVersionParts(a).parts;
      const right = this.parseStorageVersionParts(b).parts;
      for (let i = 0; i < 4; i += 1) {
        if (left[i] > right[i]) return 1;
        if (left[i] < right[i]) return -1;
      }
      return 0;
    },

    formatStorageVersion(version) {
      return this.normalizeStorageVersion(version);
    },

    storageUserId() {
      // Prefer epub (ECDH public key) as stable storage identity, but fall
      // back to mesh client ID so storage can come up before crypto identity
      // is fully available.
      return String(this.cryptoKeys?.epub || this.mesh?.getClientId?.() || this.clientId || '').trim();
    },

    storageOpId() {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    },

    isKnownStorageSpace(space) {
      return space === 'user' || space === 'private' || space === 'public' || space === 'frozen' || space === 'epublic';
    },

    storageWireKey(space, key, ownerId = null) {
      const normalizedSpace = String(space || '').trim();
      const logicalKey = String(key || '').trim();
      if (!this.isKnownStorageSpace(normalizedSpace) || !logicalKey) return '';
      if (normalizedSpace !== 'user') return logicalKey;
      const owner = String(ownerId || '').trim();
      if (!owner) return '';
      return this.storageRecordPk('user', logicalKey, owner);
    },

    shouldReplaceStorageRecord(existing, incoming) {
      if (!existing) return true;
      const versionCmp = this.compareStorageVersions(incoming?.version, existing?.version);
      if (versionCmp > 0) return true;
      if (versionCmp < 0) return false;
      const incomingUpdatedAt = Number(incoming?.updatedAt ?? 0);
      const existingUpdatedAt = Number(existing?.updatedAt ?? 0);
      return incomingUpdatedAt > existingUpdatedAt;
    },

    async ensureStorageReady(options = {}) {
      const fastPath = options && options.fastPath === true;
      if (this.shouldDeferStorageInit()) {
        if (fastPath) {
          this.storageError = '';
          return;
        }
      }
      let userId = this.storageUserId();
      if (!userId) {
        await this.ensureCryptoKeys();
        userId = this.storageUserId();
      }
      if (!userId) {
        this.storageReady = false;
        this.storageError = 'Storage identity unavailable';
        return;
      }

      const gossipAttached = this.gossip ? '1' : '0';
      const nextIdentity = `js-storage::${this.effectiveSessionId}::${userId}::gossip:${gossipAttached}`;
      if (this.storageReady && this.storage && this.storageIdentity === nextIdentity) {
        if (!fastPath && this.gossip) {
          this.syncMeshPeersFromNetwork('storage-ready').catch(() => {
            // background best-effort network sync
          });
        } else if (this.gossip) {
          this.scheduleMeshPeersRetrieve('storage-tab');
        }
        await this.refreshStorageList({ silent: true, syncInterested: false });
        this.requestInterestedKeySync('storage-ready-existing');
        return;
      }

      if (this.storageChangeUnsubscribe) {
        this.storageChangeUnsubscribe();
        this.storageChangeUnsubscribe = null;
      }
      if (this.storage) {
        try {
          await this.storage.close();
        } catch {
          // ignore close failures
        }
      }

      const dbName = `peerpigeon-storage-v2:${this.effectiveSessionId}`;
      this.storage = new PeerPigeonStorage({
        userId,
        gossip: this.gossip || undefined,
        sessionId: this.effectiveSessionId,
        dbName,
      });
      await this.storage.init();
      this.storageIdentity = nextIdentity;
      this.storageChangeUnsubscribe = this.storage.subscribe((event) => {
        if (event?.space === this.meshPeersStorageSpace && event?.key === this.meshPeersStorageKey) {
          this.refreshMeshPeersFromStorage();
        }
        if (this.activeTab === 'storage') {
          this.refreshStorageList({ silent: true });
        }
      });

      this.storageReady = true;
      this.storageError = '';
      // Local-first: render from IndexedDB immediately.
      await this.refreshStorageList({ silent: true, syncInterested: false });

      if (!fastPath && this.gossip) {
        this.syncMeshPeersFromNetwork('storage-ready').catch(() => {
          // background best-effort network sync
        });
      } else if (this.gossip) {
        this.scheduleMeshPeersRetrieve('storage-tab-init');
      }
      this.scheduleMeshPeersPublish('storage-ready');
      this.requestInterestedKeySync('storage-ready-init');
    },

    teardownStorage() {
      this.storageReady = false;
      this.storageBusy = false;
      this.storageRecords = [];
      this.storageIdentity = '';
      this.storageInterestSyncInFlight = false;
      this.storageInterestSyncQueued = false;
      this.storageInterestSyncPendingSpaces = new Set();
      clearTimeout(this.meshPeersPublishTimer);
      this.meshPeersPublishTimer = null;
      clearTimeout(this.meshPeersRetrieveTimer);
      this.meshPeersRetrieveTimer = null;
      this.meshPeersPublishInFlight = false;
      this.meshPeersLastLocalSignature = '';
      this.meshPeersLastPublishedAt = 0;
      this.sharedMeshPeerSnapshots = {};
      this.meshPeersLastSignature = '';
      if (this.storageChangeUnsubscribe) {
        this.storageChangeUnsubscribe();
        this.storageChangeUnsubscribe = null;
      }
      if (this.storage) {
        this.storage.close().catch(() => {
          // ignore close failures
        });
      }
      this.storage = null;
    },

    async refreshStorageList(options = {}) {
      const silent = options && options.silent === true;
      const syncInterested = !(options && options.syncInterested === false);
      if (!silent) this.storageBusy = true;
      this.storageError = '';
      try {
        if (!this.storage) {
          this.storageRecords = [];
          return;
        }

        // Pull latest values for keys this peer explicitly follows before
        // rendering the local list, unless caller opts out for fast-path refresh.
        if (syncInterested && this.storageReady) {
          try {
            await this.syncInterestedKeysForSpace(this.storageActiveSpace, { timeoutMs: 1200 });
          } catch {
            // best-effort sync; continue rendering local snapshot
          }
        }

        const allRecords = await this.storage.list(this.storageActiveSpace);
        const selfOwner = this.storageUserId();
        const lookupOwner = this.storageActiveSpace === 'user' ? this.storageLookupUserId() : '';
        const userOwner = lookupOwner;
        const isRemoteUserLookup = this.storageActiveSpace === 'user'
          && String(userOwner || '').trim()
          && String(userOwner || '').trim() !== String(selfOwner || '').trim();
        const records = allRecords
          .filter((record) => {
            if (!record || record.deleted === true) return false;
            if (this.storageActiveSpace !== 'user') return true;
            // If own identity not loaded yet, show nothing rather than leaking
            if (!selfOwner) return false;
            if (String(record.ownerId || '').trim() !== String(userOwner || '').trim()) return false;

            const logicalKey = this.storageLogicalKey('user', record.key, record);
            if (!logicalKey) return false;

            if (isRemoteUserLookup && !this.isStorageKeyInterested('user', logicalKey, userOwner)) {
              return false;
            }
            return true;
          })
          .map((record) => ({
            space: this.storageActiveSpace,
            key: this.storageLogicalKey(this.storageActiveSpace, record.key, record),
            value: record.value,
            ownerId: record.ownerId ?? null,
            createdAt: Number(record.createdAt ?? 0),
            updatedAt: Number(record.updatedAt ?? 0),
            version: this.normalizeStorageVersion(record.version, record.ownerId || this.storageUserId()),
          }));

        const byLogicalKey = new Map();
        for (const record of records) {
          const key = String(record?.key || '').trim();
          if (!key) continue;
          const existing = byLogicalKey.get(key);
          if (!existing || this.shouldReplaceStorageRecord(existing, record)) {
            byLogicalKey.set(key, record);
          }
        }

        // Ensure interested keys are hydrated from local IndexedDB even when
        // no peers are connected (eventual remote sync is separate).
        const interested = this.interestedKeysForSpace(this.storageActiveSpace);
        if (interested.length > 0) {
          for (const interest of interested) {
            const logicalKey = String(interest?.key || '').trim();
            if (!logicalKey) continue;
            const ownerId = this.storageActiveSpace === 'user'
              ? String(interest?.ownerId || this.storageLookupUserId() || '').trim()
              : null;
            const storeKey = this.storageWireKey(this.storageActiveSpace, logicalKey, ownerId);
            if (!storeKey) continue;

            const localRecord = await this.storage.get(this.storageActiveSpace, storeKey);
            if (!localRecord || localRecord.deleted === true) continue;

            const merged = {
              space: this.storageActiveSpace,
              key: this.storageLogicalKey(this.storageActiveSpace, localRecord.key, localRecord),
              value: localRecord.value,
              ownerId: localRecord.ownerId ?? null,
              createdAt: Number(localRecord.createdAt ?? 0),
              updatedAt: Number(localRecord.updatedAt ?? 0),
              version: this.normalizeStorageVersion(localRecord.version, localRecord.ownerId || this.storageUserId()),
            };
            const outKey = String(merged.key || '').trim();
            if (!outKey) continue;

            const existing = byLogicalKey.get(outKey);
            if (!existing || this.shouldReplaceStorageRecord(existing, merged)) {
              byLogicalKey.set(outKey, merged);
            }
          }
        }

        this.storageRecords = Array.from(byLogicalKey.values())
          .sort((a, b) => String(a.key).localeCompare(String(b.key)));
      } catch (error) {
        this.storageError = String(error?.message || error || 'Failed to load storage');
      } finally {
        if (!silent) this.storageBusy = false;
      }
    },

    normalizeMeshPeersPayload(value) {
      const out = {};
      if (!value || typeof value !== 'object' || Array.isArray(value)) return out;

      for (const [rawPeerId, rawSnapshot] of Object.entries(value)) {
        const peerId = String(rawPeerId || rawSnapshot?.peerId || '').trim();
        if (!peerId) continue;

        const connectedPeers = [...new Set(
          (Array.isArray(rawSnapshot?.connectedPeers) ? rawSnapshot.connectedPeers : [])
            .map((peer) => String(peer || '').trim())
            .filter((peer) => peer && peer !== peerId)
        )].sort((a, b) => a.localeCompare(b));

        const updatedAtRaw = Number(rawSnapshot?.updatedAt ?? rawSnapshot?.seenAt ?? 0);
        const updatedAt = Number.isFinite(updatedAtRaw) && updatedAtRaw > 0
          ? Math.floor(updatedAtRaw)
          : 0;

        out[peerId] = {
          peerId,
          ownerId: String(rawSnapshot?.ownerId || '').trim() || null,
          connectedPeers,
          updatedAt,
        };
      }

      return out;
    },

    pruneStaleMeshPeerSnapshots(snapshots) {
      const now = Date.now();
      const out = {};
      for (const [peerId, snapshot] of Object.entries(snapshots || {})) {
        const normalizedPeerId = String(peerId || snapshot?.peerId || '').trim();
        const updatedAt = Number(snapshot?.updatedAt || 0);
        if (!normalizedPeerId) continue;
        if (!updatedAt) continue;
        if (now - updatedAt > MESH_PEERS_STALE_AFTER_MS) continue;

        out[normalizedPeerId] = {
          peerId: normalizedPeerId,
          ownerId: String(snapshot?.ownerId || '').trim() || null,
          connectedPeers: [...new Set((snapshot?.connectedPeers || []).map((peer) => String(peer || '').trim()).filter(Boolean))],
          updatedAt,
        };
      }

      const entries = Object.entries(out);
      if (entries.length > MESH_PEERS_MAX_SNAPSHOTS) {
        entries
          .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
          .slice(MESH_PEERS_MAX_SNAPSHOTS)
          .forEach(([id]) => {
            delete out[id];
          });
      }

      return out;
    },

    meshPeersSnapshotSignature(snapshots) {
      const entries = Object.entries(snapshots || {});
      if (!entries.length) return '';

      return entries
        .map(([peerId, snapshot]) => {
          const connected = Array.isArray(snapshot?.connectedPeers)
            ? snapshot.connectedPeers.map((peer) => String(peer || '').trim()).filter(Boolean).sort().join(',')
            : '';
          const updatedAt = Number(snapshot?.updatedAt || 0);
          return `${String(peerId || '').trim()}|${updatedAt}|${connected}`;
        })
        .sort()
        .join(';');
    },

    activeMeshPeerSnapshots() {
      return this.pruneStaleMeshPeerSnapshots(this.sharedMeshPeerSnapshots || {});
    },

    localMeshPeerSnapshot() {
      const peerId = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
      if (!peerId) return null;

      const connectedPeers = [...new Set(
        (Array.isArray(this.mesh?.getConnectedPeers?.()) ? this.mesh.getConnectedPeers() : [])
          .map((peer) => String(peer || '').trim())
          .filter((peer) => peer && peer !== peerId)
      )].sort((a, b) => a.localeCompare(b));

      return {
        peerId,
        ownerId: this.storageUserId() || null,
        connectedPeers,
        updatedAt: Date.now(),
      };
    },

    meshPeerSnapshotSignature(snapshot) {
      const peerId = String(snapshot?.peerId || '').trim();
      if (!peerId) return '';
      const connectedPeers = Array.isArray(snapshot?.connectedPeers) ? snapshot.connectedPeers : [];
      return `${peerId}|${connectedPeers.join(',')}`;
    },

    scheduleMeshPeersPublish(reason = 'update') {
      if (!this.isRunning) return;

      clearTimeout(this.meshPeersPublishTimer);
      this.meshPeersPublishTimer = setTimeout(() => {
        this.meshPeersPublishTimer = null;
        this.publishMeshPeersToStorage(reason);
      }, 140);
    },

    scheduleMeshPeersRetrieve(reason = 'update') {
      if (!this.isRunning || !this.storageReady || !this.storage) return;

      clearTimeout(this.meshPeersRetrieveTimer);
      this.meshPeersRetrieveTimer = setTimeout(() => {
        this.meshPeersRetrieveTimer = null;
        this.syncMeshPeersFromNetwork(reason).catch(() => {
          // ignore mesh snapshot retrieval failures
        });
      }, 120);
    },

    onMeshConnectionsChanged(reason = 'connection-change') {
      this.scheduleMeshPeersRetrieve(reason);
      this.scheduleMeshPeersPublish(reason);
    },

    async syncMeshPeersFromNetwork(_reason = 'update') {
      if (!this.storageReady || !this.storage) return;
      try {
        await this.storage.retrieve(this.meshPeersStorageSpace, this.meshPeersStorageKey, { timeoutMs: 1800 });
      } catch {
        // best-effort network retrieval; fall back to local state
      }

      await this.refreshMeshPeersFromStorage();
    },

    async refreshMeshPeersFromStorage() {
      if (!this.storageReady || !this.storage) return;

      try {
        const record = await this.storage.get(this.meshPeersStorageSpace, this.meshPeersStorageKey);
        const snapshots = this.pruneStaleMeshPeerSnapshots(this.normalizeMeshPeersPayload(record?.value));
        const signature = this.meshPeersSnapshotSignature(snapshots);
        if (signature === this.meshPeersLastSignature) {
          return;
        }
        this.meshPeersLastSignature = signature;
        this.sharedMeshPeerSnapshots = snapshots;
        this.$nextTick(() => this.scheduleNetworkGraphRender({ reason: 'mesh-storage' }));
      } catch {
        // ignore mesh snapshot sync failures
      }
    },

    async publishMeshPeersToStorage(reason = 'update') {
      if (!this.storageReady || !this.storage || !this.isRunning) return;
      if (this.meshPeersPublishInFlight) return;

      const localSnapshot = this.localMeshPeerSnapshot();
      if (!localSnapshot) return;

      const localSignature = this.meshPeerSnapshotSignature(localSnapshot);
      if (!localSignature) return;

      const now = Date.now();
      const publishAgeMs = now - Number(this.meshPeersLastPublishedAt || 0);
      const shouldHeartbeat = publishAgeMs >= MESH_PEERS_HEARTBEAT_MS;
      if (localSignature === this.meshPeersLastLocalSignature && reason !== 'storage-ready' && !shouldHeartbeat) {
        return;
      }

      this.meshPeersPublishInFlight = true;
      try {
        // Pull latest mesh:peers from network before writing so concurrent
        // publishers merge from a fresh base instead of clobbering snapshots.
        try {
          await this.storage.retrieve(this.meshPeersStorageSpace, this.meshPeersStorageKey, { timeoutMs: 1800 });
        } catch {
          // best-effort network retrieval; continue with local state
        }

        const existing = await this.storage.get(this.meshPeersStorageSpace, this.meshPeersStorageKey);
        const mergedBase = {
          ...this.activeMeshPeerSnapshots(),
          ...this.normalizeMeshPeersPayload(existing?.value),
        };
        const snapshots = this.pruneStaleMeshPeerSnapshots(mergedBase);

        // Peer ID can rotate on reload/reconnect; keep only newest entry per stable owner identity.
        const localOwnerId = String(localSnapshot.ownerId || '').trim();
        if (localOwnerId) {
          for (const [peerId, snapshot] of Object.entries(snapshots)) {
            if (peerId === localSnapshot.peerId) continue;
            const ownerId = String(snapshot?.ownerId || '').trim();
            if (ownerId && ownerId === localOwnerId) {
              delete snapshots[peerId];
            }
          }
        }

        const prior = snapshots[localSnapshot.peerId];
        const priorSignature = this.meshPeerSnapshotSignature(prior);
        const priorUpdatedAt = Number(prior?.updatedAt || 0);

        snapshots[localSnapshot.peerId] = localSnapshot;
        this.meshPeersLastSignature = this.meshPeersSnapshotSignature(snapshots);
        this.sharedMeshPeerSnapshots = snapshots;
        this.meshPeersLastLocalSignature = localSignature;

        const shouldRefreshTimestamp = now - priorUpdatedAt > MESH_PEERS_HEARTBEAT_MS;
        const needsWrite = priorSignature !== localSignature || !priorUpdatedAt || shouldRefreshTimestamp;
        if (!needsWrite) return;

        if (typeof this.storage.putSystem === 'function') {
          await this.storage.putSystem(this.meshPeersStorageSpace, this.meshPeersStorageKey, snapshots);
        } else {
          await this.storage.put(this.meshPeersStorageSpace, this.meshPeersStorageKey, snapshots);
        }
        this.meshPeersLastPublishedAt = now;
      } catch {
        // ignore mesh snapshot publish failures
      } finally {
        this.meshPeersPublishInFlight = false;
      }
    },

    selectStorageRecord(record) {
      this.storageFormKey = String(record?.key || '');
      try {
        this.storageFormValue = typeof record?.value === 'string'
          ? record.value
          : JSON.stringify(record?.value);
      } catch {
        this.storageFormValue = String(record?.value ?? '');
      }
    },

    async saveStorageEntry() {
      if (!this.storage) return;
      if (this.storageActiveSpace === 'epublic') {
        this.storageError = 'epublic is read-only in UI';
        return;
      }
      const initialKey = String(this.storageFormKey || '').trim();
      const key = this.storageActiveSpace === 'user'
        ? this.storageNormalizeUserKey(this.storageUserId(), initialKey)
        : initialKey;
      if (!key) return;

      this.storageBusy = true;
      this.storageError = '';
      try {
        const value = this.parseStorageInput(this.storageFormValue);
        const space = this.storageActiveSpace;
        const ownerId = this.storageUserId() || null;
        const storeKey = this.storageWireKey(space, key, ownerId);
        if (!storeKey) {
          throw new Error('missing owner public key for user space record');
        }

        const existing = await this.storage.get(space, storeKey);
        if (space === 'frozen' && existing && existing.deleted !== true) {
          throw new Error('frozen space keys are immutable once set');
        }

        if (space === 'user' && existing && existing.ownerId && existing.ownerId !== ownerId) {
          throw new Error('user space key is owned by another user');
        }

        await this.storage.put(space, storeKey, value, { ownerId: ownerId || undefined });
        await this.refreshStorageList();
      } catch (error) {
        this.storageError = String(error?.message || error || 'Failed to save storage key');
      } finally {
        this.storageBusy = false;
      }
    },

    async deleteStorageEntry() {
      if (!this.storage) return;
      if (this.storageActiveSpace === 'epublic') {
        this.storageError = 'epublic is read-only in UI';
        return;
      }
      const initialKey = String(this.storageFormKey || '').trim();
      const key = this.storageActiveSpace === 'user'
        ? this.storageNormalizeUserKey(this.storageUserId(), initialKey)
        : initialKey;
      if (!key) return;

      this.storageBusy = true;
      this.storageError = '';
      try {
        const space = this.storageActiveSpace;
        const ownerId = this.storageUserId() || null;
        const storeKey = this.storageWireKey(space, key, ownerId);
        if (!storeKey) {
          throw new Error('missing owner public key for user space record');
        }

        const existing = await this.storage.get(space, storeKey);

        if (space === 'user' && existing && existing.ownerId && existing.ownerId !== ownerId) {
          throw new Error('cannot delete user space key owned by another user');
        }

        await this.storage.delete(space, storeKey);
        await this.refreshStorageList();
      } catch (error) {
        this.storageError = String(error?.message || error || 'Failed to delete storage key');
      } finally {
        this.storageBusy = false;
      }
    },

    generateRandomRoomSessionId() {
      return `gp-${Math.random().toString(36).slice(2, 10)}`;
    },

    topologyPresetBounds(topology) {
      switch (topology) {
        case 'token-ring':
          // Keep ring behavior as the default target while allowing 2-node sessions.
          return { minPeers: 1, maxPeers: 2, tolerantPeers: 1 };
        case 'star':
          return { minPeers: 1, maxPeers: 20, tolerantPeers: 2 };
        case 'partial-mesh':
          return { minPeers: 2, maxPeers: 5, tolerantPeers: 1 };
        case 'dense-mesh':
          return { minPeers: 3, maxPeers: 10, tolerantPeers: 2 };
        default:
          return null;
      }
    },

    isKnownTopology(topology) {
      return ['token-ring', 'star', 'partial-mesh', 'dense-mesh', 'custom'].includes(topology);
    },

    normalizePeerBounds(minPeers, maxPeers, tolerantPeers) {
      const normalizedMin = Math.max(1, Math.min(50, Number(minPeers) || 1));
      const normalizedMax = Math.max(1, Math.min(50, Number(maxPeers) || 1));
      const normalizedTolerant = Math.max(0, Math.min(20, Math.floor(Number(tolerantPeers) || 0)));
      return {
        minPeers: Math.min(normalizedMin, normalizedMax),
        maxPeers: Math.max(normalizedMin, normalizedMax),
        tolerantPeers: normalizedTolerant
      };
    },

    applyTopologyPreset(topology) {
      const bounds = this.topologyPresetBounds(topology);
      if (!bounds) return;
      const normalized = this.normalizePeerBounds(bounds.minPeers, bounds.maxPeers, bounds.tolerantPeers);
      this.minPeers = normalized.minPeers;
      this.maxPeers = normalized.maxPeers;
      this.tolerantPeers = normalized.tolerantPeers;
    },

    reconcileTopologyWithPeerBounds() {
      const normalized = this.normalizePeerBounds(this.minPeers, this.maxPeers, this.tolerantPeers);
      this.minPeers = normalized.minPeers;
      this.maxPeers = normalized.maxPeers;
      this.tolerantPeers = normalized.tolerantPeers;

      const presets = ['token-ring', 'star', 'partial-mesh', 'dense-mesh'];
      for (const name of presets) {
        const bounds = this.topologyPresetBounds(name);
        if (!bounds) continue;
        if (
          bounds.minPeers === this.minPeers &&
          bounds.maxPeers === this.maxPeers &&
          bounds.tolerantPeers === this.tolerantPeers
        ) {
          this.topology = name;
          return;
        }
      }

      this.topology = 'custom';
    },

    onTopologyChange() {
      const shouldRestart = this.isRunning && !this.isConnecting;
      if (this.topology !== 'custom') {
        this.applyTopologyPreset(this.topology);
      }
      this.updateUrlState();
      if (shouldRestart) {
        this.restartMeshForTopologyChange();
      }
    },

    async restartMeshForTopologyChange() {
      if (this.isConnecting) return;
      this.showStatus('Reconfiguring...', 'Applying topology and restarting mesh...', 'connecting');
      this.stopMesh();
      await this.startMesh();
    },

    onPeerBoundsInput() {
      this.reconcileTopologyWithPeerBounds();
      this.updateUrlState();
    },

    noteGoWasmRuntimeExited(errorLike) {
      const message = String(errorLike?.message || errorLike || 'Go program has already exited');
      if (!message.includes('Go program has already exited')) {
        return false;
      }

      this.goWasmNodeId = null;
      this.goWasmStarted = false;
      this.goWasmLoadPromise = null;
      this.goWasmStorageNotify = null;
      this.storageReady = false;
      this.storage = null;
      this.storageError = 'Go runtime exited. Reload page to restart wasm runtime.';
      this.addLog('info', 'Go runtime exited; blocked further wasm calls until reload.', 'wasm');
      this.showStatus('Runtime exited', 'Go runtime exited. Reload page to continue.', 'error');
      return true;
    },

    callGoWasm(fnName, ...args) {
      if (this.runtimeMode !== 'go-wasm') return null;
      const fn = window[fnName];
      if (typeof fn !== 'function') {
        return null;
      }

      try {
        return fn(...args);
      } catch (error) {
        if (!this.noteGoWasmRuntimeExited(error)) {
          this.addLog('info', `WASM bridge error (${fnName}): ${String(error?.message || error || 'unknown')}`, 'wasm');
        }
        return null;
      }
    },

    async ensureGoWasmRuntimeLoaded() {
      if (this.runtimeMode !== 'go-wasm') return;
      if (typeof window.peerpigeonCreateNode === 'function') return;
      if (this.goWasmLoadPromise) {
        await this.goWasmLoadPromise;
        return;
      }

      this.goWasmLoadPromise = (async () => {
        if (!window.Go) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/wasm_exec.js';
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load wasm_exec.js'));
            document.head.appendChild(script);
          });
        }

        const go = new window.Go();
        let result;
        try {
          result = await WebAssembly.instantiateStreaming(fetch('/peerpigeon.wasm'), go.importObject);
        } catch {
          const resp = await fetch('/peerpigeon.wasm');
          if (!resp.ok) {
            throw new Error('Failed to fetch /peerpigeon.wasm');
          }
          const bytes = await resp.arrayBuffer();
          result = await WebAssembly.instantiate(bytes, go.importObject);
        }

        this.goWasmStarted = true;
        go.run(result.instance);

        const timeoutAt = Date.now() + 10_000;
        while (typeof window.peerpigeonCreateNode !== 'function') {
          if (Date.now() > timeoutAt) {
            throw new Error('peerpigeon wasm runtime did not initialize');
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      })();

      await this.goWasmLoadPromise;
    },

    toPeerDataUint8Array(data) {
      if (data instanceof Uint8Array) return data;
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
      if (typeof data === 'string') {
        return new TextEncoder().encode(data);
      }
      try {
        return new TextEncoder().encode(JSON.stringify(data));
      } catch {
        return new Uint8Array();
      }
    },

    createGoWasmGossipAdapter() {
      const invokeHandlers = (name, payload) => {
        for (const fn of this.goWasmHandlers[name]) {
          try {
            fn(payload);
          } catch {
            // keep bridge robust against handler errors
          }
        }
      };

      const bridge = {
        send: (peerId, payload) => {
          if (!this.mesh || typeof this.mesh.send !== 'function') return;
          try {
            this.mesh.send(peerId, payload);
          } catch {
            // Never throw into Go runtime from JS bridge callbacks.
          }
        },
        onMessageReceived: (event) => {
          invokeHandlers('messageReceived', {
            message: {
              data: event?.data,
              hops: Number(event?.hops || 0),
              sender: String(event?.sender || ''),
            },
            local: Boolean(event?.local),
            fromPeer: String(event?.fromPeer || ''),
          });
        },
        onDirectMessageReceived: (event) => {
          invokeHandlers('directMessageReceived', {
            message: event?.message || null,
          });
        },
        onStorageChange: (event) => {
          if (typeof this.goWasmStorageNotify === 'function') {
            this.goWasmStorageNotify(event || {});
          }
        },
      };

      const nextNodeId = this.callGoWasm('peerpigeonCreateNode', {
        clientId: this.clientId,
        sessionId: this.effectiveSessionId,
        userId: String(this.cryptoKeys?.epub || 'wasm-user').trim() || 'wasm-user',
        maxHops: 6,
      }, bridge);
      if (nextNodeId instanceof Error) {
        throw nextNodeId;
      }
      if (nextNodeId && typeof nextNodeId === 'object' && String(nextNodeId.name || '') === 'Error' && typeof nextNodeId.message === 'string') {
        throw new Error(nextNodeId.message);
      }
      if (nextNodeId == null) {
        throw new Error('failed to create go-wasm node');
      }
      this.goWasmNodeId = nextNodeId;

      return {
        on: (name, fn) => {
          if (!this.goWasmHandlers[name]) return;
          this.goWasmHandlers[name].add(fn);
        },
        broadcast: (data, metadata) => {
          return this.callGoWasm('peerpigeonBroadcast', this.goWasmNodeId, data, metadata || null);
        },
        sendDirect: (peerId, data) => {
          return this.callGoWasm('peerpigeonSendDirect', this.goWasmNodeId, peerId, data);
        },
        destroy: () => {
          if (this.goWasmNodeId != null) {
            this.callGoWasm('peerpigeonDestroyNode', this.goWasmNodeId);
          }
          this.goWasmNodeId = null;
          this.goWasmHandlers.messageReceived.clear();
          this.goWasmHandlers.directMessageReceived.clear();
        }
      };
    },

    createGoWasmStorageAdapter() {
      const subscribers = new Set();
      const invoke = (fnName, ...args) => {
        const result = this.callGoWasm(fnName, ...args);
        if (result instanceof Error) {
          throw result;
        }
        if (result && typeof result === 'object' && String(result.name || '') === 'Error' && typeof result.message === 'string') {
          throw new Error(result.message);
        }
        return result;
      };
      this.goWasmStorageNotify = (event) => {
        for (const fn of subscribers) {
          try {
            fn(event || {});
          } catch {
            // ignore storage subscriber errors
          }
        }
      };

      return {
        init: async () => {},
        close: async () => {
          subscribers.clear();
          this.goWasmStorageNotify = null;
        },
        subscribe: (fn) => {
          subscribers.add(fn);
          return () => subscribers.delete(fn);
        },
        list: async (space) => {
          return invoke('peerpigeonStorageList', this.goWasmNodeId, space) || [];
        },
        get: async (space, key) => {
          return invoke('peerpigeonStorageGet', this.goWasmNodeId, space, key);
        },
        retrieve: async (space, key, options = {}) => {
          return invoke('peerpigeonStorageRetrieve', this.goWasmNodeId, space, key, options || {});
        },
        put: async (space, key, value, _options = {}) => {
          return invoke('peerpigeonStoragePut', this.goWasmNodeId, space, key, value);
        },
        putSystem: async (space, key, value, _options = {}) => {
          return invoke('peerpigeonStoragePut', this.goWasmNodeId, space, key, value);
        },
        delete: async (space, key) => {
          return invoke('peerpigeonStorageDelete', this.goWasmNodeId, space, key);
        },
        deleteSystem: async (space, key) => {
          return invoke('peerpigeonStorageDelete', this.goWasmNodeId, space, key);
        },
      };
    },

    async startMesh() {
      try {
        const normalized = this.normalizePeerBounds(this.minPeers, this.maxPeers, this.tolerantPeers);
        this.minPeers = normalized.minPeers;
        this.maxPeers = normalized.maxPeers;
        this.tolerantPeers = normalized.tolerantPeers;
        this.reconcileTopologyWithPeerBounds();
        this.networkName = String(this.networkName || '').trim();
        this.roomSessionId = String(this.roomSessionId || '').trim();
        if (!this.roomSessionId) {
          this.roomSessionId = this.generateRandomRoomSessionId();
        }
        this.signalingServer = String(this.signalingServer || '').trim() || 'wss://peer.ooo/ws';
        this.updateUrlState();
        await this.ensureCryptoKeys();
        if (this.runtimeMode === 'go-wasm') {
          await this.ensureGoWasmRuntimeLoaded();
        }

        this.updateUrlState();

        this.isConnecting = true;
        this.showStatus('Connecting...', 'Initializing PartialMesh with PeerPigeon...', 'connecting');

        this.mesh = new PartialMesh({
          signalingServer: this.signalingServer,
          sessionId: this.effectiveSessionId,
          minPeers: this.minPeers,
          maxPeers: this.maxPeers,
          tolerantPeers: this.tolerantPeers,
          autoDiscover: true,
          autoConnect: true,
          // Helps highest-lexicographic peers (often Chrome in mixed-browser sessions)
          // avoid indefinite non-initiator wait when all discovered peers are smaller IDs.
          nonInitiatorFallbackDialMs: 2_500,
          underConnectedResetMs: 20_000
        });

        if (this.runtimeMode === 'go-wasm') {
          this.gossip = this.createGoWasmGossipAdapter();
        } else {
          this.gossip = new GossipProtocol(this.mesh);
        }

        if (this.activeTab === 'storage') {
          this.ensureStorageReady({ fastPath: true }).catch(() => {
            // best-effort: signaling lifecycle will retry initialization
          });
        }

        // Runtime inspection hook for debugging in dev tools / automation.
        window.__mesh = this.mesh;
        window.__gossip = this.gossip;

        // Mesh events
        this.mesh.on('signaling:connected', (data) => {
          this.signalingConnected = true;
          this.clientId = (data.clientId || '').trim();
          if (this.runtimeMode === 'go-wasm' && this.goWasmNodeId != null) {
            this.callGoWasm('peerpigeonSetClientID', this.goWasmNodeId, this.clientId);
          }
          this.addLog('signaling', `Connected to signaling server`, this.clientId);
          this.registerLocalPublicCryptoInfo();
          this.announceCryptoPublicInfo();
          this.ensureStorageReady().catch((error) => {
            this.storageError = String(error?.message || error || 'Failed to initialize storage');
          });
          this.updateStats();
        });

        this.mesh.on('signaling:disconnected', () => {
          this.signalingConnected = false;
          this.addLog('info', 'Signaling disconnected, waiting to reconnect...', 'signal');
          this.showStatus('Reconnecting', 'Signaling disconnected, attempting reconnect...', 'connecting');
          this.updateStats();
        });

        this.mesh.on('peer:discovered', (peerId) => {
          this.addLog('discovered', `Discovered peer`, peerId);
          this.updateStats();
        });

        this.mesh.on('signaling:connected', () => {
          this.addLog(
            'info',
            `Discovery snapshot: discovered=${this.mesh.getDiscoveredPeers().length}, connected=${this.mesh.getConnectedPeers().length}`,
            'debug'
          );
        });

        this.mesh.on('peer:connected', (peerId) => {
          if (this.runtimeMode === 'go-wasm' && this.goWasmNodeId != null) {
            this.callGoWasm('peerpigeonHandlePeerConnected', this.goWasmNodeId, peerId);
            this.callGoWasm('peerpigeonSetConnectedPeers', this.goWasmNodeId, this.mesh.getConnectedPeers());
            this.callGoWasm('peerpigeonSetDiscoveredPeers', this.goWasmNodeId, this.mesh.getDiscoveredPeers());
            this.callGoWasm('peerpigeonSetGlobalPeers', this.goWasmNodeId, this.mesh.getGlobalPeers());
          }
          this.addLog('connected', `Connected to peer`, peerId);
          this.announceCryptoPublicInfo();
          this.requestInterestedKeySync('peer-connected');
          this.updateStats();
          this.onMeshConnectionsChanged('peer:connected');
        });

        this.mesh.on('peer:disconnected', (peerId) => {
          if (this.runtimeMode === 'go-wasm' && this.goWasmNodeId != null) {
            this.callGoWasm('peerpigeonHandlePeerDisconnected', this.goWasmNodeId, peerId);
            this.callGoWasm('peerpigeonSetConnectedPeers', this.goWasmNodeId, this.mesh.getConnectedPeers());
            this.callGoWasm('peerpigeonSetDiscoveredPeers', this.goWasmNodeId, this.mesh.getDiscoveredPeers());
            this.callGoWasm('peerpigeonSetGlobalPeers', this.goWasmNodeId, this.mesh.getGlobalPeers());
          }
          this.addLog('disconnected', `Disconnected from peer`, peerId);
          this.updateStats();
          this.onMeshConnectionsChanged('peer:disconnected');
        });

        this.mesh.on('peer:data', ({ peerId, data }) => {
          if (this.runtimeMode !== 'go-wasm' || this.goWasmNodeId == null) return;
          const payload = this.toPeerDataUint8Array(data);
          this.callGoWasm('peerpigeonHandlePeerData', this.goWasmNodeId, peerId, payload);
        });

        this.mesh.on('peer:error', ({ peerId, error }) => {
          const message = String(error?.message || error || 'unknown error');
          this.addLog('info', `Peer error: ${message}`, peerId || 'peer');
          this.updateStats();
        });

        this.mesh.on('peer:discovered', (peerId) => {
          if (this.runtimeMode === 'go-wasm' && this.goWasmNodeId != null) {
            this.callGoWasm('peerpigeonSetDiscoveredPeers', this.goWasmNodeId, this.mesh.getDiscoveredPeers());
            this.callGoWasm('peerpigeonSetGlobalPeers', this.goWasmNodeId, this.mesh.getGlobalPeers());
          }
          const self = String(this.mesh?.getClientId?.() || '').trim();
          const initiator = self && peerId ? self < peerId : false;
          this.addLog('info', `Dial role -> ${initiator ? 'initiator' : 'non-initiator(wait)'}`, peerId || 'debug');
        });

        this.mesh.on('mesh:membership', () => {
          this.updateStats();
        });

        this.mesh.on('mesh:ready', () => {
          this.addLog('info', 'Gossip reached ready state', 'System');
          this.requestInterestedKeySync('mesh-ready');
        });

        // Gossip events
        this.gossip.on('messageReceived', ({ message, local, fromPeer }) => {
          this.handleGossipPayload({ message, local, fromPeer }).catch((error) => {
            this.addLog('info', `Failed to process gossip payload: ${String(error?.message || error || '')}`, 'crypto');
          });
        });

        this.mesh.on('signaling:error', (error) => {
          const message = `${error?.message || error || 'unknown signaling error'}`;
          this.addLog('info', `Signaling issue: ${message}`, 'signal');
          if (this.isRunning) {
            this.signalingConnected = false;
            this.showStatus('Reconnecting', 'Temporary signaling issue, retrying...', 'connecting');
          } else {
            this.showStatus('Error', message, 'error');
          }
        });

        this.mesh.on('signaling:log', ({ message }) => {
          this.addLog('info', message, 'freertc');
        });

        this.gossip.on('directMessageReceived', ({ message }) => {
          this.handleDirectPayload(message).catch((error) => {
            this.addLog('info', `Failed to process direct payload: ${String(error?.message || error || '')}`, 'crypto');
          });
        });

        await this.mesh.init();
        this.isRunning = true;
        this.isConnecting = false;
        this.updateStats();
        this.startCryptoAnnounceLoop();
        this.announceCryptoPublicInfo();
        this.startDebugMonitor();

        // Best-effort warning only; do not hard-fail startup on transient signaling slowness.
        clearTimeout(this.meshConnectWarnTimer);
        this.meshConnectWarnTimer = setTimeout(() => {
          if (this.isRunning && !this.clientId) {
            this.showStatus('Connecting...', `Still waiting on signaling server (${this.signalingServer})`, 'connecting');
          }
        }, 12_000);
      } catch (error) {
        console.error('Failed to start mesh:', error);
        this.showStatus('Error', error.message || String(error), 'error');
        this.isRunning = false;
        this.isConnecting = false;
      }
    },

    stopMesh() {
      this.stopCryptoAnnounceLoop();
      this.stopDebugMonitor();
      this.resetGraphStabilization();
      clearTimeout(this.meshPeersPublishTimer);
      this.meshPeersPublishTimer = null;
      clearTimeout(this.meshPeersRetrieveTimer);
      this.meshPeersRetrieveTimer = null;
      this.meshPeersPublishInFlight = false;
      this.meshPeersLastLocalSignature = '';
      this.meshPeersLastPublishedAt = 0;
      this.sharedMeshPeerSnapshots = {};
      clearTimeout(this.meshConnectWarnTimer);
      this.meshConnectWarnTimer = null;
      this.teardownStorage();
      if (this.mesh) {
        this.mesh.destroy();
        this.mesh = null;
      }
      if (this.gossip) {
        this.gossip.destroy();
        this.gossip = null;
      }
      this.isRunning = false;
      this.signalingConnected = false;
      this.messageLog = [];
      this.dmTarget = '';
      this.directMode = false;
      this.globalPeersList = [];
      this.saveUiState();
      this.addLog('info', 'Mesh stopped', 'System');
      this.showStatus('Idle', 'Idle', 'info');
    },

    async sendMessage() {
      if (!this.gossip || !this.messageInput.trim()) return;

      const message = this.messageInput.trim();
      this.messageInput = '';

      try {
        if (this.directMode) {
          const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
          const target = String(this.dmTarget || '').trim();
          if (!target || (self && target === self)) {
            this.addLog('info', 'Select a valid peer target for direct message', 'System');
            return;
          }

          if (!this.cryptoPublicDirectory[target]?.epub) {
            this.queuePendingDirectMessage(target, message);
            this.requestCryptoPublicInfo(target);
            this.addLog('info', `Queued DM for ${target.slice(0, 6)} until its direct key arrives`, 'crypto');
            return;
          }

          const encryptedDirectPayload = await this.buildEncryptedDirectPayload(target, message);
          const id = this.gossip.sendDirect(target, encryptedDirectPayload);
          if (!id) {
            this.addLog('info', 'Direct message failed: local peer ID is not ready yet', 'System');
            return;
          }

          this.messagesSeen++;
          this.addLog('sent', `📨 [DM→${target.slice(0, 6)}] ${message}`, 'You', 0, true, { direct: true });
        } else {
          const encryptedBroadcastPayload = await this.buildEncryptedBroadcastPayload(message);
          this.gossip.broadcast(encryptedBroadcastPayload, {
            sender: this.clientId,
            timestamp: Date.now(),
            encrypted: true
          });

          // Local history should not depend on decrypting our own echo envelope.
          this.messagesSeen++;
          this.addLog('sent', `📤 [0 hops] ${message}`, 'You', 0, true);
        }

        this.saveUiState();
        if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
      } catch (error) {
        const reason = String(error?.message || error || 'unknown error');
        this.addLog('sent', `⚠️ Send failed: ${reason}`, 'System', 0, true);
      }
    },

    async ensureCryptoKeys() {
      const parseStored = (raw) => {
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          if (
            parsed &&
            typeof parsed.pub === 'string' &&
            typeof parsed.priv === 'string' &&
            typeof parsed.epub === 'string' &&
            typeof parsed.epriv === 'string'
          ) {
            return parsed;
          }
          return null;
        } catch {
          return null;
        }
      };

      const sessionCryptoKey = `${this.cryptoStorageKey}:${this.effectiveSessionId}`;
      // Keep identity tab-scoped: same tab survives reloads, separate tabs stay distinct peers.
      let keys = parseStored(sessionStorage.getItem(sessionCryptoKey));
      if (!keys) {
        keys = await generateRandomPair();
        try {
          sessionStorage.setItem(sessionCryptoKey, JSON.stringify(keys));
        } catch {
          // ignore storage failures
        }
      }

      this.cryptoKeys = keys;
      this.registerLocalPublicCryptoInfo();
    },

    registerLocalPublicCryptoInfo() {
      const self = String(this.clientId || '').trim();
      if (!self || !this.localPublicCryptoInfo) return;
      this.cryptoPublicDirectory = {
        ...this.cryptoPublicDirectory,
        [self]: {
          pub: this.localPublicCryptoInfo.pub,
          epub: this.localPublicCryptoInfo.epub,
          updatedAt: Date.now(),
          source: 'local'
        }
      };
    },

    startCryptoAnnounceLoop() {
      this.stopCryptoAnnounceLoop();
      this.cryptoAnnounceTimer = setInterval(() => {
        this.announceCryptoPublicInfo();
      }, 10_000);
    },

    stopCryptoAnnounceLoop() {
      if (this.cryptoAnnounceTimer) {
        clearInterval(this.cryptoAnnounceTimer);
        this.cryptoAnnounceTimer = null;
      }
    },

    announceCryptoPublicInfo() {
      if (!this.gossip || !this.localPublicCryptoInfo) return;
      const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
      if (!self) return;

      const payload = this.buildLocalCryptoPublicPayload();
      if (!payload) return;

      this.gossip.broadcast(payload, {
        sender: self,
        timestamp: Date.now(),
        internal: true
      });

      // Also push key info over direct routing to currently connected peers.
      // This avoids key-exchange stalls when gossip membership is still converging.
      const connectedPeers = this.mesh?.getConnectedPeers?.() || [];
      for (const peerId of connectedPeers) {
        if (!peerId || peerId === self) continue;
        try {
          this.gossip.sendDirect(peerId, payload);
        } catch {
          // best-effort only
        }
      }
    },

    isCryptoPublicInfoPayload(data) {
      return !!(
        data &&
        typeof data === 'object' &&
        data.__ppType === CRYPTO_PUBLIC_INFO_TYPE &&
        typeof data.pub === 'string' &&
        typeof data.epub === 'string'
      );
    },

    isCryptoPublicRequestPayload(data) {
      return !!(
        data &&
        typeof data === 'object' &&
        data.__ppType === CRYPTO_PUBLIC_REQUEST_TYPE &&
        typeof data.to === 'string'
      );
    },

    isEncryptedBroadcastPayload(data) {
      return !!(
        data &&
        typeof data === 'object' &&
        data.__ppType === ENCRYPTED_BROADCAST_TYPE &&
        (
          (data.roomCipher && typeof data.roomCipher === 'object') ||
          (data.recipients && typeof data.recipients === 'object')
        )
      );
    },

    isEncryptedDirectPayload(data) {
      return !!(
        data &&
        typeof data === 'object' &&
        data.__ppType === ENCRYPTED_DIRECT_TYPE &&
        data.cipher &&
        typeof data.cipher === 'object'
      );
    },

    isStorageInternalPayload(data) {
      return !!(
        data &&
        typeof data === 'object' &&
        data.__ppType === STORAGE_SYNC_ENVELOPE_TYPE
      );
    },

    upsertRemoteCryptoInfo(peerId, payload) {
      const id = String(peerId || '').trim();
      if (!id) return;

      this.cryptoPublicDirectory = {
        ...this.cryptoPublicDirectory,
        [id]: {
          pub: payload.pub,
          epub: payload.epub,
          updatedAt: Date.now(),
          source: 'remote'
        }
      };

      this.flushPendingDirectMessages(id).catch((error) => {
        this.addLog('info', `Failed to flush queued DM: ${String(error?.message || error || '')}`, 'crypto');
      });
    },

    buildLocalCryptoPublicPayload() {
      const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
      if (!self || !this.localPublicCryptoInfo) return null;

      return {
        __ppType: CRYPTO_PUBLIC_INFO_TYPE,
        from: self,
        pub: this.localPublicCryptoInfo.pub,
        epub: this.localPublicCryptoInfo.epub,
        timestamp: Date.now()
      };
    },

    requestCryptoPublicInfo(targetPeerId) {
      if (!this.gossip) return;

      const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
      const target = String(targetPeerId || '').trim();
      if (!self || !target || self === target) return;

      const payload = {
        __ppType: CRYPTO_PUBLIC_REQUEST_TYPE,
        from: self,
        to: target,
        timestamp: Date.now()
      };

      try {
        this.gossip.sendDirect(target, payload);
      } catch {
        // best-effort only
      }

      try {
        this.gossip.broadcast(payload, {
          sender: self,
          timestamp: Date.now(),
          internal: true
        });
      } catch {
        // best-effort only
      }
    },

    queuePendingDirectMessage(targetPeerId, plaintext) {
      const target = String(targetPeerId || '').trim();
      if (!target) return;

      const pending = Array.isArray(this.pendingDirectMessages[target])
        ? this.pendingDirectMessages[target].slice()
        : [];
      pending.push(String(plaintext));
      this.pendingDirectMessages = {
        ...this.pendingDirectMessages,
        [target]: pending
      };
    },

    async flushPendingDirectMessages(targetPeerId) {
      const target = String(targetPeerId || '').trim();
      if (!target || !this.gossip || !this.cryptoPublicDirectory[target]?.epub) return;

      const pending = Array.isArray(this.pendingDirectMessages[target])
        ? this.pendingDirectMessages[target].slice()
        : [];
      if (!pending.length) return;

      const nextPending = { ...this.pendingDirectMessages };
      delete nextPending[target];
      this.pendingDirectMessages = nextPending;

      for (const message of pending) {
        const encryptedDirectPayload = await this.buildEncryptedDirectPayload(target, message);
        const id = this.gossip.sendDirect(target, encryptedDirectPayload);
        if (!id) {
          this.queuePendingDirectMessage(target, message);
          throw new Error('Direct route is not ready yet');
        }

        this.messagesSeen++;
        this.addLog('sent', `📨 [DM→${target.slice(0, 6)}] ${message}`, 'You', 0, true, { direct: true });
      }
    },

    async deriveRoomBroadcastKey() {
      const roomScope = String(this.effectiveSessionId || '').trim();
      if (!roomScope) {
        throw new Error('Missing room scope for broadcast encryption');
      }
      if (!globalThis.crypto?.subtle) {
        throw new Error('WebCrypto is unavailable for room encryption');
      }

      const seedText = `peerpigeon:room-broadcast:v1:${roomScope}`;
      const seedBytes = new TextEncoder().encode(seedText);
      const hash = await globalThis.crypto.subtle.digest('SHA-256', seedBytes);
      return await globalThis.crypto.subtle.importKey(
        'raw',
        hash,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    },

    async encryptBroadcastForRoom(plaintext) {
      const key = await this.deriveRoomBroadcastKey();
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const plainBytes = new TextEncoder().encode(String(plaintext));
      const cipherBuffer = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        plainBytes
      );

      return {
        alg: 'A256GCM',
        iv: toBase64Url(iv),
        ct: toBase64Url(new Uint8Array(cipherBuffer))
      };
    },

    async decryptBroadcastFromRoom(roomCipher) {
      if (!roomCipher || typeof roomCipher !== 'object') {
        throw new Error('Missing room cipher payload');
      }
      const iv = fromBase64Url(roomCipher.iv);
      const cipherBytes = fromBase64Url(roomCipher.ct);
      const key = await this.deriveRoomBroadcastKey();
      const plainBuffer = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        cipherBytes
      );
      return new TextDecoder().decode(plainBuffer);
    },

    async buildEncryptedBroadcastPayload(plaintext) {
      const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
      const roomCipher = await this.encryptBroadcastForRoom(String(plaintext));

      return {
        __ppType: ENCRYPTED_BROADCAST_TYPE,
        from: self,
        roomCipher,
        timestamp: Date.now()
      };
    },

    async buildEncryptedDirectPayload(targetPeerId, plaintext) {
      if (!this.localPublicCryptoInfo || !this.localPrivateCryptoInfo) {
        throw new Error('Local crypto keys are not ready yet');
      }

      const target = String(targetPeerId || '').trim();
      if (!target) {
        throw new Error('Direct target is required');
      }

      const targetCrypto = this.cryptoPublicDirectory[target];
      if (!targetCrypto?.epub) {
        throw new Error('Direct message key for target is not available yet');
      }

      const cipher = await encryptMessageWithMeta(String(plaintext), {
        epub: targetCrypto.epub
      });

      return {
        __ppType: ENCRYPTED_DIRECT_TYPE,
        from: String(this.clientId || '').trim(),
        to: target,
        cipher,
        timestamp: Date.now()
      };
    },

    async decryptCipherText(cipher) {
      if (!this.localPrivateCryptoInfo?.epriv) {
        throw new Error('Local decrypt key is missing');
      }
      return await decryptMessageWithMeta(cipher, this.localPrivateCryptoInfo.epriv);
    },

    displayPayloadText(value) {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    },

    async handleGossipPayload({ message, local, fromPeer }) {
      const sourcePeer = String(fromPeer || message?.sender || 'peer');

      if (this.isStorageInternalPayload(message?.data)) {
        return;
      }

      if (this.isCryptoPublicInfoPayload(message?.data)) {
        const from = String(message.data.from || sourcePeer || '').trim();
        if (from) {
          this.upsertRemoteCryptoInfo(from, message.data);
        }
        return;
      }

      if (this.isCryptoPublicRequestPayload(message?.data)) {
        const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
        const target = String(message.data.to || '').trim();
        const requester = String(message.data.from || '').trim();
        if (self && target === self && requester) {
          const response = this.buildLocalCryptoPublicPayload();
          if (response) {
            try {
              this.gossip.sendDirect(requester, response);
            } catch {
              // best-effort only
            }
          }
          this.announceCryptoPublicInfo();
        }
        return;
      }

      if (this.isEncryptedBroadcastPayload(message?.data)) {
        // Sender already logs local broadcast on send(); only decrypt remote deliveries.
        if (local) return;

        let decrypted = null;
        if (message?.data?.roomCipher) {
          decrypted = await this.decryptBroadcastFromRoom(message.data.roomCipher);
        } else {
          // Backward compatibility for legacy per-peer broadcast envelopes.
          const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
          const myCipher = message?.data?.recipients?.[self];
          if (!myCipher) return;
          decrypted = await this.decryptCipherText(myCipher);
        }

        this.messagesSeen++;
        const indicator = local ? '📤' : (sourcePeer ? '📥' : '📡');
        const source = local ? 'You' : sourcePeer.slice(0, 6);
        const hopLabel = message.hops === 1 ? 'hop' : 'hops';
        this.addLog(
          local ? 'sent' : 'received',
          `${indicator} [${message.hops} ${hopLabel}] ${decrypted}`,
          source,
          message.hops,
          local
        );
        if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
        return;
      }

      // Backward-compatible path for plaintext messages.
      this.messagesSeen++;
      const indicator = local ? '📤' : (sourcePeer ? '📥' : '📡');
      const source = local ? 'You' : sourcePeer.slice(0, 6);
      const hopLabel = message.hops === 1 ? 'hop' : 'hops';
      this.addLog(
        local ? 'sent' : 'received',
        `${indicator} [${message.hops} ${hopLabel}] ${this.displayPayloadText(message.data)}`,
        source,
        message.hops,
        local
      );
      if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
    },

    async handleDirectPayload(message) {
      const from = String(message.from || 'peer');
      const payload = message?.data;

      if (this.isCryptoPublicInfoPayload(payload)) {
        const sender = String(payload.from || from || '').trim();
        if (sender) {
          this.upsertRemoteCryptoInfo(sender, payload);
        }
        return;
      }

      if (this.isCryptoPublicRequestPayload(payload)) {
        const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
        const target = String(payload.to || '').trim();
        const requester = String(payload.from || from || '').trim();
        if (self && target === self && requester) {
          const response = this.buildLocalCryptoPublicPayload();
          if (response) {
            try {
              this.gossip.sendDirect(requester, response);
            } catch {
              // best-effort only
            }
          }
          this.announceCryptoPublicInfo();
        }
        return;
      }

      if (this.isEncryptedDirectPayload(payload)) {
        const decrypted = await this.decryptCipherText(payload.cipher);
        this.messagesSeen++;
        this.addLog('received', `📩 [DM] ${decrypted}`, from, 0, false, { direct: true });
        this.saveUiState();
        if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
        return;
      }

      // Backward-compatible path for plaintext direct payloads.
      this.messagesSeen++;
      this.addLog('received', `📩 [DM] ${this.displayPayloadText(payload)}`, from, 0, false, { direct: true });
      this.saveUiState();
      if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
    },

    maskSecret(value) {
      const text = String(value || '');
      if (!text) return '';
      if (text.length <= 12) return '************';
      return `${text.slice(0, 6)}********${text.slice(-6)}`;
    },

    updateStats() {
      if (this.mesh) {
        const meshClientId = String(this.mesh.getClientId?.() || this.clientId || '').trim();
        if (meshClientId) {
          this.clientId = meshClientId;
        }

        this.connectedPeersList = this.mesh.getConnectedPeers();
        this.discoveredPeersList = this.mesh.getDiscoveredPeers();
        const global = this.mesh.getGlobalPeers ? this.mesh.getGlobalPeers() : [];
        const self = meshClientId;
        this.globalPeersList = [...new Set([
          ...global,
          ...this.connectedPeersList,
          ...this.discoveredPeersList,
        ])].filter(p => p && p !== self);

        // Keep DM target valid as the membership view converges.
        if (!this.globalPeersList.includes(this.dmTarget) || this.dmTarget === self) {
          this.dmTarget = this.globalPeersList[0] || '';
        }

        this.saveUiState();
      }

      this.syncGossipStatus();
    },

    networkNodeHue(peerId) {
      const hex = String(peerId || '').slice(0, 2);
      const mostSignificant = Number.parseInt(hex || '00', 16);
      const percent = Number.isFinite(mostSignificant) ? mostSignificant / 255 : 0;
      return Math.round(percent * 360);
    },

    networkTolerantPeerIds(connectedPeerIds) {
      const peers = [...new Set((connectedPeerIds || []).map((peerId) => String(peerId || '').trim()).filter(Boolean))];
      const maxPeers = Math.max(0, Math.floor(Number(this.maxPeers) || 0));
      if (!maxPeers || peers.length <= maxPeers) return new Set();

      const overflow = peers.length - maxPeers;
      const sortedPeers = peers.slice().sort((a, b) => a.localeCompare(b));
      return new Set(sortedPeers.slice(-overflow));
    },

    networkGraphData() {
      const localSelf = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
      const edgeMap = new Map();
      const participants = new Set();

      const snapshots = this.activeMeshPeerSnapshots();
      const localSnapshot = this.localMeshPeerSnapshot();
      const localConnectedSet = new Set((localSnapshot?.connectedPeers || []).map((peerId) => String(peerId || '').trim()).filter(Boolean));
      if (localSnapshot) {
        snapshots[localSnapshot.peerId] = localSnapshot;
      }
      const knownSnapshotPeers = new Set(Object.keys(snapshots).map((peerId) => String(peerId || '').trim()).filter(Boolean));

      const tolerantPeerIds = this.networkTolerantPeerIds(localSnapshot?.connectedPeers || []);

      for (const [sourcePeerId, snapshot] of Object.entries(snapshots)) {
        const source = String(sourcePeerId || '').trim();
        if (!source) continue;

        const connectedPeers = Array.isArray(snapshot?.connectedPeers) ? snapshot.connectedPeers : [];
        for (const peerId of connectedPeers) {
          const target = String(peerId || '').trim();
          if (!target || target === source) continue;

          // Trust connectedPeers edges even if target snapshot hasn't arrived yet.
          // This prevents temporary gaps where connections show as missing nodes.

          participants.add(source);
          participants.add(target);

          const edgeId = [source, target].sort().join('|');
          const direction = `${source}>${target}`;
          const reverse = `${target}>${source}`;

          const entry = edgeMap.get(edgeId) || {
            source: [source, target].sort()[0],
            target: [source, target].sort()[1],
            halfDuplex: true,
            directions: new Set(),
          };
          entry.directions.add(direction);

          // WebRTC data channels are full-duplex; when local mesh confirms a link,
          // render it as full immediately even if remote snapshot has not arrived yet.
          const localConfirmsLink = Boolean(localSelf) && (
            (source === localSelf && localConnectedSet.has(target)) ||
            (target === localSelf && localConnectedSet.has(source))
          );
          if (localConfirmsLink) {
            entry.directions.add(reverse);
          }

          if (entry.directions.has(reverse)) {
            entry.halfDuplex = false;
          }
          edgeMap.set(edgeId, entry);
        }
      }

      let links = Array.from(edgeMap.values()).map((entry) => ({
        source: entry.source,
        target: entry.target,
        halfDuplex: Boolean(entry.halfDuplex),
      }));

      // Render the full merged topology from epublic mesh:peers, not only
      // the local connected component.

      // Always include local self so the graph never disappears when isolated.
      if (localSelf) {
        participants.add(localSelf);
      }

      const nodeIds = [...participants];

      const nodes = nodeIds
        .sort((a, b) => a.localeCompare(b))
        .map((peerId) => ({
          id: peerId,
          short: peerId.slice(0, 4).toUpperCase(),
          isSelf: Boolean(localSelf) && peerId === localSelf,
          isTolerant: tolerantPeerIds.has(peerId),
          hue: this.networkNodeHue(peerId),
        }));

      return { nodes, links };
    },

    networkGraphSignature(nodes, links) {
      const nodeIds = nodes.map((node) => String(node.id || '')).sort();
      const edgeIds = links
        .map((link) => {
          const source = String(typeof link.source === 'object' ? link.source?.id : link.source || '').trim();
          const target = String(typeof link.target === 'object' ? link.target?.id : link.target || '').trim();
          if (!source || !target) return '';
          const mode = link.halfDuplex ? 'half' : 'full';
          return `${[source, target].sort().join('|')}:${mode}`;
        })
        .filter(Boolean)
        .sort();

      return `${nodeIds.join(',')}::${edgeIds.join(',')}`;
    },

    scheduleNetworkGraphRender(options = {}) {
      const { immediate = false, reason = 'update' } = options;
      const delayMs = reason === 'resize' ? 0 : 120;

      clearTimeout(this.graphUpdateTimer);
      this.graphUpdateTimer = null;

      const run = () => {
        this.graphUpdateTimer = null;
        this.renderNetworkGraph({ reason });
      };

      if (immediate || delayMs === 0) {
        run();
        return;
      }

      this.graphUpdateTimer = setTimeout(run, delayMs);
    },

    renderNetworkGraph(options = {}) {
      const { reason = 'update' } = options;
      const svgEl = this.$refs.networkGraphSvg;
      const container = this.$refs.networkGraphContainer;
      if (!svgEl || !container) return;

      if (typeof ResizeObserver !== 'undefined') {
        if (!this.networkGraphResizeObserver) {
          this.networkGraphResizeObserver = new ResizeObserver(() => {
            const observed = this.networkGraphResizeObservedElement;
            if (!observed?.isConnected) return;

            const observedWidth = Math.max(320, Math.floor(observed.clientWidth || 320));
            const observedHeight = Math.max(280, Math.floor(observed.clientHeight || 280));
            if (
              this.networkGraphState?.width === observedWidth
              && this.networkGraphState?.height === observedHeight
            ) {
              return;
            }

            this.scheduleNetworkGraphRender({ immediate: true, reason: 'resize' });
          });
        }

        if (this.networkGraphResizeObservedElement !== container) {
          if (this.networkGraphResizeObservedElement) {
            this.networkGraphResizeObserver.unobserve(this.networkGraphResizeObservedElement);
          }
          this.networkGraphResizeObserver.observe(container);
          this.networkGraphResizeObservedElement = container;
        }
      }

      const localSelf = String(this.mesh?.getClientId?.() || this.clientId || '').trim();

      const layoutVersion = 4;

      const width = Math.max(320, Math.floor(container.clientWidth || 320));
      const height = Math.max(280, Math.floor(container.clientHeight || 280));
      const { nodes, links } = this.networkGraphData();
      const signature = this.networkGraphSignature(nodes, links);

      const prevState = this.networkGraphState;
      const versionMismatch = Boolean(prevState) && prevState.layoutVersion !== layoutVersion;
      const sameTopology = this.graphLastSignature && signature === this.graphLastSignature;
      const sameSize = prevState && prevState.width === width && prevState.height === height;
      const previousIds = nodes.map((node) => node.id);
      const rawPriorPositions = prevState?.positions || {};
      const priorLayoutWidth = Math.max(1, Number(prevState?.width) || width);
      const priorLayoutHeight = Math.max(1, Number(prevState?.height) || height);
      const priorPoints = previousIds
        .map((id) => rawPriorPositions[id])
        .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
      const cornerCrowd = priorPoints.filter((point) => (
        point.x < priorLayoutWidth * 0.3 && point.y < priorLayoutHeight * 0.3
      )).length;
      const selfPrior = localSelf ? rawPriorPositions[localSelf] : null;
      const selfInCorner = Boolean(
        selfPrior
        && Number.isFinite(selfPrior.x)
        && Number.isFinite(selfPrior.y)
        && selfPrior.x < priorLayoutWidth * 0.3
        && selfPrior.y < priorLayoutHeight * 0.3
      );
      const peerPinnedToOrigin = priorPoints.length >= 2 && priorPoints.some((point) => (
        point.x <= 32 && point.y <= 32
      ));
      const priorSpanX = priorPoints.length
        ? Math.max(...priorPoints.map((point) => point.x)) - Math.min(...priorPoints.map((point) => point.x))
        : 0;
      const priorSpanY = priorPoints.length
        ? Math.max(...priorPoints.map((point) => point.y)) - Math.min(...priorPoints.map((point) => point.y))
        : 0;
      const tightlyClusteredPrior = priorPoints.length >= 4
        && priorSpanX < Math.max(48, priorLayoutWidth * 0.16)
        && priorSpanY < Math.max(48, priorLayoutHeight * 0.16);
      const collapsedPriorLayout = (priorPoints.length >= 3 && cornerCrowd / priorPoints.length >= 0.68)
        || (priorPoints.length >= 2 && selfInCorner)
        || peerPinnedToOrigin
        || tightlyClusteredPrior;

      const svg = d3.select(svgEl)
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('width', width)
        .attr('height', height);

      if (sameTopology && sameSize && !versionMismatch && !collapsedPriorLayout) {
        return;
      }

      this.graphLastSignature = signature;

      svg.selectAll('*').remove();

      if (!nodes.length) {
        clearTimeout(this.graphStabilizeTimer);
        this.graphStabilizeTimer = null;
        if (prevState?.simulation) prevState.simulation.stop();
        this.networkGraphState = null;
        return;
      }

      const nodeRadius = 16;
      const boxPadding = nodeRadius + 8;
      const clampX = (x) => Math.max(boxPadding, Math.min(width - boxPadding, Number.isFinite(x) ? x : width / 2));
      const clampY = (y) => Math.max(boxPadding, Math.min(height - boxPadding, Number.isFinite(y) ? y : height / 2));
      const minNodeGap = 58;

      const enforceNodeSpacing = (iterations = 1) => {
        for (let pass = 0; pass < iterations; pass += 1) {
          for (let i = 0; i < nodes.length; i += 1) {
            for (let j = i + 1; j < nodes.length; j += 1) {
              const a = nodes[i];
              const b = nodes[j];
              let dx = (b.x ?? width / 2) - (a.x ?? width / 2);
              let dy = (b.y ?? height / 2) - (a.y ?? height / 2);
              let dist = Math.hypot(dx, dy);
              if (dist >= minNodeGap) continue;

              const overlap = (minNodeGap - dist) / 2;
              if (dist < 0.001) {
                const pairId = `${a.id}|${b.id}`;
                let seed = 0;
                for (let index = 0; index < pairId.length; index += 1) {
                  seed = (seed * 31 + pairId.charCodeAt(index)) >>> 0;
                }
                const angle = (seed % 360) * (Math.PI / 180);
                dx = Math.cos(angle);
                dy = Math.sin(angle);
                dist = 1;
              }
              const ux = dx / dist;
              const uy = dy / dist;
              const aFixed = Number.isFinite(a.fx) && Number.isFinite(a.fy);
              const bFixed = Number.isFinite(b.fx) && Number.isFinite(b.fy);

              if (aFixed && bFixed) continue;

              if (aFixed) {
                b.x = clampX((b.x ?? width / 2) + ux * overlap * 2);
                b.y = clampY((b.y ?? height / 2) + uy * overlap * 2);
              } else if (bFixed) {
                a.x = clampX((a.x ?? width / 2) - ux * overlap * 2);
                a.y = clampY((a.y ?? height / 2) - uy * overlap * 2);
              } else {
                a.x = clampX((a.x ?? width / 2) - ux * overlap);
                a.y = clampY((a.y ?? height / 2) - uy * overlap);
                b.x = clampX((b.x ?? width / 2) + ux * overlap);
                b.y = clampY((b.y ?? height / 2) + uy * overlap);
              }
            }
          }
        }
      };

      const enforceNodesInBox = () => {
        for (const n of nodes) {
          const clampedX = clampX(n.x);
          const clampedY = clampY(n.y);

          if (clampedX !== n.x && Number.isFinite(n.vx)) {
            n.vx *= 0.25;
          }
          if (clampedY !== n.y && Number.isFinite(n.vy)) {
            n.vy *= 0.25;
          }

          n.x = clampedX;
          n.y = clampedY;
          if (Number.isFinite(n.fx)) n.fx = clampX(n.fx);
          if (Number.isFinite(n.fy)) n.fy = clampY(n.fy);
        }
      };

      const sizeChanged = Boolean(prevState) && (
        priorLayoutWidth !== width || priorLayoutHeight !== height
      );
      const priorPositions = Object.fromEntries(
        Object.entries(rawPriorPositions).map(([id, point]) => {
          if (!sizeChanged || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            return [id, point];
          }

          const oldPaddingX = Math.min(boxPadding, Math.max(0, priorLayoutWidth / 2 - 1));
          const oldPaddingY = Math.min(boxPadding, Math.max(0, priorLayoutHeight / 2 - 1));
          const oldSpanX = Math.max(1, priorLayoutWidth - oldPaddingX * 2);
          const oldSpanY = Math.max(1, priorLayoutHeight - oldPaddingY * 2);
          const normalizedX = Math.max(0, Math.min(1, (point.x - oldPaddingX) / oldSpanX));
          const normalizedY = Math.max(0, Math.min(1, (point.y - oldPaddingY) / oldSpanY));

          return [id, {
            x: clampX(boxPadding + normalizedX * Math.max(1, width - boxPadding * 2)),
            y: clampY(boxPadding + normalizedY * Math.max(1, height - boxPadding * 2)),
          }];
        })
      );
      const ignorePriorPositions = versionMismatch || collapsedPriorLayout;
      const missingPriorNodes = [];

      for (const node of nodes) {
        if (ignorePriorPositions) break;
        const prior = priorPositions[node.id];
        if (!prior) {
          missingPriorNodes.push(node);
          continue;
        }

        node.x = clampX(prior.x);
        node.y = clampY(prior.y);
        node.vx = 0;
        node.vy = 0;
      }

      if (ignorePriorPositions) {
        const cx = width / 2;
        const cy = height / 2;
        const spreadX = Math.max(56, Math.min(width * 0.34, width / 2 - boxPadding));
        const spreadY = Math.max(48, Math.min(height * 0.32, height / 2 - boxPadding));
        const layoutNodes = nodes.filter((node) => node.id !== localSelf);
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));

        const selfNode = nodes.find((node) => node.id === localSelf);
        if (selfNode) {
          selfNode.x = clampX(cx);
          selfNode.y = clampY(cy);
          selfNode.vx = 0;
          selfNode.vy = 0;
        }

        layoutNodes.forEach((node, index) => {
          const radius = Math.sqrt((index + 1) / Math.max(1, layoutNodes.length));
          const angle = index * goldenAngle - Math.PI / 2;
          node.x = clampX(cx + Math.cos(angle) * spreadX * radius);
          node.y = clampY(cy + Math.sin(angle) * spreadY * radius);
          node.vx = 0;
          node.vy = 0;
        });
      }

      // New nodes with no saved coordinates should spawn near neighbors or center, not (0,0).
      if (!ignorePriorPositions && missingPriorNodes.length) {
        const cx = width / 2;
        const cy = height / 2;
        const idToNode = new Map(nodes.map((node) => [node.id, node]));
        const neighborsById = new Map(nodes.map((node) => [node.id, []]));

        for (const link of links) {
          const sourceId = String(typeof link.source === 'object' ? link.source?.id : link.source || '').trim();
          const targetId = String(typeof link.target === 'object' ? link.target?.id : link.target || '').trim();
          if (!sourceId || !targetId || sourceId === targetId) continue;
          if (neighborsById.has(sourceId)) neighborsById.get(sourceId).push(targetId);
          if (neighborsById.has(targetId)) neighborsById.get(targetId).push(sourceId);
        }

        for (const node of missingPriorNodes) {
          if (node.id === localSelf) {
            node.x = clampX(cx);
            node.y = clampY(cy);
            node.vx = 0;
            node.vy = 0;
            continue;
          }

          const neighbors = neighborsById.get(node.id) || [];
          const anchored = neighbors
            .map((peerId) => idToNode.get(peerId))
            .filter((peer) => peer && Number.isFinite(peer.x) && Number.isFinite(peer.y));

          const tryPlace = (baseX, baseY, spreadX, spreadY) => {
            let candidateX = baseX;
            let candidateY = baseY;
            for (let attempt = 0; attempt < 14; attempt += 1) {
              const jitterX = (Math.random() - 0.5) * spreadX;
              const jitterY = (Math.random() - 0.5) * spreadY;
              candidateX = clampX(baseX + jitterX);
              candidateY = clampY(baseY + jitterY);

              const overlapsExisting = nodes.some((peer) => {
                if (peer === node) return false;
                if (!Number.isFinite(peer.x) || !Number.isFinite(peer.y)) return false;
                return Math.hypot(peer.x - candidateX, peer.y - candidateY) < minNodeGap;
              });

              if (!overlapsExisting) break;
            }

            return { x: candidateX, y: candidateY };
          };

          if (anchored.length > 0) {
            const avgX = anchored.reduce((sum, peer) => sum + peer.x, 0) / anchored.length;
            const avgY = anchored.reduce((sum, peer) => sum + peer.y, 0) / anchored.length;
            const placed = tryPlace(avgX, avgY, 44, 40);
            node.x = placed.x;
            node.y = placed.y;
          } else {
            const placed = tryPlace(cx, cy, Math.max(76, width * 0.28), Math.max(70, height * 0.24));
            node.x = placed.x;
            node.y = placed.y;
          }

          node.vx = 0;
          node.vy = 0;
        }
      }

      const prevNodeIds = new Set(prevState?.nodeIds || []);
      const prevEdgeIds = new Set(prevState?.edgeIds || []);
      const currentNodeIds = nodes.map((node) => node.id);
      const currentEdgeIds = links
        .map((link) => [String(link.source || ''), String(link.target || '')].sort().join('|'))
        .sort();

      const addedNodes = currentNodeIds.filter((id) => !prevNodeIds.has(id)).length;
      const removedNodes = [...prevNodeIds].filter((id) => !currentNodeIds.includes(id)).length;
      const addedEdges = currentEdgeIds.filter((id) => !prevEdgeIds.has(id)).length;
      const removedEdges = [...prevEdgeIds].filter((id) => !currentEdgeIds.includes(id)).length;
      const topologyDelta = addedNodes + removedNodes + addedEdges + removedEdges;
      const lockExistingNodes = Boolean(prevState)
        && !ignorePriorPositions
        && reason !== 'resize'
        && topologyDelta > 0
        && topologyDelta <= 4;

      if (lockExistingNodes) {
        for (const node of nodes) {
          const prior = priorPositions[node.id];
          if (!prior) continue;
          node.fx = clampX(prior.x);
          node.fy = clampY(prior.y);
        }
      }

      enforceNodeSpacing(2);
      enforceNodesInBox();

      const defs = svg.append('defs');

      const linkGradient = defs.append('linearGradient')
        .attr('id', 'network-link-gradient')
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '100%')
        .attr('y2', '100%');
      linkGradient.append('stop').attr('offset', '0%').attr('stop-color', '#22d3ee').attr('stop-opacity', 0.42);
      linkGradient.append('stop').attr('offset', '50%').attr('stop-color', '#60a5fa').attr('stop-opacity', 0.88);
      linkGradient.append('stop').attr('offset', '100%').attr('stop-color', '#22d3ee').attr('stop-opacity', 0.42);

      const linkGlow = defs.append('filter')
        .attr('id', 'network-link-glow')
        .attr('x', '-40%')
        .attr('y', '-40%')
        .attr('width', '180%')
        .attr('height', '180%');
      linkGlow.append('feGaussianBlur').attr('stdDeviation', 1.7).attr('result', 'blur');
      linkGlow.append('feMerge')
        .selectAll('feMergeNode')
        .data(['blur', 'SourceGraphic'])
        .enter()
        .append('feMergeNode')
        .attr('in', (d) => d);

      const nodeGlow = defs.append('filter')
        .attr('id', 'network-node-glow')
        .attr('x', '-60%')
        .attr('y', '-60%')
        .attr('width', '220%')
        .attr('height', '220%');
      nodeGlow.append('feGaussianBlur').attr('stdDeviation', 2.1).attr('result', 'glow');
      nodeGlow.append('feMerge')
        .selectAll('feMergeNode')
        .data(['glow', 'SourceGraphic'])
        .enter()
        .append('feMergeNode')
        .attr('in', (d) => d);

      const selfFill = defs.append('radialGradient').attr('id', 'network-self-fill');
      selfFill.append('stop').attr('offset', '0%').attr('stop-color', '#f0f9ff');
      selfFill.append('stop').attr('offset', '100%').attr('stop-color', '#38bdf8');

      const tolerantFill = defs.append('radialGradient').attr('id', 'network-tolerant-fill');
      tolerantFill.append('stop').attr('offset', '0%').attr('stop-color', '#fff8bf');
      tolerantFill.append('stop').attr('offset', '100%').attr('stop-color', '#facc15');

      const root = svg.append('g').attr('class', 'network-root');

      const link = root
        .append('g')
        .attr('class', 'network-links')
        .selectAll('line')
        .data(links)
        .enter()
        .append('line')
        .attr('class', 'network-link')
        .attr('stroke', 'url(#network-link-gradient)')
        .attr('stroke-width', 2.2)
        .attr('stroke-opacity', (d) => (d.halfDuplex ? 0.5 : 0.95))
        .attr('stroke-dasharray', (d) => (d.halfDuplex ? '6 4' : null))
        .attr('filter', 'url(#network-link-glow)');

      const node = root
        .append('g')
        .attr('class', 'network-nodes')
        .selectAll('g')
        .data(nodes)
        .enter()
        .append('g')
        .attr('class', (d) => `network-node${d.isSelf ? ' self' : ''}${d.isTolerant ? ' tolerant' : ''}`);

      node.append('title')
        .text((d) => `${d.id}${d.isSelf ? ' (you)' : ''}`);

      node.append('circle')
        .attr('class', 'network-node-core')
        .attr('r', 16)
        .attr('stroke', (d) => (d.isTolerant ? '#f59e0b' : `hsl(${d.hue}, 96%, 62%)`))
        .attr('fill', (d) => {
          if (d.isSelf) return 'url(#network-self-fill)';
          if (d.isTolerant) return 'url(#network-tolerant-fill)';
          return `hsl(${d.hue}, 68%, 20%)`;
        })
        .attr('stroke-width', 1)
        .attr('filter', 'url(#network-node-glow)');

      node.append('text')
        .attr('class', 'network-node-label')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', (d) => (d.isSelf || d.isTolerant ? '#0b1222' : '#f8fafc'))
        .attr('stroke', (d) => (d.isSelf || d.isTolerant ? 'rgba(248,250,252,0.66)' : 'rgba(11,18,34,0.72)'))
        .attr('stroke-width', 1.2)
        .attr('paint-order', 'stroke')
        .text((d) => d.short);

      const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id((d) => d.id).distance(lockExistingNodes ? 100 : 118).strength(lockExistingNodes ? 0.26 : 0.38))
        .force('charge', d3.forceManyBody().strength(lockExistingNodes ? -300 : -470))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('x', d3.forceX(width / 2).strength(lockExistingNodes ? 0.025 : 0.055))
        .force('y', d3.forceY(height / 2).strength(lockExistingNodes ? 0.025 : 0.055))
        .force('collision', d3.forceCollide().radius(minNodeGap / 2 + 4).iterations(4))
        .alphaDecay(lockExistingNodes ? 0.16 : 0.08)
        .alpha(lockExistingNodes ? 0.22 : 0.85);

      const drag = d3.drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.25).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = clampX(event.x);
          d.fy = clampY(event.y);
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        });

      node.call(drag);

      const paintNetworkGraph = () => {
        enforceNodeSpacing(2);
        enforceNodesInBox();

        link
          .attr('x1', (d) => clampX(d.source.x))
          .attr('y1', (d) => clampY(d.source.y))
          .attr('x2', (d) => clampX(d.target.x))
          .attr('y2', (d) => clampY(d.target.y));

        node.attr('transform', (d) => {
          const x = clampX(d.x);
          const y = clampY(d.y);
          d.x = x;
          d.y = y;
          return `translate(${x},${y})`;
        });

        if (this.networkGraphState?.simulation === simulation) {
          this.networkGraphState.positions = Object.fromEntries(
            nodes.map((n) => [
              n.id,
              {
                x: clampX(n.x),
                y: clampY(n.y),
              },
            ])
          );
        }
      };

      simulation.on('tick', paintNetworkGraph);

      clearTimeout(this.graphStabilizeTimer);
      this.graphStabilizeTimer = setTimeout(() => {
        for (const n of nodes) {
          n.fx = null;
          n.fy = null;
        }
        simulation.stop();
      }, lockExistingNodes ? 550 : 1300);

      if (prevState?.simulation) {
        prevState.simulation.stop();
      }
      this.networkGraphState = {
        simulation,
        layoutVersion,
        width,
        height,
        nodeIds: currentNodeIds,
        edgeIds: currentEdgeIds,
        positions: Object.fromEntries(
          nodes.map((n) => [
            n.id,
            {
              x: clampX(n.x),
              y: clampY(n.y),
            },
          ])
        ),
      };

      // Background tabs may throttle D3's first timer tick. Paint the seeded
      // coordinates now so SVG nodes never remain at their default (0, 0).
      paintNetworkGraph();

      simulation.on('end', () => {
        if (!this.networkGraphState || this.networkGraphState.simulation !== simulation) return;
        this.networkGraphState.positions = Object.fromEntries(
          nodes.map((n) => [
            n.id,
            {
              x: clampX(n.x),
              y: clampY(n.y),
            },
          ])
        );
      });
    },

    destroyNetworkGraph() {
      if (this.networkGraphState?.simulation) {
        this.networkGraphState.simulation.stop();
      }
      this.networkGraphState = null;

      const svgEl = this.$refs.networkGraphSvg;
      if (svgEl) {
        d3.select(svgEl).selectAll('*').remove();
      }
    },

    resetGraphStabilization() {
      clearTimeout(this.graphStabilizeTimer);
      clearTimeout(this.graphUpdateTimer);
      this.graphStabilizeTimer = null;
      this.graphUpdateTimer = null;
      this.graphLastSignature = '';
      this.destroyNetworkGraph();
    },

    requiredConnectedPeersForGossip() {
      const min = Number.isFinite(this.minPeers) ? this.minPeers : 1;
      const tolerant = Number.isFinite(this.tolerantPeers) ? this.tolerantPeers : 0;
      return Math.max(1, min - tolerant);
    },

    syncGossipStatus() {
      if (!this.isRunning) return;

      if (!this.signalingConnected) {
        this.showStatus('Reconnecting', 'Signaling reconnect in progress...', 'connecting');
        return;
      }

      const connected = this.connectedPeersList.length;
      const minPeers = Number.isFinite(this.minPeers) ? this.minPeers : 1;
      const required = this.requiredConnectedPeersForGossip();

      if (connected >= minPeers) {
        this.showStatus('Ready', `Gossip OK (${connected}/${minPeers} connected)`, 'success');
      } else if (connected >= required) {
        this.showStatus(
          'Ready (Degraded)',
          `Gossip active but under-connected (${connected}/${minPeers} connected, tolerant ${this.tolerantPeers})`,
          'success'
        );
      } else {
        this.showStatus('Connecting', `Waiting for peers (${connected}/${required} connected)`, 'connecting');
      }
    },

    entryBubbleClass(entry) {
      if (entry?.direct) {
        return entry.local ? 'dm-me' : 'dm-peer';
      }
      return entry.local ? 'me' : 'peer';
    },

    addLog(type, text, sender = 'System', hops = 0, local = false, options = {}) {
      const entry = {
        type,
        text,
        sender,
        hops,
        timestamp: new Date(),
        local,
        direct: !!options.direct
      };

      this.messageLog.push(entry);

      if (import.meta.env.DEV && type !== 'info') {
        // Mirror all app logs to browser console for rapid debugging.
        // eslint-disable-next-line no-console
        console.log(`[mesh:${type}] ${sender} ${text}`);
      }

      // Keep log size manageable without dropping peer chat history first.
      // Rebalance/connectivity churn can generate many diagnostics, so trim
      // non-chat entries before ever trimming sent/received chat entries.
      const MAX_LOG_ENTRIES = 300;
      if (this.messageLog.length > MAX_LOG_ENTRIES) {
        const firstNonChatIndex = this.messageLog.findIndex(
          (entry) => entry.type !== 'sent' && entry.type !== 'received'
        );
        if (firstNonChatIndex >= 0) {
          this.messageLog.splice(firstNonChatIndex, 1);
        } else {
          this.messageLog.shift();
        }
      }
    },

    clearLog() {
      this.messageLog = [];
    },

    showStatus(title, message, type = 'info') {
      if (
        this.status.title === title &&
        this.status.message === message &&
        this.status.type === type
      ) {
        return;
      }

      this.status = { title, message, type };
    },


    startDebugMonitor() {
      this.stopDebugMonitor();
      this.debugLastByPeer = {};
      this.debugLastLogAtByPeer = {};

      this.debugMonitorTimer = setInterval(() => {
        try {
          if (!this.isRunning) return;
          const rawClient = this.mesh?.signalingClient?.client;
          const connections = rawClient?.mesh?.connections;
          if (!connections || typeof connections.entries !== 'function') return;
          const now = Date.now();

          for (const [peerId, entry] of connections.entries()) {
            const snapshot = {
              mesh: String(entry?.state || ''),
              pc: String(entry?.connection?.connectionState || ''),
              ice: String(entry?.connection?.iceConnectionState || ''),
              signaling: String(entry?.connection?.signalingState || ''),
              dc: String(entry?.channel?.readyState || '')
            };

            const previous = this.debugLastByPeer[peerId];
            const changed = !previous ||
              previous.mesh !== snapshot.mesh ||
              previous.pc !== snapshot.pc ||
              previous.ice !== snapshot.ice ||
              previous.signaling !== snapshot.signaling ||
              previous.dc !== snapshot.dc;

            if (changed) {
              this.debugLastByPeer[peerId] = snapshot;
              const lastLogAt = Number(this.debugLastLogAtByPeer[peerId] || 0);
              if (now - lastLogAt < DEBUG_MONITOR_PEER_LOG_MIN_GAP_MS) {
                continue;
              }
              this.debugLastLogAtByPeer[peerId] = now;
              this.addLog(
                'info',
                `conn(mesh=${snapshot.mesh || '-'}, pc=${snapshot.pc || '-'}, ice=${snapshot.ice || '-'}, sig=${snapshot.signaling || '-'}, dc=${snapshot.dc || '-'})`,
                peerId
              );
            }
          }
        } catch {
          // ignore debug monitor failures
        }
      }, DEBUG_MONITOR_INTERVAL_MS);
    },

    stopDebugMonitor() {
      if (this.debugMonitorTimer) {
        clearInterval(this.debugMonitorTimer);
        this.debugMonitorTimer = null;
      }
      this.debugLastByPeer = {};
      this.debugLastLogAtByPeer = {};
    },

    updateUrlState() {
      try {
        const url = new URL(window.location.href);
        // Preserve original query params to avoid disturbing tests or manual URL state
        const originalParams = new URLSearchParams(window.location.search);
        
        // Update only the configuration params; preserve any explicitly provided sessionId
        url.searchParams.set('topology', this.topology);
        url.searchParams.set('minPeers', String(this.minPeers));
        url.searchParams.set('maxPeers', String(this.maxPeers));
        url.searchParams.set('tolerantPeers', String(this.tolerantPeers));
        url.searchParams.delete('sessionSource');
        url.searchParams.delete('deriveSessionFromUrl');
        if (this.networkName) {
          url.searchParams.set('networkName', this.networkName);
        } else if (!originalParams.has('networkName') && !originalParams.has('network')) {
          url.searchParams.delete('networkName');
        }
        
        // Only sync sessionId to URL if it wasn't explicitly provided in the original URL
        // This prevents tests' __test_* sessionIds from being modified
        const hadExplicitSessionId = originalParams.has('sessionId') || originalParams.has('roomSessionId') || originalParams.has('room');
        if (hadExplicitSessionId) {
          // Keep original sessionId param as-is
          url.searchParams.set('sessionId', originalParams.get('sessionId') || originalParams.get('roomSessionId') || originalParams.get('room'));
        } else if (this.roomSessionId) {
          // Update sessionId only if no explicit one was provided originally
          url.searchParams.set('sessionId', this.roomSessionId);
        }
        
        window.history.replaceState({}, '', url.toString());
      } catch {
        // ignore URL state errors
      }
    },

    formatTime(date) {
      return new Date(date).toLocaleTimeString();
    },
    scrollToBottom() {
      const container = this.$refs.logContainer;
      if (!container) return;
      container.scrollTop = container.scrollHeight;
    },

    scrollDiagToBottom() {
      const container = this.$refs.diagLogContainer;
      if (!container) return;
      container.scrollTop = container.scrollHeight;
    },

    saveUiState() {
      try {
        const interested = Object.fromEntries(
          Object.entries(this.storageInterestedKeys || {}).filter(([pk, enabled]) => {
            return typeof pk === 'string' && pk.length > 0 && enabled === true;
          })
        );

        const serialized = JSON.stringify({
          activeTab: this.activeTab || 'message',
          dmTarget: this.dmTarget || '',
          directMode: !!this.directMode,
          showPrivateCrypto: !!this.showPrivateCrypto,
          storageActiveSpace: this.storageActiveSpace || 'user',
          storageLookupOwnerId: String(this.storageLookupOwnerId || '').trim(),
          storageInterestedKeys: interested,
        });

        localStorage.setItem(this.uiStateKey, serialized);
      } catch {
        // ignore storage failures
      }
    },

    loadUiState() {
      try {
        const raw = localStorage.getItem(this.uiStateKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const allowedTabs = new Set(this.uiTabs.map((tab) => tab.id));
        if (typeof parsed.activeTab === 'string' && allowedTabs.has(parsed.activeTab)) {
          this.activeTab = parsed.activeTab;
        }
        if (typeof parsed.dmTarget === 'string') {
          this.dmTarget = parsed.dmTarget;
        }
        if (typeof parsed.directMode === 'boolean') {
          this.directMode = parsed.directMode;
        }
        if (typeof parsed.showPrivateCrypto === 'boolean') {
          this.showPrivateCrypto = parsed.showPrivateCrypto;
        }
        const allowedSpaces = new Set(['public', 'user', 'frozen', 'private', 'epublic']);
        if (typeof parsed.storageActiveSpace === 'string' && allowedSpaces.has(parsed.storageActiveSpace)) {
          this.storageActiveSpace = parsed.storageActiveSpace;
        }
        if (typeof parsed.storageLookupOwnerId === 'string') {
          this.storageLookupOwnerId = parsed.storageLookupOwnerId;
        }
        if (parsed.storageInterestedKeys && typeof parsed.storageInterestedKeys === 'object') {
          const next = {};
          for (const [pk, enabled] of Object.entries(parsed.storageInterestedKeys)) {
            if (typeof pk !== 'string' || !pk) continue;
            if (enabled === true) {
              next[pk] = true;
            }
          }
          this.storageInterestedKeys = next;
          if (!String(this.storageLookupOwnerId || '').trim()) {
            const inferredOwner = this.inferInterestedUserOwner();
            if (inferredOwner) {
              this.storageLookupOwnerId = inferredOwner;
            }
          }
        }
      } catch {
        // ignore storage failures
      }
    },
  },

  beforeUnmount() {
    if (this.networkGraphResizeObserver) {
      this.networkGraphResizeObserver.disconnect();
      this.networkGraphResizeObserver = null;
      this.networkGraphResizeObservedElement = null;
    }
    if (this.networkGraphResizeHandler) {
      window.removeEventListener('resize', this.networkGraphResizeHandler);
      this.networkGraphResizeHandler = null;
    }
    this.stopCryptoAnnounceLoop();
    this.stopDebugMonitor();
    this.resetGraphStabilization();
    clearTimeout(this.meshConnectWarnTimer);
    this.meshConnectWarnTimer = null;
    this.stopMesh();
  }
};
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

#app {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #333;
}

header {
  background: rgba(255, 255, 255, 0.95);
  padding: 1.25rem 1rem;
  text-align: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

header h1 {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

header p {
  color: #666;
  font-size: 1.1rem;
}

main {
  max-width: 1200px;
  margin: 1rem auto;
  padding: 0 1rem;
}

section {
  background: white;
  border-radius: 12px;
  padding: 1.1rem;
  margin-bottom: 1rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.workspace-tabs {
  padding-top: 0.85rem;
}

.tab-nav {
  display: flex;
  align-items: flex-end;
  gap: 0.3rem;
  margin-bottom: 0.8rem;
  border-bottom: 1px solid #cfd7e7;
}

.tab-btn {
  border: 1px solid transparent;
  background: transparent;
  color: #475569;
  border-radius: 8px 8px 0 0;
  padding: 0.45rem 0.78rem;
  font-size: 0.84rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.tab-btn:hover {
  background: #f3f6ff;
  color: #334155;
}

.tab-btn.active {
  background: #ffffff;
  color: #1f2937;
  border-color: #cfd7e7;
  border-bottom-color: #ffffff;
}

.tab-panel {
  min-height: 330px;
}

.feature-panel {
  border: 1px dashed #c7d1f0;
  border-radius: 10px;
  padding: 1rem;
  background: linear-gradient(180deg, #f8faff 0%, #ffffff 100%);
}

.feature-copy {
  margin-top: 0.45rem;
  color: #4b5563;
  font-size: 0.95rem;
  line-height: 1.45;
}

.storage-head {
  margin-top: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.storage-badge {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.25rem 0.45rem;
  border-radius: 999px;
  border: 1px solid #d1d5db;
  color: #374151;
  background: #f3f4f6;
}

.storage-badge.ready {
  color: #065f46;
  background: #ecfdf5;
  border-color: #a7f3d0;
}

.storage-badge.idle {
  color: #1e40af;
  background: #eff6ff;
  border-color: #bfdbfe;
}

.storage-help {
  font-size: 0.8rem;
  color: #475569;
}

.storage-controls {
  margin-top: 0.75rem;
  display: grid;
  grid-template-columns: minmax(140px, 0.7fr) minmax(220px, 1.4fr) minmax(240px, 1.6fr) auto;
  gap: 0.55rem;
  align-items: stretch;
}

.storage-controls .field {
  justify-content: flex-start;
}

.storage-controls .field-label {
  min-height: 1rem;
  display: flex;
  align-items: center;
}

.storage-space-field,
.storage-key-field,
.storage-value-field {
  min-width: 0;
}

.storage-key-row {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.storage-key-row .input {
  flex: 1;
  min-width: 0;
}

.storage-get-sync-btn {
  white-space: nowrap;
  flex-shrink: 0;
}

.storage-get-sync-btn.active {
  background: #3b82f6;
  color: #fff;
  border-color: #2563eb;
}

.storage-actions {
  display: flex;
  gap: 0.45rem;
  align-items: center;
  align-self: end;
}

.storage-space-note {
  margin-top: 0.65rem;
  font-size: 0.82rem;
  color: #334155;
}

.storage-interest-list {
  margin-top: 0.6rem;
  border: 1px solid #dbe3f6;
  border-radius: 8px;
  background: #f8fbff;
  padding: 0.45rem 0.55rem;
}

.storage-interest-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
}

.storage-interest-title {
  font-size: 0.76rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #334155;
}

.storage-interest-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.storage-interest-chip {
  border: 1px solid #bfd5fb;
  background: #ffffff;
  color: #1e293b;
  border-radius: 999px;
  font-size: 0.76rem;
  padding: 0.18rem 0.48rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
}

.storage-interest-chip:hover {
  background: #eff6ff;
}

.storage-error {
  margin-top: 0.45rem;
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #991b1b;
  border-radius: 8px;
  font-size: 0.82rem;
  padding: 0.4rem 0.55rem;
}

.storage-table-wrap {
  margin-top: 0.7rem;
  max-height: 240px;
  overflow: auto;
  border: 1px solid #dbe3f6;
  border-radius: 8px;
  background: #ffffff;
}

.storage-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.storage-table th,
.storage-table td {
  border-bottom: 1px solid #edf1fb;
  padding: 0.42rem 0.5rem;
  text-align: left;
  vertical-align: top;
}

.storage-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f8faff;
  color: #334155;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.storage-table tbody tr {
  cursor: pointer;
}

.storage-table tbody tr:hover {
  background: #f8fbff;
}

.storage-value-cell {
  max-width: 320px;
  white-space: pre-wrap;
  word-break: break-word;
}

.storage-empty {
  text-align: center;
  color: #64748b;
  padding: 0.8rem;
}

.crypto-grid {
  margin-top: 0.75rem;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.7rem;
}

.crypto-card {
  border: 1px solid #d6def6;
  border-radius: 10px;
  background: #ffffff;
  padding: 0.7rem;
}

.crypto-card h4 {
  font-size: 0.9rem;
  color: #1f2937;
  margin-bottom: 0.55rem;
}

.crypto-card-wide {
  grid-column: 1 / -1;
}

.crypto-row {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-bottom: 0.45rem;
}

.crypto-row:last-child {
  margin-bottom: 0;
}

.crypto-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #475569;
}

.crypto-value {
  font-size: 0.78rem;
  color: #1e293b;
  word-break: break-all;
}

.crypto-private-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.55rem;
}

.crypto-private-head h4 {
  margin-bottom: 0;
}

.crypto-visibility-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  text-transform: none;
  letter-spacing: 0;
  background: #334155;
  color: #ffffff;
}

.icon-eye {
  font-size: 0.92rem;
  line-height: 1;
}

.crypto-empty {
  font-size: 0.84rem;
  color: #64748b;
}

.crypto-peer-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  max-height: 220px;
  overflow: auto;
}

.crypto-peer-row {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.45rem;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
}

.crypto-peer-id {
  font-size: 0.8rem;
  color: #1e293b;
  word-break: break-all;
}

.crypto-peer-key {
  font-size: 0.74rem;
  color: #334155;
  word-break: break-all;
}

/* Control Panel */
.control-panel {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.55rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-topology {
  min-width: 280px;
}

.field-topology .input {
  min-width: 280px;
}

.field-label {
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #4a4a4a;
}

.field-number .input {
  text-align: center;
}

.field-session-derived {
  justify-content: flex-end;
}

.session-derived-preview {
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 0.65rem 0.8rem;
  border: 1px solid #d6d9de;
  border-radius: 10px;
  background: #f8fafc;
  color: #1e293b;
  word-break: break-all;
}

.button-group {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.55rem;
  align-items: end;
}

.button-group > * {
  justify-self: center;
}

.button-group .field {
  align-items: center;
}

.button-group .field-label {
  text-align: center;
  width: 100%;
}

.field-topology-inline {
  min-width: 220px;
}

.effective-session-inline {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  align-items: center;
  text-align: center;
  min-width: 0;
  width: 100%;
  max-width: 280px;
}

.share-link-inline {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  align-items: center;
  justify-content: flex-end;
}

.share-link-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: center;
}

.effective-session-value {
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 0.84rem;
  font-weight: 700;
  color: #3f51b5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.button-actions {
  display: flex;
  gap: 0.55rem;
}

.button-group .status-field {
  min-width: 220px;
  width: 100%;
  max-width: 320px;
  justify-content: center;
  text-align: center;
}

.control-stats-row {
  margin-top: 0.45rem;
  border: 1px solid #d6d9de;
  border-radius: 7px;
  background: #f8fafc;
  padding: 0.28rem 0.45rem;
  display: grid;
  grid-template-columns: minmax(160px, 1.2fr) repeat(3, minmax(90px, 1fr));
  gap: 0.45rem;
  align-items: center;
  min-height: 1.7rem;
}

.control-stats-row > * {
  justify-self: center;
}

.control-stat {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.12rem;
}

.control-stat-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #475569;
}

.control-stat-value {
  font-size: 0.82rem;
  font-weight: 700;
  color: #3f51b5;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.message-input {
  display: flex;
  gap: 1rem;
  width: 100%;
  align-items: stretch;
}

.input {
  padding: 0.5rem 0.7rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 0.92rem;
  transition: border-color 0.3s;
}

.message-input .input {
  flex: 1;
  min-width: 0;
}

.message-mode-controls {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 0 0 auto;
}

.mode-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  color: #334155;
  white-space: nowrap;
}

.message-target-select {
  min-width: 150px;
  max-width: 210px;
}

.message-input .btn {
  flex: 0 0 120px;
}

.diagnostics {
  border-top: 4px solid #2f6fec;
}

.diag-container {
  max-height: 260px;
  overflow: auto;
  background: #0f172a;
  color: #d1e3ff;
  border: 1px solid #1e293b;
}

.diag-entry {
  display: grid;
  grid-template-columns: 90px 120px 1fr;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 0.82rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.diag-time {
  color: #8ec5ff;
}

.diag-sender {
  color: #b0f2c2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diag-text {
  color: #e5e7eb;
  word-break: break-word;
}

.diag-empty {
  padding: 0.6rem;
  color: #94a3b8;
  font-size: 0.85rem;
}

.input:focus {
  outline: none;
  border-color: #667eea;
}

.input:disabled {
  background: #f5f5f5;
  color: #999;
}

/* Buttons */
.btn {
  padding: 0.5rem 0.9rem;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.btn-secondary {
  background: linear-gradient(135deg, #00c896 0%, #00a876 100%);
  color: white;
}

.btn-danger {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
}

.btn-small {
  padding: 0.35rem 0.65rem;
  font-size: 0.8rem;
}

/* Stats */
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0.45rem;
}

.stat-box {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0.6rem;
  background: #f8f9fa;
  border-left: 4px solid #667eea;
  border-radius: 6px;
  align-items: center;
  min-height: 2.15rem;
}

.stat-box .label {
  font-weight: 600;
  color: #333;
  font-size: 0.8rem;
}

.stat-box .value {
  font-weight: 700;
  color: #667eea;
  font-size: 0.95rem;
}

.stat-box .mono {
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 0.9rem;
  word-break: break-all;
}

/* Inline status field */
.status-field {
  border: 1px solid #d6d9de;
  border-radius: 8px;
  padding: 0.38rem 0.55rem;
  font-size: 0.83rem;
  color: #3e4a59;
  background: #f8fafc;
  min-height: 1.7rem;
  display: flex;
  align-items: center;
}

.status-field.status-connecting {
  color: #0f4c81;
  background: #edf5ff;
  border-color: #c6dfff;
}

.status-field.status-success {
  color: #165b3d;
  background: #effaf3;
  border-color: #bfe6cd;
}

.status-field.status-error {
  color: #8b1d1d;
  background: #fff1f1;
  border-color: #f1c3c3;
}

/* Network Visualization */
.network-viz {
  text-align: center;
}

.network-viz h3 {
  margin-bottom: 0.6rem;
  color: #000000;
  letter-spacing: 0.02em;
}

.network-graph-container {
  position: relative;
  margin: 0.9rem auto 0;
  max-width: 920px;
  min-height: 340px;
  border: 1px solid rgba(96, 165, 250, 0.32);
  border-radius: 14px;
  box-shadow: 0 20px 40px rgba(2, 6, 23, 0.35), inset 0 1px 0 rgba(186, 230, 253, 0.08);
  background:
    radial-gradient(circle at 14% 16%, rgba(56, 189, 248, 0.22), rgba(56, 189, 248, 0) 30%),
    radial-gradient(circle at 88% 84%, rgba(99, 102, 241, 0.2), rgba(99, 102, 241, 0) 34%),
    linear-gradient(180deg, #0b1222 0%, #0a1328 100%);
  overflow: hidden;
}

.network-graph-container::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(96, 165, 250, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(96, 165, 250, 0.06) 1px, transparent 1px);
  background-size: 22px 22px;
  mask-image: radial-gradient(circle at 50% 52%, rgba(0, 0, 0, 0.92) 0%, rgba(0, 0, 0, 0.28) 100%);
}

.network-graph-svg {
  width: 100%;
  height: 340px;
  display: block;
}

.network-link {
  stroke-width: 2px;
  opacity: 0.95;
}

.network-node {
  cursor: grab;
}

.network-node:active {
  cursor: grabbing;
}

.network-node-label {
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 11.5px;
  font-weight: 800;
  pointer-events: none;
  user-select: none;
}

.network-node.self .network-node-core {
  animation: self-node-pulse 1.8s ease-in-out infinite;
}

.network-empty {
  fill: #93c5fd;
  font-size: 14px;
  font-family: 'Monaco', 'Courier New', monospace;
}

.mesh-visualizer-caption {
  margin-top: 0.35rem;
  font-size: 0.8rem;
  color: #93c5fd;
}

.mesh-visualizer-caption code {
  font-family: 'Monaco', 'Courier New', monospace;
  font-weight: 700;
  color: #bfdbfe;
}

@keyframes self-node-pulse {
  0%,
  100% {
    filter: url(#network-node-glow);
  }
  50% {
    filter: url(#network-node-glow) brightness(1.14);
  }
}

/* Chat */
.chat h3 {
  margin-bottom: 1rem;
}

.log-controls {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1rem;
}

.log-controls label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.log-container {
  height: 300px;
  max-height: 50vh;
  overflow-y: auto;
  overflow-x: hidden;
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid #e0e0e0;
  scroll-behavior: smooth;
}

.chat-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-right: 6px; /* space for scrollbar */
}

.log-entry {
  display: flex;
}

.log-entry.signaling {
  background: #e3f2fd;
  color: #1976d2;
}

.log-entry.discovered {
  background: #fff3e0;
  color: #e65100;
}

.log-entry.connected {
  background: #e8f5e9;
  color: #2e7d32;
}

.log-entry.disconnected {
  background: #fce4ec;
  color: #c2185b;
}

.bubble {
  display: inline-block;
  max-width: 100%;
  width: fit-content;
  padding: 0.6rem 0.8rem;
  border-radius: 12px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.08);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.bubble.me {
  margin-left: auto;
  background: #16a34a !important; /* green */
  color: #ffffff !important;
  border-bottom-right-radius: 4px;
  border: 1px solid #0f7a36;
}

.bubble.peer {
  margin-right: auto;
  background: #dbeafe !important; /* light blue */
  color: #1e3a8a !important;
  border-bottom-left-radius: 4px;
  border: 1px solid #bfdbfe;
}

.bubble.dm-me {
  margin-left: auto;
  background: #4f46e5 !important;
  color: #fff !important;
  border-bottom-right-radius: 4px;
  border: 1px solid #3730a3;
}

.bubble.dm-peer {
  margin-right: auto;
  background: #fdf4ff !important;
  color: #6b21a8 !important;
  border-bottom-left-radius: 4px;
  border: 1px solid #e9d5ff;
}

/* Ensure the chat section itself clips any inner overflow */
.chat {
  overflow: hidden;
}

.bubble-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.75rem;
  opacity: 0.8;
}

.bubble-text {
  margin-top: 0.25rem;
  word-break: break-word;
}

.bubble-hops {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  opacity: 0.7;
}
/* legacy message log helpers no longer used in chat bubbles */

/* Responsive */
@media (max-width: 768px) {
  header h1 {
    font-size: 1.8rem;
  }

  .message-input {
    flex-direction: column;
  }

  .stats {
    grid-template-columns: 1fr;
  }

  .network-graph-container {
    min-height: 260px;
  }

  .network-graph-svg {
    height: 260px;
  }

  .field-topology,
  .field-topology .input {
    min-width: 0;
    width: 100%;
  }

  .storage-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .storage-controls {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .storage-actions {
    flex-wrap: wrap;
  }
}
</style>
