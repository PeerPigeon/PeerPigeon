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
            <p class="feature-copy">IndexedDB-backed, encrypted gossip-sync storage with space ACLs.</p>

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
                  <option value="public">public</option>
                  <option value="user">user</option>
                  <option value="frozen">frozen</option>
                  <option value="private">private</option>
                </select>
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
                <input v-model="storageFormValue" class="input" placeholder='{"darkMode":true}' />
              </label>

              <div class="storage-actions">
                <button class="btn btn-secondary" :disabled="!isRunning || !storageReady || storageBusy || !storageFormKey.trim()" @click="saveStorageEntry">
                  Save
                </button>
                <button class="btn btn-danger" :disabled="!isRunning || !storageReady || storageBusy || !storageFormKey.trim()" @click="deleteStorageEntry">
                  Delete
                </button>
                <button class="btn" :disabled="!isRunning || !storageReady || storageBusy" @click="refreshStorageList">
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
                  v-for="interestKey in interestedKeysForSpace(storageActiveSpace)"
                  :key="`${storageActiveSpace}:${interestKey}`"
                  class="storage-interest-chip"
                  @click="setStorageKeyInterest(storageActiveSpace, interestKey, false)"
                  :title="`Stop syncing ${interestKey}`"
                >
                  <span class="mono">{{ interestKey }}</span>
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
                    <th>Owner</th>
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
                    <td class="mono">{{ record.ownerId === storageUserId() ? 'You' : (record.ownerId || '-') }}</td>
                    <td>{{ record.version }}</td>
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
        <div class="mesh-visualizer-caption">Live from <code>mesh:peers</code> — all known peers and their connections</div>
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
const STORAGE_SYNC_TYPE = 'pp-storage-sync-v1';
const STORAGE_OP_TYPE = 'pp-storage-op-v1';

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
      storageReady: false,
      storageBusy: false,
      storageError: '',
      storageActiveSpace: 'public',
      storageFormKey: '',
      storageFormValue: '',
      storageRecords: [],
      storageUnsubscribe: null,
      storageLastUserId: '',
      storageInterestedKeys: {},
      storageRefreshInFlight: false,
      storageRefreshQueued: false,
      storageNetworkReconcileTimer: null,
      meshDemographicsTimer: null,
      meshDemographicsAuditTimer: null,
      uiStateKey: 'peerpigeon:ui-state',
      uiTabs: [
        { id: 'message', label: 'Message' },
        { id: 'media', label: 'Media' },
        { id: 'storage', label: 'Storage' },
        { id: 'crypto', label: 'Crypto' }
      ],
      graphStabilizeTimer: null,
      graphUpdateTimer: null,
      graphLastSignature: '',
      meshPeersMap: {},
      networkGraphState: null,
      networkGraphResizeHandler: null,
      debugMonitorTimer: null,
      debugLastByPeer: {}
    };
  },
  mounted() {
    window.__app = this;
    const params = new URLSearchParams(window.location.search);

    // ==== IMPORTANT: URL params take ABSOLUTE priority for test isolation ====
    // Check for explicit sessionId param FIRST (before any localStorage fallback)
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

    const autostart = (params.get('autostart') || '1').toLowerCase();
    if (autostart === '1' || autostart === 'true' || autostart === 'yes') {
      this.startMesh();
    }

    // Normalize/shareable URL immediately on load so defaults are explicit
    // and subsequent topology changes reuse the same URL state.
    this.updateUrlState();

    this.loadUiState();
    this.networkGraphResizeHandler = () => {
      this.scheduleNetworkGraphRender({ immediate: true, reason: 'resize' });
    };
    window.addEventListener('resize', this.networkGraphResizeHandler);
  },
  computed: {
    effectiveSessionId() {
      const network = String(this.networkName || '').trim();
      const room = String(this.roomSessionId || '').trim();

      if (network && room) return `${network}:${room}`;
      return network || room || 'default';
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
        this.ensureStorageReady().catch((error) => {
          this.storageError = String(error?.message || error || 'Failed to initialize storage');
        });
      }
      this.saveUiState();
    },
    meshPeersMap: {
      deep: false,
      handler() {
        this.$nextTick(() => this.scheduleNetworkGraphRender({ reason: 'storage' }));
      }
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
    roomSessionId(nextRoom) {
      if (nextRoom) {
        // Update URL when room changes via user input
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('sessionId', nextRoom);
          window.history.replaceState({}, '', url.toString());
        } catch {
          // ignore URL state errors
        }
      }
    }
  },
  methods: {
    storageInterestPk(space, key) {
      const normalizedSpace = String(space || '').trim();
      const normalizedKey = String(key || '').trim();
      if (!normalizedSpace || !normalizedKey) return '';
      return `${normalizedSpace}:${normalizedKey}`;
    },

    isStorageKeyInterested(space, key) {
      const pk = this.storageInterestPk(space, key);
      if (!pk) return false;
      return this.storageInterestedKeys[pk] === true;
    },

    interestedKeysForSpace(space) {
      const normalizedSpace = String(space || '').trim();
      if (!normalizedSpace) return [];

      const out = [];
      for (const [pk, enabled] of Object.entries(this.storageInterestedKeys)) {
        if (!enabled) continue;
        const prefix = `${normalizedSpace}:`;
        if (!pk.startsWith(prefix)) continue;
        const key = pk.slice(prefix.length);
        if (key) out.push(key);
      }

      out.sort((a, b) => a.localeCompare(b));
      return out;
    },

    setStorageKeyInterest(space, key, enabled) {
      const pk = this.storageInterestPk(space, key);
      if (!pk) return;

      this.storageInterestedKeys = {
        ...this.storageInterestedKeys,
        [pk]: Boolean(enabled),
      };
      this.saveUiState();

      if (enabled) {
        this.ensureStorageReady().catch((error) => {
          this.storageError = String(error?.message || error || 'Failed to initialize storage');
        });

        if (this.storage && this.storageReady) {
          this.storage.retrieve(space, key).catch(() => {
            // best-effort fetch from interested peers
          });
        }
      }

      if (this.activeTab === 'storage') {
        this.refreshStorageList();
      }
    },

    getSyncStorageKey() {
      const space = this.storageActiveSpace;
      const key = String(this.storageFormKey || '').trim();
      if (!key) return;

      const wasInterested = this.isStorageKeyInterested(space, key);
      if (!wasInterested) {
        this.setStorageKeyInterest(space, key, true);
      } else if (this.storage && this.storageReady) {
        this.storage.retrieve(space, key).catch(() => {});
        this.refreshStorageList();
      }
    },

    clearStorageKeyInterestForSpace(space) {
      const normalizedSpace = String(space || '').trim();
      if (!normalizedSpace) return;

      const next = { ...this.storageInterestedKeys };
      const prefix = `${normalizedSpace}:`;
      for (const pk of Object.keys(next)) {
        if (pk.startsWith(prefix)) {
          delete next[pk];
        }
      }

      this.storageInterestedKeys = next;
      this.saveUiState();

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

    storageUserId() {
      // Use epub (ECDH public key) as stable user identity for storage,
      // not peer ID which can change during session.
      return String(this.cryptoKeys?.epub || '').trim();
    },

    teardownStorage() {
      if (this.storageNetworkReconcileTimer) {
        clearTimeout(this.storageNetworkReconcileTimer);
        this.storageNetworkReconcileTimer = null;
      }

      if (this.meshDemographicsTimer) {
        clearTimeout(this.meshDemographicsTimer);
        this.meshDemographicsTimer = null;
      }

      if (this.storageUnsubscribe) {
        this.storageUnsubscribe();
        this.storageUnsubscribe = null;
      }

      if (this.storage) {
        this.storage.close().catch(() => {
          // ignore close failures
        });
        this.storage = null;
      }

      this.storageReady = false;
      this.storageBusy = false;
      this.storageRecords = [];
      this.meshPeersMap = {};
      this.storageLastUserId = '';
      this.storageRefreshInFlight = false;
      this.storageRefreshQueued = false;
    },

    applyStorageChangeEvent(event) {
      if (!event) return;

      if (event.space === 'public' && event.key === 'mesh:peers') {
        if (event.op === 'delete') {
          this.meshPeersMap = {};
        } else if (event.record && typeof event.record.value === 'object' && event.record.value !== null) {
          this.meshPeersMap = { ...event.record.value };
        }
      }

      if (event.space !== this.storageActiveSpace) return;
      if (!this.isStorageKeyInterested(event.space, event.key)) return;

      if (event.op === 'delete') {
        this.storageRecords = this.storageRecords.filter((record) => record.key !== event.key);
        return;
      }

      const nextRecord = event.record;
      if (!nextRecord) return;

      const next = this.storageRecords.slice();
      const existingIndex = next.findIndex((record) => record.key === nextRecord.key);
      if (existingIndex >= 0) {
        next.splice(existingIndex, 1, nextRecord);
      } else {
        next.push(nextRecord);
      }
      next.sort((a, b) => String(a.key).localeCompare(String(b.key)));
      this.storageRecords = next;
    },

    scheduleMeshDemographicsUpdate() {
      if (this.meshDemographicsTimer) clearTimeout(this.meshDemographicsTimer);
      this.meshDemographicsTimer = setTimeout(() => {
        this.meshDemographicsTimer = null;
        this.publishMeshDemographics().catch(() => {});
      }, 400);
    },

    startMeshDemographicsAuditLoop() {
      this.stopMeshDemographicsAuditLoop();
      this.meshDemographicsAuditTimer = setInterval(() => {
        if (!this.isRunning) return;
        this.publishMeshDemographics().catch(() => {});
      }, 2500);
    },

    stopMeshDemographicsAuditLoop() {
      if (this.meshDemographicsAuditTimer) {
        clearInterval(this.meshDemographicsAuditTimer);
        this.meshDemographicsAuditTimer = null;
      }
    },

    async publishMeshDemographics() {
      if (!this.storage || !this.storageReady) return;
      const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
      if (!self) return;

      const epub = String(this.cryptoKeys?.epub || '').trim();
      const connected = [...new Set((this.mesh?.getConnectedPeers?.() || [])
        .map((peerId) => String(peerId || '').trim())
        .filter((peerId) => peerId && peerId !== self))]
        .sort((a, b) => a.localeCompare(b));
      const network = String(this.effectiveSessionId || '').trim();
      const now = Date.now();

      // Read-then-merge: fetch current network map, inject our entry, write back.
      let current = {};
      try {
        const existing = await this.storage.get('public', 'mesh:peers');
        if (existing && typeof existing.value === 'object' && existing.value !== null) {
          current = { ...existing.value };
        }
      } catch {
        // treat as empty on read failure
      }

      current[self] = {
        peerId: self,
        epub: epub || null,
        connectedTo: connected,
        network,
        seenAt: now,
      };

      // Each peer audits/corrects only its own mesh:peers entry.
      await this.storage.put('public', 'mesh:peers', current).catch(() => {});
    },

    scheduleStorageNetworkReconcile() {
      if (this.storageNetworkReconcileTimer) {
        clearTimeout(this.storageNetworkReconcileTimer);
      }

      // Topology can churn quickly; debounce to a single reconcile burst.
      this.storageNetworkReconcileTimer = setTimeout(() => {
        this.storageNetworkReconcileTimer = null;
        this.reconcileInterestedStorageFromNetwork().catch(() => {
          // best-effort on topology changes
        });
      }, 180);
    },

    async reconcileInterestedStorageFromNetwork() {
      if (!this.gossip) return;
      await this.ensureStorageReady();
      if (!this.storage || !this.storageReady) return;

      const entries = Object.entries(this.storageInterestedKeys || {});
      for (const [pk, enabled] of entries) {
        if (!enabled) continue;
        const idx = pk.indexOf(':');
        if (idx <= 0 || idx >= pk.length - 1) continue;
        const space = pk.slice(0, idx);
        const key = pk.slice(idx + 1);
        if (!space || !key) continue;

        await this.storage.retrieve(space, key, { timeoutMs: 1200 }).catch(() => {
          // best-effort per key
        });
      }
    },

    async ensureStorageReady() {
      const userId = this.storageUserId();
      if (!userId || !this.gossip) return;

      if (this.storage && this.storageLastUserId === userId) {
        this.storageReady = true;
        return;
      }

      if (this.storage) {
        if (this.storageUnsubscribe) {
          this.storageUnsubscribe();
          this.storageUnsubscribe = null;
        }
        try {
          await this.storage.close();
        } catch {
          // ignore close errors
        }
        this.storage = null;
      }

      const next = new PeerPigeonStorage({
        userId,
        gossip: this.gossip,
        sessionId: this.effectiveSessionId,
        dbName: `peerpigeon-demo-storage:${this.effectiveSessionId}`,
        syncFilter: (space, key) => this.isStorageKeyInterested(space, key),
      });

      await next.init();
      this.storageUnsubscribe = next.subscribe((event) => {
        this.applyStorageChangeEvent(event);
      });

      this.storage = next;
      this.storageLastUserId = userId;
      this.storageReady = true;
      this.storageError = '';
      this.setStorageKeyInterest('public', 'mesh:peers', true);
      await this.refreshMeshPeersFromStorage();
      await this.refreshStorageList();
    },

    async refreshMeshPeersFromStorage() {
      if (!this.storage || !this.storageReady) {
        this.meshPeersMap = {};
        return;
      }

      try {
        const record = await this.storage.get('public', 'mesh:peers');
        const value = record && typeof record.value === 'object' && record.value !== null
          ? record.value
          : {};
        this.meshPeersMap = { ...value };
      } catch {
        this.meshPeersMap = {};
      }
    },

    async refreshStorageList(options = {}) {
      if (!this.storage || !this.storageReady) {
        this.storageRecords = [];
        return;
      }

      const silent = options && options.silent === true;

      if (this.storageRefreshInFlight) {
        this.storageRefreshQueued = true;
        return;
      }

      this.storageRefreshInFlight = true;
      if (!silent) {
        this.storageBusy = true;
      }
      this.storageError = '';

      try {
        do {
          this.storageRefreshQueued = false;
          const keys = this.interestedKeysForSpace(this.storageActiveSpace);
          const records = [];
          for (const key of keys) {
            // Per-key lookups are network-aware so interested keys reconcile
            // from peers instead of sticking to stale local IndexedDB values.
            const record = await this.storage.retrieve(this.storageActiveSpace, key, { timeoutMs: 1200 });
            if (record) records.push(record);
          }
          this.storageRecords = records;
        } while (this.storageRefreshQueued);
      } catch (error) {
        this.storageError = String(error?.message || error || 'Failed to load storage');
      } finally {
        this.storageRefreshInFlight = false;
        if (!silent) {
          this.storageBusy = false;
        }
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
      if (!this.storage || !this.storageReady) return;
      const key = String(this.storageFormKey || '').trim();
      if (!key) return;

      if (!this.isStorageKeyInterested(this.storageActiveSpace, key)) {
        this.setStorageKeyInterest(this.storageActiveSpace, key, true);
      }

      this.storageBusy = true;
      this.storageError = '';
      try {
        const value = this.parseStorageInput(this.storageFormValue);
        await this.storage.put(this.storageActiveSpace, key, value);
        await this.refreshStorageList();
      } catch (error) {
        this.storageError = String(error?.message || error || 'Failed to save storage key');
      } finally {
        this.storageBusy = false;
      }
    },

    async deleteStorageEntry() {
      if (!this.storage || !this.storageReady) return;
      const key = String(this.storageFormKey || '').trim();
      if (!key) return;

      if (!this.isStorageKeyInterested(this.storageActiveSpace, key)) {
        this.setStorageKeyInterest(this.storageActiveSpace, key, true);
      }

      this.storageBusy = true;
      this.storageError = '';
      try {
        await this.storage.delete(this.storageActiveSpace, key);
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
          nonInitiatorFallbackDialMs: 8_000,
          underConnectedResetMs: 20_000
        });

        this.gossip = new GossipProtocol(this.mesh);
        // Runtime inspection hook for debugging in dev tools / automation.
        window.__mesh = this.mesh;
        window.__gossip = this.gossip;

        // Mesh events
        this.mesh.on('signaling:connected', (data) => {
          this.signalingConnected = true;
          this.clientId = (data.clientId || '').trim();
          this.addLog('signaling', `Connected to signaling server`, this.clientId);
          this.registerLocalPublicCryptoInfo();
          this.announceCryptoPublicInfo();
          this.ensureStorageReady().catch((error) => {
            this.storageError = String(error?.message || error || 'Failed to initialize storage');
          });
          this.scheduleMeshDemographicsUpdate();
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
          this.addLog('connected', `Connected to peer`, peerId);
          this.announceCryptoPublicInfo();
          this.scheduleStorageNetworkReconcile();
          this.scheduleMeshDemographicsUpdate();
          this.updateStats();
        });

        this.mesh.on('peer:disconnected', (peerId) => {
          this.addLog('disconnected', `Disconnected from peer`, peerId);
          this.scheduleStorageNetworkReconcile();
          this.scheduleMeshDemographicsUpdate();
          this.updateStats();
        });

        this.mesh.on('peer:error', ({ peerId, error }) => {
          const message = String(error?.message || error || 'unknown error');
          this.addLog('info', `Peer error: ${message}`, peerId || 'peer');
          this.updateStats();
        });

        this.mesh.on('peer:discovered', (peerId) => {
          const self = String(this.mesh?.getClientId?.() || '').trim();
          const initiator = self && peerId ? self < peerId : false;
          this.addLog('info', `Dial role -> ${initiator ? 'initiator' : 'non-initiator(wait)'}`, peerId || 'debug');
        });

        this.mesh.on('mesh:membership', () => {
          this.scheduleStorageNetworkReconcile();
          this.scheduleMeshDemographicsUpdate();
          this.updateStats();
        });

        this.mesh.on('mesh:ready', () => {
          this.addLog('info', 'Gossip reached ready state', 'System');
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
        this.startMeshDemographicsAuditLoop();
        this.scheduleMeshDemographicsUpdate();
        this.announceCryptoPublicInfo();
        this.startDebugMonitor();

        // Best-effort warning only; do not hard-fail startup on transient signaling slowness.
        setTimeout(() => {
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
      this.stopMeshDemographicsAuditLoop();
      this.stopDebugMonitor();
      this.resetGraphStabilization();
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

      let keys = parseStored(localStorage.getItem(this.cryptoStorageKey));
      if (!keys) {
        keys = await generateRandomPair();
        try {
          localStorage.setItem(this.cryptoStorageKey, JSON.stringify(keys));
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
        (data.__ppType === STORAGE_SYNC_TYPE || data.__ppType === STORAGE_OP_TYPE)
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

      // Storage sync traffic is handled by PeerPigeonStorage and should never
      // appear in chat or diagnostics.
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

    networkGraphData() {
      const now = Date.now();
      const activeNetwork = String(this.effectiveSessionId || '').trim();
      const staleMs = 12_000;

      // Local live truth for immediate correctness.
      const localSelf = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
      const localConnected = (this.mesh?.getConnectedPeers?.() || this.connectedPeersList || [])
        .map((p) => String(p || '').trim())
        .filter(Boolean);
      const uniqueLocalConnected = [...new Set(localConnected)];

      const peers = {};

      if (localSelf) {
        peers[localSelf] = {
          id: localSelf,
          connectedTo: uniqueLocalConnected,
          seenAt: now,
        };
      }

      // Storage-backed room topology: connectedTo only (never discovered list).
      for (const [peerId, rawInfo] of Object.entries(this.meshPeersMap || {})) {
        const id = String(peerId || '').trim();
        if (!id || id === localSelf) continue;

        const info = rawInfo && typeof rawInfo === 'object' ? rawInfo : {};
        const network = String(info.network || '').trim();
        if (network && activeNetwork && network !== activeNetwork) continue;

        const seenAt = Number(info.seenAt || 0);
        if (Number.isFinite(seenAt) && seenAt > 0 && now - seenAt > staleMs) continue;

        const connectedTo = Array.isArray(info.connectedTo)
          ? [...new Set(info.connectedTo
            .map((p) => String(p || '').trim())
            .filter((p) => p && p !== id))]
          : [];

        if (connectedTo.length === 0) continue;

        peers[id] = {
          id,
          connectedTo,
          seenAt: Number.isFinite(seenAt) ? seenAt : 0,
        };
      }

      const links = [];
      const edgeSeen = new Set();
      const participants = new Set();

      // Always show local live edges from the connected-status source.
      if (localSelf) {
        for (const target of uniqueLocalConnected) {
          const edgeId = [localSelf, target].sort().join('|');
          if (edgeSeen.has(edgeId)) continue;
          edgeSeen.add(edgeId);
          participants.add(localSelf);
          participants.add(target);
          links.push({ source: localSelf, target });
        }
      }

      // For remote edges, require reciprocal connectedTo confirmation.
      for (const [peerId, info] of Object.entries(peers)) {
        if (!Array.isArray(info?.connectedTo)) continue;
        for (const target of info.connectedTo) {
          const targetId = String(target || '').trim();
          if (!targetId || targetId === peerId) continue;
          if (peerId === localSelf || targetId === localSelf) continue;

          const targetInfo = peers[targetId];
          const reciprocal = Array.isArray(targetInfo?.connectedTo)
            && targetInfo.connectedTo.includes(peerId);
          if (!reciprocal) continue;

          const edgeId = [peerId, targetId].sort().join('|');
          if (edgeSeen.has(edgeId)) continue;
          edgeSeen.add(edgeId);
          participants.add(peerId);
          participants.add(targetId);
          links.push({ source: peerId, target: targetId });
        }
      }

      const nodeIds = [...participants];
      if (localSelf && !nodeIds.includes(localSelf)) {
        nodeIds.push(localSelf);
      }

      const nodes = nodeIds
        .sort((a, b) => a.localeCompare(b))
        .map((peerId) => ({
          id: peerId,
          short: peerId.slice(0, 4).toUpperCase(),
          isSelf: peerId === this.clientId,
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
          return [source, target].sort().join('|');
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

      const width = Math.max(320, Math.floor(container.clientWidth || 320));
      const height = Math.max(280, Math.floor(container.clientHeight || 280));
      const { nodes, links } = this.networkGraphData();
      const signature = this.networkGraphSignature(nodes, links);

      const prevState = this.networkGraphState;
      const sameTopology = this.graphLastSignature && signature === this.graphLastSignature;
      const sameSize = prevState && prevState.width === width && prevState.height === height;
      if (sameTopology && sameSize && reason !== 'resize') {
        return;
      }

      this.graphLastSignature = signature;

      const svg = d3.select(svgEl)
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('width', width)
        .attr('height', height);

      svg.selectAll('*').remove();

      if (!nodes.length) {
        clearTimeout(this.graphStabilizeTimer);
        this.graphStabilizeTimer = null;
        if (prevState?.simulation) prevState.simulation.stop();
        this.networkGraphState = null;
        return;
      }

      const priorPositions = prevState?.positions || {};
      for (const node of nodes) {
        const prior = priorPositions[node.id];
        if (!prior) continue;
        node.x = prior.x;
        node.y = prior.y;
        node.vx = 0;
        node.vy = 0;
      }

      const defs = svg.append('defs');
      const selfFill = defs.append('radialGradient').attr('id', 'network-self-fill');
      selfFill.append('stop').attr('offset', '0%').attr('stop-color', '#eef2ff');
      selfFill.append('stop').attr('offset', '100%').attr('stop-color', '#c7d2fe');

      const root = svg.append('g').attr('class', 'network-root');

      const link = root
        .append('g')
        .attr('class', 'network-links')
        .selectAll('line')
        .data(links)
        .enter()
        .append('line')
        .attr('class', 'network-link')
        .attr('stroke', '#94a3b8')
        .attr('stroke-width', 2);

      const node = root
        .append('g')
        .attr('class', 'network-nodes')
        .selectAll('g')
        .data(nodes)
        .enter()
        .append('g')
        .attr('class', (d) => `network-node${d.isSelf ? ' self' : ''}`);

      node.append('circle')
        .attr('r', 16)
        .attr('stroke', (d) => `hsl(${d.hue}, 100%, 46%)`)
        .attr('fill', (d) => (d.isSelf ? 'url(#network-self-fill)' : '#ffffff'))
        .attr('stroke-width', (d) => (d.isSelf ? 4 : 3));

      node.append('text')
        .attr('class', 'network-node-label')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .text((d) => d.short);

      const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id((d) => d.id).distance(95).strength(0.42))
        .force('charge', d3.forceManyBody().strength(-340))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(34))
        .alphaDecay(0.08);

      const drag = d3.drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.25).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        });

      node.call(drag);

      simulation.on('tick', () => {
        link
          .attr('x1', (d) => d.source.x)
          .attr('y1', (d) => d.source.y)
          .attr('x2', (d) => d.target.x)
          .attr('y2', (d) => d.target.y);

        node.attr('transform', (d) => {
          const x = Math.max(20, Math.min(width - 20, d.x));
          const y = Math.max(20, Math.min(height - 20, d.y));
          return `translate(${x},${y})`;
        });

        if (this.networkGraphState?.simulation === simulation) {
          this.networkGraphState.positions = Object.fromEntries(
            nodes.map((n) => [
              n.id,
              {
                x: Number.isFinite(n.x) ? n.x : width / 2,
                y: Number.isFinite(n.y) ? n.y : height / 2,
              },
            ])
          );
        }
      });

      clearTimeout(this.graphStabilizeTimer);
      this.graphStabilizeTimer = setTimeout(() => {
        simulation.stop();
      }, 1300);

      if (prevState?.simulation) {
        prevState.simulation.stop();
      }
      this.networkGraphState = {
        simulation,
        width,
        height,
        positions: Object.fromEntries(
          nodes.map((n) => [
            n.id,
            {
              x: Number.isFinite(n.x) ? n.x : width / 2,
              y: Number.isFinite(n.y) ? n.y : height / 2,
            },
          ])
        ),
      };

      simulation.on('end', () => {
        if (!this.networkGraphState || this.networkGraphState.simulation !== simulation) return;
        this.networkGraphState.positions = Object.fromEntries(
          nodes.map((n) => [
            n.id,
            {
              x: Number.isFinite(n.x) ? n.x : width / 2,
              y: Number.isFinite(n.y) ? n.y : height / 2,
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

      if (import.meta.env.DEV) {
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

      this.debugMonitorTimer = setInterval(() => {
        try {
          const rawClient = this.mesh?.signalingClient?.client;
          const connections = rawClient?.mesh?.connections;
          if (!connections || typeof connections.entries !== 'function') return;

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
      }, 500);
    },

    stopDebugMonitor() {
      if (this.debugMonitorTimer) {
        clearInterval(this.debugMonitorTimer);
        this.debugMonitorTimer = null;
      }
      this.debugLastByPeer = {};
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
        if (this.networkName) url.searchParams.set('networkName', this.networkName);
        
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

        localStorage.setItem(this.uiStateKey, JSON.stringify({
          activeTab: this.activeTab || 'message',
          dmTarget: this.dmTarget || '',
          directMode: !!this.directMode,
          showPrivateCrypto: !!this.showPrivateCrypto,
          storageActiveSpace: this.storageActiveSpace || 'public',
          storageInterestedKeys: interested,
        }));
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
        const allowedSpaces = new Set(['public', 'user', 'frozen', 'private']);
        if (typeof parsed.storageActiveSpace === 'string' && allowedSpaces.has(parsed.storageActiveSpace)) {
          this.storageActiveSpace = parsed.storageActiveSpace;
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
        }
      } catch {
        // ignore storage failures
      }
    },
  },

  beforeUnmount() {
    if (this.networkGraphResizeHandler) {
      window.removeEventListener('resize', this.networkGraphResizeHandler);
      this.networkGraphResizeHandler = null;
    }
    this.stopCryptoAnnounceLoop();
    this.stopDebugMonitor();
    this.resetGraphStabilization();
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
}

.network-graph-container {
  position: relative;
  margin: 0.9rem auto 0;
  max-width: 860px;
  min-height: 340px;
  border: 1px solid #d8def5;
  border-radius: 12px;
  background:
    radial-gradient(circle at 14% 16%, rgba(46, 144, 250, 0.12), rgba(46, 144, 250, 0) 28%),
    radial-gradient(circle at 88% 84%, rgba(16, 185, 129, 0.11), rgba(16, 185, 129, 0) 32%),
    linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%);
  overflow: hidden;
}

.network-graph-svg {
  width: 100%;
  height: 340px;
  display: block;
}

.network-link {
  stroke: #94a3b8;
  stroke-width: 2px;
  opacity: 1;
}

.network-node {
  cursor: grab;
}

.network-node:active {
  cursor: grabbing;
}

.network-node-label {
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 10px;
  font-weight: 700;
  fill: #0f172a;
  pointer-events: none;
  user-select: none;
}

.network-empty {
  fill: #475569;
  font-size: 14px;
  font-family: 'Monaco', 'Courier New', monospace;
}

.mesh-visualizer-caption {
  margin-top: 0.35rem;
  font-size: 0.8rem;
  color: #475569;
}

.mesh-visualizer-caption code {
  font-family: 'Monaco', 'Courier New', monospace;
  font-weight: 700;
  color: #334155;
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
