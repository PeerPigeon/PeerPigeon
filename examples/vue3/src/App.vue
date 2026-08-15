<template>
  <div id="app">
    <header>
      <div class="header-brand">
        <img src="/pigeonlogo.svg" alt="PeerPigeon" class="header-logo" />
        <h1>PeerPigeon Demo</h1>
      </div>
      <p>Distributed peer networking using WebRTC, partial mesh and gossip</p>
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
            </div>
          </div>
          <label class="field field-topology-inline">
            <span class="field-label">Topology</span>
            <select
              ref="topologySelect"
              :value="topology"
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

          <div
            v-if="!isRunning"
            class="status-field"
            :class="`status-${status.type}`"
            data-testid="status-message"
          >
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
              list="federated-signaling-servers"
              placeholder="auto"
              :title="activeSignalingServer || 'Automatic federated relay selection'"
            />
            <datalist id="federated-signaling-servers">
              <option value="auto">Automatic</option>
              <option
                v-for="relayUrl in signalingServerOptions"
                :key="relayUrl"
                :value="relayUrl"
              ></option>
            </datalist>
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
              ref="minPeersInput"
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
          <div class="control-stat control-stat-peer-id">
            <span class="control-stat-label">Peer ID</span>
            <span class="control-stat-value peer-id-full mono" :title="clientId" data-testid="client-id">{{ peerIdDisplay }}</span>
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

        <div
          v-if="isRunning"
          ref="networkGraphContainer"
          class="network-graph-container"
          data-testid="mesh-visualizer"
        >
          <PeerNetworkGraph
            ref="peerNetworkGraph"
            :nodes="networkGraphModel.nodes"
            :links="networkGraphModel.links"
            :activity-by-peer="networkGraphActivityByPeer"
          />
          <div
            class="network-graph-gossip-status"
            :class="`gossip-state-${networkGossipState}`"
            data-testid="status-message"
            role="status"
            aria-live="polite"
          >
            <FontAwesomeIcon :icon="icons.state" class="network-graph-gossip-icon" aria-hidden="true" />
            <span>{{ status.message || 'Idle' }}</span>
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
            <h3 class="section-heading">
              <FontAwesomeIcon :icon="icons.message" class="section-heading-icon" aria-hidden="true" />
              <span>Message</span>
            </h3>
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
                  <div class="bubble-text">
                    <FontAwesomeIcon
                      v-if="entry.icon && icons[entry.icon]"
                      :icon="icons[entry.icon]"
                      class="bubble-icon"
                      aria-hidden="true"
                    />
                    <span>{{ entry.text }}</span>
                  </div>
                  <div
                    v-if="entry.messageId && deliveryReceipts[entry.messageId]"
                    class="bubble-delivery"
                    :class="deliveryReceiptClass(entry.messageId)"
                  >
                    {{ deliveryReceiptLabel(entry.messageId) }}
                  </div>
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
            <h3 class="section-heading">
              <FontAwesomeIcon :icon="icons.media" class="section-heading-icon" aria-hidden="true" />
              <span>Media</span>
            </h3>
            <p class="feature-copy">Media controls are scaffolded here for upcoming file and stream sharing workflows.</p>
          </div>

          <div v-else-if="activeTab === 'storage'" class="tab-panel feature-panel" role="tabpanel" aria-label="Storage panel">
            <h3 class="section-heading">
              <FontAwesomeIcon :icon="icons.storage" class="section-heading-icon" aria-hidden="true" />
              <span>Storage</span>
            </h3>
            <p class="feature-copy">Key/value storage stays local until you Get a key and subscribe to its peer updates.</p>

            <div class="storage-head">
              <div class="storage-badge" :class="storageReady ? 'ready' : 'idle'">
                {{ storageReady ? 'Ready' : 'Waiting for mesh identity' }}
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
                <button class="btn storage-get-sync-btn" :class="{ active: isStorageKeyInterested(storageActiveSpace, storageFormKey) }" :disabled="!storageFormKey.trim() || !isRunning || !storageReady || storageBusy" @click="getStorageKey">
                  Get
                </button>
              </div>
            </div>

            <div class="storage-space-note">{{ storageSpaceDescription }}</div>

            <div class="storage-interest-list" v-if="interestedKeysForSpace(storageActiveSpace).length">
              <div class="storage-interest-head">
                <span class="storage-interest-title">Subscribed keys ({{ storageActiveSpace }})</span>
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
                  <FontAwesomeIcon :icon="icons.close" aria-hidden="true" />
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
                    <td class="mono storage-value-cell">
                      <div
                        class="storage-value-scroll"
                        :class="{ 'is-scrolling': storageTableScrollingKey === `${record.space}:${record.key}` }"
                        @scroll.passive="handleStorageTableValueScroll(record)"
                      >{{ storageRecordText(record.value) }}</div>
                    </td>
                    <td class="mono">{{ storageModifiedBy(record) }}</td>
                    <td>{{ formatStorageVersion(record.version) }}</td>
                    <td>{{ formatTime(record.updatedAt) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-else-if="activeTab === 'crypto'" class="tab-panel feature-panel" role="tabpanel" aria-label="Crypto panel">
            <h3 class="section-heading">
              <FontAwesomeIcon :icon="icons.crypto" class="section-heading-icon" aria-hidden="true" />
              <span>Crypto</span>
            </h3>
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
                    <FontAwesomeIcon
                      :icon="showPrivateCrypto ? icons.eyeSlash : icons.eye"
                      class="icon-eye"
                      aria-hidden="true"
                    />
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

      <!-- Diagnostics -->
      <section class="chat diagnostics" v-if="isRunning">
        <h3 class="section-heading">
          <FontAwesomeIcon :icon="icons.diagnostics" class="section-heading-icon" aria-hidden="true" />
          <span>Diagnostics</span>
        </h3>
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

    <div
      v-if="customTopologyModalOpen"
      class="modal-backdrop"
      @click.self="cancelCustomTopology"
      @keydown.esc="cancelCustomTopology"
    >
      <div
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-topology-modal-title"
        aria-describedby="custom-topology-modal-description"
      >
        <h2 id="custom-topology-modal-title">Stop mesh and customize?</h2>
        <p id="custom-topology-modal-description">
          Switching to Custom will stop the active mesh. You can then change Min Peers,
          Max Peers, and Tolerant before starting the mesh again.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn btn-small" @click="cancelCustomTopology">
            Cancel
          </button>
          <button
            ref="confirmCustomTopologyButton"
            type="button"
            class="btn btn-danger btn-small"
            data-testid="confirm-custom-topology"
            @click="confirmCustomTopology"
          >
            Stop Mesh &amp; Customize
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { DEFAULT_SIGNALING_SERVERS, PartialMesh } from 'peerpigeon';
import { GossipProtocol } from 'peerpigeon';
import { PeerPigeonStorage } from 'peerpigeon';
import { PeerPigeonCryptoProtocol } from 'peerpigeon';
import { generateRandomPair, encryptMessageWithMeta, decryptMessageWithMeta } from 'unsea';
import * as d3 from 'd3';
import {
  isInternalChatText,
  isInternalMessagePayload,
  normalizeMessagePayload,
} from './message-payloads.js';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import {
  faCommentDots,
  faCircle,
  faDatabase,
  faEnvelope,
  faEye,
  faEyeSlash,
  faFilm,
  faInbox,
  faLock,
  faPaperPlane,
  faSatelliteDish,
  faScrewdriverWrench,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import PeerNetworkGraph from './components/PeerNetworkGraph.vue';
import { canonicalPeerId } from './peer-id.js';

const APP_ICONS = Object.freeze({
  state: faCircle,
  message: faCommentDots,
  media: faFilm,
  storage: faDatabase,
  crypto: faLock,
  diagnostics: faScrewdriverWrench,
  eye: faEye,
  eyeSlash: faEyeSlash,
  sent: faPaperPlane,
  directSend: faEnvelope,
  received: faInbox,
  directReceive: faEnvelope,
  broadcast: faSatelliteDish,
  warning: faTriangleExclamation,
  close: faXmark,
});

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
const DEBUG_MONITOR_INTERVAL_MS = 1000;
const DEBUG_MONITOR_PEER_LOG_MIN_GAP_MS = 2500;
const STORAGE_PEER_SCOPE_SESSION_KEY = 'peerpigeon:storage-peer-scope:v1';

function getOrCreateStoragePeerScopeId() {
  const createScopeId = () => {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    return `peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  };

  try {
    const existing = String(sessionStorage.getItem(STORAGE_PEER_SCOPE_SESSION_KEY) || '').trim();
    if (existing) return existing;
    const created = createScopeId();
    sessionStorage.setItem(STORAGE_PEER_SCOPE_SESSION_KEY, created);
    return created;
  } catch {
    return createScopeId();
  }
}

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
  components: {
    FontAwesomeIcon,
    PeerNetworkGraph,
  },
  data() {
    return {
      mesh: null,
      icons: APP_ICONS,
      gossip: null,
      cryptoProtocol: null,
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
      customTopologyModalOpen: false,
      networkName: 'peerpigeon',
      roomSessionId: '',
      signalingServer: 'auto',
      activeSignalingServer: '',
      signalingServerOptions: [...DEFAULT_SIGNALING_SERVERS],
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
      storagePeerScopeId: getOrCreateStoragePeerScopeId(),
      storageReady: false,
      storageBusy: false,
      storageError: '',
      storageActiveSpace: 'user',
      storageLookupOwnerId: '',
      storageFormKey: '',
      storageFormValue: '',
      storageTableScrollingKey: '',
      storageTableScrollTimer: null,
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
      networkGraphRevision: 0,
      networkGraphState: null,
      networkGraphActivityByPeer: {},
      networkGraphKnownEdgeKeys: [],
      networkGraphResizeHandler: null,
      networkGraphResizeObserver: null,
      networkGraphResizeObservedElement: null,
      debugMonitorTimer: null,
      debugLastByPeer: {},
      debugLastLogAtByPeer: {},
      unexpectedMeshRestartInFlight: false,
      runtimeMode: 'typescript',
      goWasmNodeId: null,
      goWasmHandlers: {
        messageReceived: new Set(),
        directMessageReceived: new Set(),
        deliveryProgress: new Set(),
        deliveryComplete: new Set(),
        deliveryTimeout: new Set(),
      },
      deliveryReceipts: {},
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
      this.signalingServer = this.usesAutomaticSignalingServer(signalingServerParam)
        ? 'auto'
        : signalingServerParam;
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

    const autostartParam = params.get('autostart');
    const autostart = autostartParam == null
      || !['0', 'false', 'no', 'off'].includes(autostartParam.trim().toLowerCase());
    if (autostart) {
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
  updated() {
    // HMR preserves data from tabs opened with the former explicit peer.ooo
    // default. Migrate that live state too, not only fresh page loads.
    if (this.usesAutomaticSignalingServer(this.signalingServer) && this.signalingServer !== 'auto') {
      this.signalingServer = 'auto';
      this.updateUrlState();
      if (import.meta.env.DEV && this.isRunning) {
        this.restartUnexpectedlyStoppedMesh('automatic relay migration');
        return;
      }
    }
    // Older HMR cleanup destroyed window.__mesh while Vue retained this
    // component and its `isRunning` state. Repair that impossible half-state
    // automatically instead of leaving a dev tab stuck at Connected 0.
    if (
      import.meta.env.DEV
      && this.isRunning
      && this.mesh
      && !this.mesh.signalingClient
    ) {
      this.restartUnexpectedlyStoppedMesh('hot update');
    }
  },
  computed: {
    networkGossipState() {
      if (!this.isRunning) return 'grey';

      const message = String(this.status?.message || '').toLowerCase();
      const type = String(this.status?.type || '').toLowerCase();

      if (
        type === 'error'
        || message.includes('offline')
        || message.includes('poor')
      ) {
        return 'red';
      }
      if (
        !this.signalingConnected
        || type === 'connecting'
        || type === 'info'
        || message.includes('fair')
        || message.includes('degraded')
      ) {
        return 'yellow';
      }
      if (type === 'success') return 'green';
      return 'grey';
    },

    networkGraphModel() {
      // Direct line state must use the same reactive peer IDs as the Connected
      // counter. Track the IDs, not only length, so same-count peer swaps repaint.
      void this.connectedPeersList.join('|');
      void this.discoveredPeersList.join('|');
      void this.globalPeersList.join('|');
      void this.networkGraphRevision;
      return this.networkGraphData();
    },

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
      return canonicalPeerId(this.clientId);
    },
    discoveredPeers() {
      return this.discoveredPeersList.length;
    },
    chatMessages() {
      return this.messageLog.filter(e => (
        (e.type === 'sent' || e.type === 'received') &&
        !e.system &&
        !isInternalChatText(e.text)
      ));
    },
    diagnosticMessages() {
      return this.messageLog.filter(e => (e.type !== 'sent' && e.type !== 'received') || e.system);
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
    },
    signalingServer() {
      this.updateUrlState();
    }
  },
  methods: {
    usesAutomaticSignalingServer(value) {
      const raw = String(value || '').trim();
      if (!raw) return true;
      const mode = raw.toLowerCase();
      if (mode === 'auto' || mode === 'automatic') return true;
      try {
        const candidate = new URL(raw);
        if (candidate.protocol === 'https:') candidate.protocol = 'wss:';
        if (candidate.protocol === 'http:') candidate.protocol = 'ws:';
        if (!candidate.pathname || candidate.pathname === '/') candidate.pathname = '/ws';
        candidate.search = '';
        candidate.hash = '';
        return this.signalingServerOptions.some((relayUrl) => {
          const known = new URL(relayUrl);
          return candidate.toString() === known.toString();
        });
      } catch {
        return false;
      }
    },

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
      const wireKey = this.storageWireKey(space, key, ownerId);
      if (wireKey && enabled === true) {
        this.storage?.subscribeKey?.(space, wireKey);
      } else if (wireKey) {
        this.storage?.unsubscribeKey?.(space, wireKey);
      }
      this.saveUiState();

      if (this.activeTab === 'storage') {
        this.refreshStorageList({ syncInterested: false });
      }
    },

    async getStorageKey() {
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
      this.storageBusy = true;
      this.storageError = '';

      const showCurrentValue = async () => {
        const current = await this.storage?.get(space, wireKey);
        if (current) {
          this.storageFormValue = typeof current.value === 'string'
            ? current.value
            : JSON.stringify(current.value);
        }
        await this.refreshStorageList({ silent: true, syncInterested: false });
      };

      try {
        const current = await this.storage.retrieve(space, wireKey, { timeoutMs: 2500 });
        if (current) {
          this.storageFormValue = typeof current.value === 'string'
            ? current.value
            : JSON.stringify(current.value);
        }
        await showCurrentValue();

        // Go/WASM retrieval is intentionally backgrounded to avoid blocking
        // the browser main thread. Re-read after its response can arrive.
        if (isGoWasm) {
          setTimeout(() => showCurrentValue().catch(() => {}), 300);
          setTimeout(() => showCurrentValue().catch(() => {}), 1000);
        }
      } catch (error) {
        this.storageError = String(error?.message || error || 'Failed to get storage key');
      } finally {
        this.storageBusy = false;
      }
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
            const rest = pk.slice('user:'.length);
            const splitAt = rest.indexOf(':');
            const keyOwner = splitAt >= 0 ? rest.slice(0, splitAt) : this.storageLookupUserId();
            const logicalKey = splitAt >= 0 ? rest.slice(splitAt + 1) : rest;
            const wireKey = this.storageWireKey('user', logicalKey, keyOwner);
            if (wireKey) this.storage?.unsubscribeKey?.('user', wireKey);
            delete next[pk];
            continue;
          }
          if (pk.startsWith(`user:${owner}:`)) {
            const logicalKey = pk.slice(`user:${owner}:`.length);
            const wireKey = this.storageWireKey('user', logicalKey, owner);
            if (wireKey) this.storage?.unsubscribeKey?.('user', wireKey);
            delete next[pk];
          }
        }
      } else {
        const prefix = `${normalizedSpace}:`;
        for (const pk of Object.keys(next)) {
          if (pk.startsWith(prefix)) {
            const logicalKey = pk.slice(prefix.length);
            if (logicalKey) this.storage?.unsubscribeKey?.(normalizedSpace, logicalKey);
            delete next[pk];
          }
        }
      }

      this.storageInterestedKeys = next;
      this.saveUiState();

      if (this.activeTab === 'storage') {
        this.refreshStorageList({ syncInterested: false });
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

    storageRecordText(value) {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    },

    storageOwnerLabel() {
      return 'Modified By';
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

    storagePeerId() {
      return String(this.clientId || this.mesh?.getClientId?.() || '').trim();
    },

    storageModifiedBy(record) {
      let peerId = String(record?.modifiedBy || '').trim();
      const legacyIdentity = String(record?.ownerId || '').trim();
      // Resolve records written before modifiedBy was persisted. Those records
      // stored the modifying crypto identity in ownerId.
      if (!peerId && /^[0-9a-f]{64}$/i.test(legacyIdentity)) {
        peerId = legacyIdentity;
      }
      if (!peerId && legacyIdentity && legacyIdentity === String(this.cryptoKeys?.epub || '').trim()) {
        peerId = this.storagePeerId();
      }
      if (!peerId && legacyIdentity) {
        const match = Object.entries(this.cryptoPublicDirectory || {})
          .find(([, info]) => String(info?.epub || '').trim() === legacyIdentity);
        peerId = String(match?.[0] || '').trim();
      }
      if (!peerId) return '-';
      return `${peerId}${peerId === this.storagePeerId() ? ' (You)' : ''}`;
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
      const peerId = this.storagePeerId();
      const nextIdentity = `js-storage::${this.effectiveSessionId}::${this.storagePeerScopeId}::${userId}::peer:${peerId}::gossip:${gossipAttached}`;
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

      // A browser tab is one peer. Keep its IndexedDB separate from other
      // same-origin tabs so a local write cannot bypass network subscriptions
      // through a shared backing database. The session-scoped ID survives a
      // reload of this tab but is distinct for independently opened peers.
      const dbName = `peerpigeon-storage-v3:${this.effectiveSessionId}:${this.storagePeerScopeId}`;
      this.storage = new PeerPigeonStorage({
        userId,
        peerId,
        gossip: this.gossip || undefined,
        sessionId: this.effectiveSessionId,
        dbName,
      });
      await this.storage.init();
      for (const space of ['public', 'user', 'frozen', 'private', 'epublic']) {
        for (const interest of this.interestedKeysForSpace(space)) {
          const ownerId = space === 'user'
            ? String(interest?.ownerId || this.storageLookupUserId() || '').trim()
            : null;
          const wireKey = this.storageWireKey(space, interest.key, ownerId);
          if (wireKey) this.storage.subscribeKey?.(space, wireKey);
        }
      }
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
      // Listing renders local state only. Network reads happen through Get or
      // through the explicit subscription refresh queue.
      const syncInterested = options && options.syncInterested === true;
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
            modifiedBy: record.modifiedBy ?? null,
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
              modifiedBy: localRecord.modifiedBy ?? null,
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
        this.syncGossipStatus();
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
        this.syncGossipStatus();

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

    handleStorageTableValueScroll(record) {
      this.storageTableScrollingKey = `${record?.space || ''}:${record?.key || ''}`;
      clearTimeout(this.storageTableScrollTimer);
      this.storageTableScrollTimer = setTimeout(() => {
        this.storageTableScrollingKey = '';
        this.storageTableScrollTimer = null;
      }, 650);
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

    onTopologyChange(event) {
      const nextTopology = String(event?.target?.value || this.topology || '').trim();
      if (!this.isKnownTopology(nextTopology)) return;

      if (nextTopology === 'custom' && (this.isRunning || this.isConnecting)) {
        this.customTopologyModalOpen = true;
        this.$nextTick(() => this.$refs.confirmCustomTopologyButton?.focus());
        return;
      }

      const shouldRestart = this.isRunning && !this.isConnecting;
      this.topology = nextTopology;
      if (nextTopology !== 'custom') {
        this.applyTopologyPreset(nextTopology);
      }
      this.updateUrlState();
      if (shouldRestart) {
        this.restartMeshForTopologyChange();
      }
    },

    cancelCustomTopology() {
      this.customTopologyModalOpen = false;
      this.$nextTick(() => {
        if (this.$refs.topologySelect) this.$refs.topologySelect.value = this.topology;
        this.$refs.topologySelect?.focus();
      });
    },

    confirmCustomTopology() {
      this.customTopologyModalOpen = false;
      if (this.isRunning || this.isConnecting) {
        this.stopMesh();
      }
      this.topology = 'custom';
      this.updateUrlState();
      this.$nextTick(() => this.$refs.minPeersInput?.focus());
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
              id: String(event?.id || ''),
              data: event?.data,
              hops: Number(event?.hops || 0),
              sender: String(event?.sender || ''),
              delivery: event?.delivery || null,
              metadata: event?.metadata || {},
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
        onDeliveryProgress: (status) => invokeHandlers('deliveryProgress', status || {}),
        onDeliveryComplete: (status) => invokeHandlers('deliveryComplete', status || {}),
        onDeliveryTimeout: (status) => invokeHandlers('deliveryTimeout', status || {}),
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
        off: (name, fn) => {
          if (!this.goWasmHandlers[name]) return;
          this.goWasmHandlers[name].delete(fn);
        },
        broadcast: (data, metadata, options) => {
          return this.callGoWasm('peerpigeonBroadcast', this.goWasmNodeId, data, metadata || null, options || null);
        },
        broadcastReliable: (data, metadata, options) => {
          return this.callGoWasm('peerpigeonBroadcast', this.goWasmNodeId, data, metadata || null, {
            ...(options || {}),
            trackDelivery: true,
          });
        },
        getDeliveryStatus: (messageId) => {
          return this.callGoWasm('peerpigeonGetDeliveryStatus', this.goWasmNodeId, messageId);
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
          this.goWasmHandlers.deliveryProgress.clear();
          this.goWasmHandlers.deliveryComplete.clear();
          this.goWasmHandlers.deliveryTimeout.clear();
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
        subscribeKey: (space, key) => {
          invoke('peerpigeonStorageSubscribe', this.goWasmNodeId, space, key);
          return () => invoke('peerpigeonStorageUnsubscribe', this.goWasmNodeId, space, key);
        },
        unsubscribeKey: (space, key) => {
          invoke('peerpigeonStorageUnsubscribe', this.goWasmNodeId, space, key);
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
      if (this.isRunning || this.isConnecting) return;
      this.isConnecting = true;
      this.showStatus('Connecting...', 'Preparing PeerPigeon...', 'connecting');
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
        const requestedSignalingServer = String(this.signalingServer || '').trim();
        const automaticSignalingServer = this.usesAutomaticSignalingServer(requestedSignalingServer);
        this.signalingServer = automaticSignalingServer ? 'auto' : requestedSignalingServer;
        let bootstrapSignalingServer = DEFAULT_SIGNALING_SERVERS[0];
        if (!automaticSignalingServer) try {
          const signalingUrl = new URL(requestedSignalingServer);
          const hostname = signalingUrl.hostname.toLowerCase();
          const isLocalDevelopmentHost = hostname === 'localhost'
            || hostname === '::1'
            || hostname.endsWith('.local')
            || /^127\./.test(hostname)
            || /^10\./.test(hostname)
            || /^192\.168\./.test(hostname)
            || /^169\.254\./.test(hostname)
            || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
          if (signalingUrl.protocol === 'https:') signalingUrl.protocol = 'wss:';
          if (signalingUrl.protocol === 'http:') signalingUrl.protocol = isLocalDevelopmentHost ? 'ws:' : 'wss:';
          if (signalingUrl.protocol === 'ws:' && !isLocalDevelopmentHost) signalingUrl.protocol = 'wss:';
          this.signalingServer = signalingUrl.toString();
          bootstrapSignalingServer = this.signalingServer;
        } catch {
          throw new Error(`Invalid signaling server URL: ${this.signalingServer}`);
        }
        this.activeSignalingServer = '';
        this.updateUrlState();
        await this.ensureCryptoKeys();
        if (this.runtimeMode === 'go-wasm') {
          await this.ensureGoWasmRuntimeLoaded();
        }

        this.updateUrlState();

        this.showStatus('Connecting...', 'Initializing PartialMesh with PeerPigeon...', 'connecting');

        this.mesh = new PartialMesh({
          signalingServer: bootstrapSignalingServer,
          signalingServers: automaticSignalingServer ? this.signalingServerOptions : undefined,
          automaticSignalingServer,
          networkId: this.activeNetworkName,
          sessionId: this.activeRoomSessionId,
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

        this.cryptoProtocol = new PeerPigeonCryptoProtocol(this.mesh, this.gossip, {
          roomId: this.effectiveSessionId,
          keyPair: this.cryptoKeys,
          persistKeyPair: false,
          // The demo owns the visible announce cadence; the protocol still
          // handles discovery requests and connection-triggered exchange.
          announceIntervalMs: 0,
        });
        this.cryptoProtocol.on('keyDiscovered', (key) => {
          this.upsertRemoteCryptoInfo(key.peerId, key);
        });
        this.cryptoProtocol.on('encryptedBroadcastReceived', ({ plaintext, message, local, fromPeer }) => {
          if (local) return;
          const sourcePeer = String(fromPeer || message?.sender || 'peer');
          this.messagesSeen++;
          const hopLabel = message.hops === 1 ? 'hop' : 'hops';
          this.addLog('received', `[${message.hops} ${hopLabel}] ${plaintext}`, sourcePeer.slice(0, 6), message.hops, false, {
            icon: 'received',
          });
          if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
        });
        this.cryptoProtocol.on('encryptedDirectReceived', ({ plaintext, message }) => {
          this.messagesSeen++;
          this.addLog('received', `[DM] ${plaintext}`, String(message.from || 'peer'), 0, false, {
            direct: true,
            icon: 'directReceive',
          });
          this.saveUiState();
          if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
        });
        await this.cryptoProtocol.init();

        if (this.activeTab === 'storage') {
          this.ensureStorageReady({ fastPath: true }).catch(() => {
            // best-effort: signaling lifecycle will retry initialization
          });
        }

        // Runtime inspection hook for debugging in dev tools / automation.
        window.__mesh = this.mesh;
        window.__gossip = this.gossip;

        // Mesh events
        this.mesh.on('identity:ready', ({ clientId }) => {
          this.clientId = String(clientId || '').trim();
          this.updateStats();
        });

        this.mesh.on('signaling:connected', (data) => {
          this.signalingConnected = true;
          clearTimeout(this.meshConnectWarnTimer);
          this.meshConnectWarnTimer = null;
          this.activeSignalingServer = String(data?.signalingServer || bootstrapSignalingServer);
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
          this.markNetworkGraphPeerActivity(peerId);
          this.markNetworkGraphPeerActivity(this.mesh?.getClientId?.() || this.clientId);
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
          if (this.runtimeMode === 'go-wasm' && this.goWasmNodeId != null) {
            this.callGoWasm('peerpigeonSetGlobalPeers', this.goWasmNodeId, this.mesh.getGlobalPeers());
          }
          this.updateStats();
        });

        this.mesh.on('mesh:graph', () => {
          this.syncSelfGlowForGraphConnections();
          this.networkGraphRevision += 1;
          this.scheduleNetworkGraphRender({ reason: 'mesh:graph' });
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

        const updateDeliveryReceipt = (deliveryStatus) => {
          this.recordDeliveryReceipt(deliveryStatus);
        };
        this.gossip.on('deliveryProgress', updateDeliveryReceipt);
        this.gossip.on('deliveryComplete', updateDeliveryReceipt);
        this.gossip.on('deliveryTimeout', updateDeliveryReceipt);

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

        this.startSignalingWatchdog();
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
      this.networkGraphKnownEdgeKeys = [];
      clearTimeout(this.meshConnectWarnTimer);
      this.meshConnectWarnTimer = null;
      this.teardownStorage();
      const stoppedMesh = this.mesh;
      const stoppedGossip = this.gossip;
      if (this.cryptoProtocol) {
        this.cryptoProtocol.destroy();
        this.cryptoProtocol = null;
      }
      if (this.mesh) {
        this.mesh.destroy();
        this.mesh = null;
      }
      if (this.gossip) {
        this.gossip.destroy();
        this.gossip = null;
      }
      if (window.__mesh === stoppedMesh) window.__mesh = null;
      if (window.__gossip === stoppedGossip) window.__gossip = null;
      this.isRunning = false;
      this.signalingConnected = false;
      this.messageLog = [];
      this.deliveryReceipts = {};
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
          this.addLog('sent', `[DM→${target.slice(0, 6)}] ${message}`, 'You', 0, true, {
            direct: true,
            icon: 'directSend'
          });
        } else {
          const encryptedBroadcastPayload = await this.buildEncryptedBroadcastPayload(message);
          const messageId = this.gossip.broadcastReliable(encryptedBroadcastPayload, {
            sender: this.clientId,
            timestamp: Date.now(),
            encrypted: true
          }, {
            deliveryTimeoutMs: 30_000
          });

          // Local history should not depend on decrypting our own echo envelope.
          this.messagesSeen++;
          this.addLog('sent', `[0 hops] ${message}`, 'You', 0, true, {
            icon: 'sent',
            messageId
          });
        }

        this.saveUiState();
        if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
      } catch (error) {
        const reason = String(error?.message || error || 'unknown error');
        this.addLog('sent', `Send failed: ${reason}`, 'System', 0, true, { icon: 'warning' });
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
      if (this.cryptoProtocol) {
        this.cryptoProtocol.announcePublicKey();
        return;
      }
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
      if (this.cryptoProtocol) {
        this.cryptoProtocol.requestPeerKey(targetPeerId);
        return;
      }
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
        this.addLog('sent', `[DM→${target.slice(0, 6)}] ${message}`, 'You', 0, true, {
          direct: true,
          icon: 'directSend'
        });
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
      if (this.cryptoProtocol) {
        return await this.cryptoProtocol.encryptRoom(String(plaintext));
      }
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
      if (this.cryptoProtocol) {
        return await this.cryptoProtocol.decryptRoom(roomCipher);
      }
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
      if (this.cryptoProtocol) {
        return await this.cryptoProtocol.createEncryptedBroadcast(String(plaintext));
      }
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
      if (this.cryptoProtocol) {
        return await this.cryptoProtocol.createEncryptedDirect(targetPeerId, String(plaintext));
      }
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
      const payload = normalizeMessagePayload(message?.data);

      if (this.isStorageInternalPayload(payload)) {
        return;
      }

      if (this.isCryptoPublicInfoPayload(payload)) {
        if (this.cryptoProtocol) return;
        const from = String(payload.from || sourcePeer || '').trim();
        if (from) {
          this.upsertRemoteCryptoInfo(from, payload);
        }
        return;
      }

      if (this.isCryptoPublicRequestPayload(payload)) {
        if (this.cryptoProtocol) return;
        const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
        const target = String(payload.to || '').trim();
        const requester = String(payload.from || '').trim();
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

      if (message?.metadata?.internal === true || isInternalMessagePayload(payload)) {
        return;
      }

      if (this.isEncryptedBroadcastPayload(payload)) {
        if (this.cryptoProtocol) return;
        // Sender already logs local broadcast on send(); only decrypt remote deliveries.
        if (local) return;

        let decrypted = null;
        if (payload.roomCipher) {
          decrypted = await this.decryptBroadcastFromRoom(payload.roomCipher);
        } else {
          // Backward compatibility for legacy per-peer broadcast envelopes.
          const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
          const myCipher = payload.recipients?.[self];
          if (!myCipher) return;
          decrypted = await this.decryptCipherText(myCipher);
        }

        this.messagesSeen++;
        const icon = local ? 'sent' : (sourcePeer ? 'received' : 'broadcast');
        const source = local ? 'You' : sourcePeer.slice(0, 6);
        const hopLabel = message.hops === 1 ? 'hop' : 'hops';
        this.addLog(
          local ? 'sent' : 'received',
          `[${message.hops} ${hopLabel}] ${decrypted}`,
          source,
          message.hops,
          local,
          { icon }
        );
        if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
        return;
      }

      // Backward-compatible path for plaintext messages.
      this.messagesSeen++;
      const icon = local ? 'sent' : (sourcePeer ? 'received' : 'broadcast');
      const source = local ? 'You' : sourcePeer.slice(0, 6);
      const hopLabel = message.hops === 1 ? 'hop' : 'hops';
      this.addLog(
        local ? 'sent' : 'received',
        `[${message.hops} ${hopLabel}] ${this.displayPayloadText(payload)}`,
        source,
        message.hops,
        local,
        { icon }
      );
      if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
    },

    async handleDirectPayload(message) {
      const from = String(message.from || 'peer');
      const payload = normalizeMessagePayload(message?.data);

      if (this.isCryptoPublicInfoPayload(payload)) {
        if (this.cryptoProtocol) return;
        const sender = String(payload.from || from || '').trim();
        if (sender) {
          this.upsertRemoteCryptoInfo(sender, payload);
        }
        return;
      }

      if (this.isCryptoPublicRequestPayload(payload)) {
        if (this.cryptoProtocol) return;
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

      if (isInternalMessagePayload(payload)) {
        return;
      }

      if (this.isEncryptedDirectPayload(payload)) {
        if (this.cryptoProtocol) return;
        const decrypted = this.cryptoProtocol
          ? await this.cryptoProtocol.decryptEncryptedDirect(payload)
          : await this.decryptCipherText(payload.cipher);
        this.messagesSeen++;
        this.addLog('received', `[DM] ${decrypted}`, from, 0, false, {
          direct: true,
          icon: 'directReceive'
        });
        this.saveUiState();
        if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
        return;
      }

      // Backward-compatible path for plaintext direct payloads.
      this.messagesSeen++;
      this.addLog('received', `[DM] ${this.displayPayloadText(payload)}`, from, 0, false, {
        direct: true,
        icon: 'directReceive'
      });
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

    markNetworkGraphPeerActivity(peerId) {
      const id = String(peerId || '').trim();
      if (!id) return;
      this.networkGraphActivityByPeer = {
        ...this.networkGraphActivityByPeer,
        [id]: Date.now(),
      };
    },

    syncSelfGlowForGraphConnections() {
      const snapshot = this.mesh?.getGraphSnapshot?.();
      if (!snapshot || !Array.isArray(snapshot.edges)) return;

      const nextEdgeKeys = new Set();
      for (const edge of snapshot.edges) {
        const source = String(edge?.source || '').trim();
        const target = String(edge?.target || '').trim();
        if (!source || !target || source === target) continue;
        nextEdgeKeys.add(source < target ? `${source}\u0000${target}` : `${target}\u0000${source}`);
      }

      const previousEdgeKeys = new Set(this.networkGraphKnownEdgeKeys || []);
      const gainedConnection = Array.from(nextEdgeKeys)
        .some((edgeKey) => !previousEdgeKeys.has(edgeKey));
      this.networkGraphKnownEdgeKeys = Array.from(nextEdgeKeys).sort();

      if (gainedConnection) {
        this.markNetworkGraphPeerActivity(this.mesh?.getClientId?.() || this.clientId);
      }
    },

    networkTolerantPeerIds(connectedPeerIds) {
      const peers = [...new Set((connectedPeerIds || []).map((peerId) => String(peerId || '').trim()).filter(Boolean))];
      const maxPeers = Math.max(0, Math.floor(Number(this.maxPeers) || 0));
      if (!maxPeers || peers.length <= maxPeers) return new Set();

      const overflow = peers.length - maxPeers;
      const sortedPeers = peers.slice().sort((a, b) => a.localeCompare(b));
      return new Set(sortedPeers.slice(-overflow));
    },

    activeMeshPeerIds() {
      const activePeerIds = new Set();
      const addPeer = (peerId) => {
        const id = String(peerId || '').trim();
        if (id) activePeerIds.add(id);
      };

      addPeer(this.mesh?.getClientId?.() || this.clientId);
      for (const peerId of this.connectedPeersList || []) addPeer(peerId);
      for (const peerId of this.discoveredPeersList || []) addPeer(peerId);
      for (const peerId of this.globalPeersList || []) addPeer(peerId);
      return activePeerIds;
    },

    networkGraphHopDistances(localPeerId, peerIds, links) {
      const distances = new Map();
      if (!localPeerId) return distances;
      const adjacency = new Map((peerIds || []).map((peerId) => [peerId, []]));
      for (const link of links || []) {
        const source = String(link?.source || '').trim();
        const target = String(link?.target || '').trim();
        if (!adjacency.has(source) || !adjacency.has(target)) continue;
        adjacency.get(source).push(target);
        adjacency.get(target).push(source);
      }
      distances.set(localPeerId, 0);
      const queue = [localPeerId];
      for (let index = 0; index < queue.length; index += 1) {
        const peerId = queue[index];
        const nextDistance = distances.get(peerId) + 1;
        for (const adjacentPeerId of adjacency.get(peerId) || []) {
          if (distances.has(adjacentPeerId)) continue;
          distances.set(adjacentPeerId, nextDistance);
          queue.push(adjacentPeerId);
        }
      }
      return distances;
    },

    networkGraphDistanceScale(hopDistance, isSelf = false) {
      if (isSelf) return 1;
      const distance = Number(hopDistance);
      if (!Number.isInteger(distance) || distance < 1) return 0.35;
      return Math.max(0.35, Math.min(1, 1 / Math.sqrt(distance)));
    },

    networkGraphData() {
      const localSelf = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
      const publicGraph = this.mesh?.getGraphSnapshot?.();
      if (publicGraph && Array.isArray(publicGraph.nodes) && publicGraph.nodes.length > 0) {
        const localConnectedSet = new Set(
          (this.connectedPeersList || []).map((peerId) => String(peerId || '').trim()).filter(Boolean)
        );
        const tolerantPeerIds = this.networkTolerantPeerIds(this.connectedPeersList || []);
        const nodes = publicGraph.nodes.map((node) => {
          const advertisedHopDistance = node.hopDistance == null ? Number.NaN : Number(node.hopDistance);
          const hopDistance = Number.isInteger(advertisedHopDistance) && advertisedHopDistance >= 0
            ? advertisedHopDistance
            : (node.local ? 0 : (localConnectedSet.has(node.peerId) ? 1 : null));
          return {
            id: node.peerId,
            isSelf: Boolean(node.local),
            isDirect: localConnectedSet.has(node.peerId),
            isDiscovered: Boolean(node.discovered),
            isTolerant: tolerantPeerIds.has(node.peerId),
            hue: this.networkNodeHue(node.peerId),
            capacity: node.capacity,
            hopDistance,
            xorDistance: node.xorDistance,
            xorDistanceRank: node.xorDistanceRank,
            xorDistanceRatio: node.xorDistanceRatio,
            distanceScale: this.networkGraphDistanceScale(hopDistance, Boolean(node.local)),
          };
        });
        const visiblePeerIds = new Set(nodes.map((node) => node.id));
        const links = publicGraph.edges
          .filter((edge) => visiblePeerIds.has(edge.source) && visiblePeerIds.has(edge.target))
          .map((edge) => ({
            source: edge.source,
            target: edge.target,
            direct: Boolean(edge.direct),
          }));
        return { nodes, links };
      }

      const edgeMap = new Map();
      const activePeerIds = this.activeMeshPeerIds();
      const participants = new Set(activePeerIds);

      const snapshots = this.activeMeshPeerSnapshots();
      const localSnapshot = this.localMeshPeerSnapshot();
      const localConnectedSet = new Set((this.connectedPeersList || []).map((peerId) => String(peerId || '').trim()).filter(Boolean));
      const localDiscoveredSet = new Set((this.discoveredPeersList || []).map((peerId) => String(peerId || '').trim()).filter(Boolean));
      if (localSnapshot) {
        snapshots[localSnapshot.peerId] = localSnapshot;
      }

      const tolerantPeerIds = this.networkTolerantPeerIds(this.connectedPeersList || []);

      for (const [sourcePeerId, snapshot] of Object.entries(snapshots)) {
        const source = String(sourcePeerId || '').trim();
        if (!source || !activePeerIds.has(source)) continue;

        const connectedPeers = Array.isArray(snapshot?.connectedPeers) ? snapshot.connectedPeers : [];
        for (const peerId of connectedPeers) {
          const target = String(peerId || '').trim();
          if (!target || target === source || !activePeerIds.has(target)) continue;

          participants.add(source);
          participants.add(target);

          const edgeId = [source, target].sort().join('|');
          const entry = edgeMap.get(edgeId) || {
            source: [source, target].sort()[0],
            target: [source, target].sort()[1],
            direct: false,
          };

          // A solid edge means exactly what the Connected counter means: this
          // browser currently has that peer in its direct WebRTC peer list.
          const localDirectLink = Boolean(localSelf) && (
            (source === localSelf && localConnectedSet.has(target)) ||
            (target === localSelf && localConnectedSet.has(source))
          );
          entry.direct = entry.direct || localDirectLink;
          edgeMap.set(edgeId, entry);
        }
      }

      const links = Array.from(edgeMap.values()).map((entry) => ({
        source: entry.source,
        target: entry.target,
        direct: Boolean(entry.direct),
      }));

      // Render the full merged topology from epublic mesh:peers, not only
      // the local connected component.

      // Always include local self so the graph never disappears when isolated.
      if (localSelf) {
        participants.add(localSelf);
      }

      const nodeIds = [...participants];
      const hopDistances = this.networkGraphHopDistances(localSelf, nodeIds, links);

      const nodes = nodeIds
        .sort((a, b) => a.localeCompare(b))
        .map((peerId) => {
          const isSelf = Boolean(localSelf) && peerId === localSelf;
          const hopDistance = hopDistances.get(peerId) ?? null;
          return {
            id: peerId,
            isSelf,
            isDirect: localConnectedSet.has(peerId),
            isDiscovered: localDiscoveredSet.has(peerId),
            isTolerant: tolerantPeerIds.has(peerId),
            hue: this.networkNodeHue(peerId),
            hopDistance,
            distanceScale: this.networkGraphDistanceScale(hopDistance, isSelf),
          };
        });
      const visiblePeerIds = new Set(nodes.map((node) => node.id));
      const visibleLinks = links.filter(
        (link) => visiblePeerIds.has(link.source) && visiblePeerIds.has(link.target),
      );

      return { nodes, links: visibleLinks };
    },

    networkGraphSignature(nodes, links) {
      const nodeIds = nodes.map((node) => String(node.id || '')).sort();
      const edgeIds = links
        .map((link) => {
          const source = String(typeof link.source === 'object' ? link.source?.id : link.source || '').trim();
          const target = String(typeof link.target === 'object' ? link.target?.id : link.target || '').trim();
          if (!source || !target) return '';
          const mode = link.direct ? 'direct' : 'indirect';
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
        .attr('stroke-opacity', (d) => (d.direct ? 0.95 : 0.5))
        .attr('stroke-dasharray', (d) => (d.direct ? null : '6 4'))
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

    gossipCoverageSnapshot() {
      const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
      const localConnectedPeers = new Set(
        (this.connectedPeersList || []).map((peerId) => String(peerId || '').trim()).filter(Boolean)
      );
      const activePeerIds = this.activeMeshPeerIds();
      const snapshots = this.activeMeshPeerSnapshots();
      const localSnapshot = this.localMeshPeerSnapshot();
      if (localSnapshot) snapshots[localSnapshot.peerId] = localSnapshot;

      const knownPeers = new Set();
      const adjacency = new Map();
      const addPeer = (peerId) => {
        const id = String(peerId || '').trim();
        if (!id) return '';
        knownPeers.add(id);
        if (!adjacency.has(id)) adjacency.set(id, new Set());
        return id;
      };
      const addConnection = (leftPeerId, rightPeerId) => {
        const left = addPeer(leftPeerId);
        const right = addPeer(rightPeerId);
        if (!left || !right || left === right) return;
        adjacency.get(left).add(right);
        adjacency.get(right).add(left);
      };

      for (const peerId of activePeerIds) addPeer(peerId);
      // The local transport is authoritative for every edge incident to self.
      // A remote snapshot may still describe an edge this browser already lost.
      for (const peerId of localConnectedPeers) addConnection(self, peerId);
      for (const [peerId, snapshot] of Object.entries(snapshots)) {
        const source = String(peerId || snapshot?.peerId || '').trim();
        if (!source || !activePeerIds.has(source)) continue;
        for (const target of snapshot?.connectedPeers || []) {
          const normalizedTarget = String(target || '').trim();
          if (!activePeerIds.has(normalizedTarget)) continue;
          // Remote topology cannot resurrect a stale edge to this browser.
          if (source === self || normalizedTarget === self) continue;
          addConnection(source, normalizedTarget);
        }
      }

      if (!self) {
        return { reachablePeers: 0, knownPeers: Math.max(0, knownPeers.size), coverage: 0 };
      }

      const visited = new Set([self]);
      const queue = [self];
      while (queue.length > 0) {
        const peerId = queue.shift();
        for (const neighbor of adjacency.get(peerId) || []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }

      const knownRemotePeers = Math.max(0, knownPeers.size - 1);
      const reachableRemotePeers = Math.max(0, visited.size - 1);
      let reachableEdges = 0;
      for (const peerId of visited) {
        for (const neighbor of adjacency.get(peerId) || []) {
          if (visited.has(neighbor)) reachableEdges++;
        }
      }
      reachableEdges /= 2;

      const reachability = knownRemotePeers > 0 ? reachableRemotePeers / knownRemotePeers : 0;
      // A fully connected tree (including Star) is exactly 100%: every peer is
      // reachable, but there is no redundant gossip route. Extra live edges can
      // raise the score above 100% only when the entire known graph is reachable.
      const coverage = reachability >= 1
        ? Math.max(1, reachableEdges / Math.max(1, knownRemotePeers))
        : reachability;
      return {
        reachablePeers: reachableRemotePeers,
        knownPeers: knownRemotePeers,
        coverage,
      };
    },

    syncGossipStatus() {
      if (!this.isRunning) return;

      if (!this.signalingConnected) {
        this.showStatus('Reconnecting', 'Signaling reconnect in progress...', 'connecting');
        return;
      }

      const coverageSnapshot = this.gossipCoverageSnapshot();
      if ((this.connectedPeersList || []).length === 0) {
        this.showStatus(
          'Gossip Offline',
          `Gossip Offline (0/${coverageSnapshot.knownPeers} reachable; no live connections)`,
          'connecting'
        );
        return;
      }
      const coverage = coverageSnapshot.coverage;
      let quality = 'Poor';
      let statusType = 'connecting';

      if (coverage >= 2) {
        quality = 'Excellent';
        statusType = 'success';
      } else if (coverage >= 1) {
        quality = 'Good';
        statusType = 'success';
      } else if (coverage >= 0.5) {
        quality = 'OK';
        statusType = 'success';
      } else if (coverage >= 0.25) {
        quality = 'Fair';
        statusType = 'info';
      } else if (coverage >= 0.1) {
        quality = 'Degraded';
      }

      this.showStatus(
        `Gossip ${quality}`,
        `Gossip ${quality} (${coverageSnapshot.reachablePeers}/${coverageSnapshot.knownPeers} reachable)`,
        statusType
      );
    },

    recordDeliveryReceipt(status) {
      const messageId = String(status?.messageId || '').trim();
      if (!messageId) return;
      this.deliveryReceipts = {
        ...this.deliveryReceipts,
        [messageId]: {
          ...status,
          deliveredCount: Math.max(0, Number(status?.deliveredCount || 0)),
          audienceCount: Math.max(0, Number(status?.audienceCount || 0)),
          complete: Boolean(status?.complete),
          timedOut: Boolean(status?.timedOut),
        }
      };
    },

    deliveryReceiptLabel(messageId) {
      const status = this.deliveryReceipts[messageId];
      if (!status) return '';
      const count = `${status.deliveredCount}/${status.audienceCount}`;
      if (status.complete) return `Delivered to all (${count})`;
      if (status.timedOut) return `Delivery incomplete (${count})`;
      return `Delivering (${count})`;
    },

    deliveryReceiptClass(messageId) {
      const status = this.deliveryReceipts[messageId];
      if (!status) return '';
      if (status.complete) return 'complete';
      if (status.timedOut) return 'timed-out';
      return 'pending';
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
        system: options.system === true || sender === 'System',
        direct: !!options.direct,
        icon: String(options.icon || ''),
        messageId: String(options.messageId || '')
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

    restartUnexpectedlyStoppedMesh(reason = 'runtime recovery') {
      if (this.unexpectedMeshRestartInFlight || !this.isRunning) return;
      this.unexpectedMeshRestartInFlight = true;
      this.showStatus('Reconnecting', `Mesh stopped during ${reason}; rebuilding now...`, 'connecting');
      this.stopMesh();
      this.$nextTick(() => {
        Promise.resolve(this.startMesh()).finally(() => {
          this.unexpectedMeshRestartInFlight = false;
        });
      });
    },

    startSignalingWatchdog() {
      clearTimeout(this.meshConnectWarnTimer);
      const check = () => {
        this.meshConnectWarnTimer = null;
        if (!this.isRunning || this.signalingConnected) return;

        const adapter = this.mesh?.signalingClient;
        if (!adapter) {
          this.restartUnexpectedlyStoppedMesh('signaling watchdog');
          return;
        }

        this.showStatus(
          'Connecting...',
          `Still waiting on signaling server (${this.activeSignalingServer || this.signalingServer})`,
          'connecting'
        );
        this.addLog('info', '[signal] watchdog: reconnecting and re-announcing', 'freertc');
        try { adapter.connect?.(); } catch { /* FreeRTC will be retried below */ }
        try { adapter.nudgeSignaling?.(); } catch { /* wait for registration */ }
        try { this.mesh?.recoverAfterInactivity?.('signaling-watchdog'); } catch { /* retry later */ }

        this.meshConnectWarnTimer = setTimeout(check, 12_000);
      };
      this.meshConnectWarnTimer = setTimeout(check, 4_000);
    },

    updateUrlState() {
      try {
        const url = new URL(window.location.href);
        // Preserve original query params to avoid disturbing tests or manual URL state
        const originalParams = new URLSearchParams(window.location.search);
        if (!originalParams.has('autostart')) {
          url.searchParams.set('autostart', '1');
        } else {
          url.searchParams.set('autostart', originalParams.get('autostart'));
        }
        
        // Update only the configuration params; preserve any explicitly provided sessionId
        url.searchParams.set('topology', this.topology);
        url.searchParams.set('minPeers', String(this.minPeers));
        url.searchParams.set('maxPeers', String(this.maxPeers));
        url.searchParams.set('tolerantPeers', String(this.tolerantPeers));
        const signalingServer = String(this.signalingServer || '').trim();
        if (signalingServer && signalingServer.toLowerCase() !== 'auto') {
          url.searchParams.set('signalingServer', signalingServer);
        } else {
          url.searchParams.delete('signalingServer');
        }
        url.searchParams.delete('signalUrl');
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
        });

        localStorage.setItem(this.uiStateKey, serialized);
        // Subscriptions belong to this peer/tab, never to every same-origin
        // peer. sessionStorage also preserves them when this tab reloads.
        sessionStorage.setItem(this.storageInterestStateKey(), JSON.stringify(interested));
      } catch {
        // ignore storage failures
      }
    },

    storageInterestStateKey() {
      return `${this.uiStateKey}:storage-interests:${this.effectiveSessionId}`;
    },

    loadUiState() {
      try {
        const raw = localStorage.getItem(this.uiStateKey);
        const parsed = raw ? JSON.parse(raw) : {};
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
        let persistedInterests = null;
        try {
          const rawInterests = sessionStorage.getItem(this.storageInterestStateKey());
          persistedInterests = rawInterests ? JSON.parse(rawInterests) : null;
        } catch {
          persistedInterests = null;
        }
        if (persistedInterests && typeof persistedInterests === 'object') {
          const next = {};
          for (const [pk, enabled] of Object.entries(persistedInterests)) {
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
    clearTimeout(this.storageTableScrollTimer);
    this.storageTableScrollTimer = null;
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
:global(html),
:global(body) {
  width: 100%;
  min-height: 100%;
  margin: 0;
  padding: 0;
}

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
  margin: 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.header-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  margin-bottom: 0.5rem;
}

.header-logo {
  width: 3.25rem;
  height: 3.25rem;
  display: block;
  flex: 0 0 auto;
}

header p {
  color: #666;
  font-size: 1.1rem;
}

main {
  max-width: 1200px;
  margin: 1rem auto 0;
  padding: 0 1rem;
}

main > section:last-child {
  margin-bottom: 0;
}

section {
  background: white;
  border-radius: 12px;
  padding: 1.1rem;
  margin-bottom: 1rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.section-heading {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.section-heading-icon {
  width: 1em;
  color: #667eea;
  flex: 0 0 auto;
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

.storage-space-field .input,
.storage-key-field .input,
.storage-value-field .input {
  box-sizing: border-box;
  height: 2.375rem;
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
  width: 42%;
  max-width: 320px;
}

.storage-value-scroll {
  width: 100%;
  height: 4.5rem;
  min-height: 4.5rem;
  max-height: 4.5rem;
  overflow-x: hidden;
  overflow-y: scroll;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.3;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  scrollbar-gutter: stable;
  overscroll-behavior-y: contain;
}

.storage-value-scroll.is-scrolling {
  scrollbar-color: rgba(71, 85, 105, 0.7) transparent;
}

.storage-value-scroll::-webkit-scrollbar {
  width: 8px;
  height: 0;
}

.storage-value-scroll::-webkit-scrollbar-track,
.storage-value-scroll::-webkit-scrollbar-thumb {
  background: transparent;
}

.storage-value-scroll.is-scrolling::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: rgba(71, 85, 105, 0.7);
  background-clip: padding-box;
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
  width: 1em;
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
  grid-template-columns: minmax(0, 3fr) repeat(3, minmax(0, 1fr));
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
  align-self: stretch;
  justify-content: flex-start;
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

.control-stat-peer-id {
  width: 100%;
  justify-self: stretch;
  align-items: flex-start;
  padding-left: 0.25rem;
  text-align: left;
}

.peer-id-full {
  display: block;
  width: 100%;
  overflow: visible;
  font-size: clamp(0.58rem, 1.05vw, 0.72rem);
  letter-spacing: -0.025em;
  line-height: 1.15;
  text-overflow: clip;
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

.network-graph-container {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  margin: 0 auto;
  max-width: 1040px;
  height: 410px;
  min-height: 410px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 18px;
  box-shadow: 0 24px 55px rgba(38, 20, 88, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  background: linear-gradient(135deg, #151515 0%, #262626 100%);
  overflow: hidden;
}

.network-graph-container::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background:
    radial-gradient(circle at 18% 20%, rgba(255, 255, 255, 0.055), transparent 32%),
    radial-gradient(circle at 84% 78%, rgba(255, 255, 255, 0.035), transparent 35%);
}

.network-graph-gossip-status {
  position: absolute;
  right: 0.8rem;
  bottom: 0.72rem;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  width: max-content;
  max-width: calc(100% - 1.6rem);
  padding: 0.38rem 0.62rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: rgba(9, 9, 9, 0.76);
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.3);
  color: #f8fafc;
  font-size: 0.76rem;
  font-weight: 700;
  line-height: 1.2;
  pointer-events: none;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.network-graph-gossip-icon {
  width: 0.58rem;
  height: 0.58rem;
  flex: 0 0 auto;
  filter: drop-shadow(0 0 4px currentColor);
}

.gossip-state-green .network-graph-gossip-icon {
  color: #4ade80;
}

.gossip-state-yellow .network-graph-gossip-icon {
  color: #facc15;
}

.gossip-state-red .network-graph-gossip-icon {
  color: #f87171;
}

.gossip-state-grey .network-graph-gossip-icon {
  color: #9ca3af;
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
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}

.bubble-icon {
  width: 0.95em;
  flex: 0 0 auto;
  opacity: 0.9;
}

.bubble-delivery {
  margin-top: 0.3rem;
  font-size: 0.7rem;
  font-weight: 700;
  opacity: 0.78;
}

.bubble-delivery.complete {
  color: #d1fae5;
}

.bubble-delivery.timed-out {
  color: #fee2e2;
}

.bubble-hops {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  opacity: 0.7;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(15, 8, 48, 0.66);
  backdrop-filter: blur(5px);
}

.modal-card {
  width: min(100%, 460px);
  padding: 1.25rem;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 8, 48, 0.4);
  color: #1f2937;
}

.modal-card h2 {
  margin: 0 0 0.55rem;
  font-size: 1.2rem;
}

.modal-card p {
  margin: 0;
  color: #4b5563;
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.55rem;
  margin-top: 1rem;
}

/* legacy message log helpers no longer used in chat bubbles */

/* Responsive */
@media (max-width: 768px) {
  header h1 {
    font-size: 1.8rem;
  }

  .header-logo {
    width: 2.5rem;
    height: 2.5rem;
  }

  .message-input {
    flex-direction: column;
  }

  .stats {
    grid-template-columns: 1fr;
  }

  .control-stats-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .control-stat-peer-id {
    grid-column: 1 / -1;
  }

  .peer-id-full {
    font-size: clamp(0.55rem, 1.8vw, 0.68rem);
  }

  .network-graph-container {
    height: 300px;
    min-height: 300px;
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
