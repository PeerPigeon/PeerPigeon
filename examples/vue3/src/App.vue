<template>
  <div id="app" :data-theme="theme">
    <header class="bar">
      <a class="brand" href="https://github.com/PeerPigeon/PeerPigeon" title="PeerPigeon on GitHub">
        <img src="/pigeonlogo.svg" alt="" class="brand-logo" />
        <span class="brand-name">PeerPigeon</span>
      </a>

      <div class="room" :title="effectiveSessionId">
        <span class="room-label">Room</span>
        <code class="room-name">{{ effectiveSessionId }}</code>
        <button type="button" class="link-btn" data-testid="copy-share-link" @click="copyShareLink">Copy link</button>
      </div>

      <button
        type="button"
        class="link-btn theme-switch"
        :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        :title="theme === 'dark' ? 'Light mode' : 'Dark mode'"
        @click="setTheme(theme === 'dark' ? 'light' : 'dark')"
      ><FontAwesomeIcon :icon="theme === 'dark' ? icons.light : icons.dark" aria-hidden="true" /></button>

      <div class="bar-actions">
        <button
          v-if="isRunning"
          type="button"
          class="link-btn icon-btn"
          data-testid="stop-mesh"
          aria-label="Leave the mesh"
          title="Leave the mesh"
          @click="stopMesh"
        ><FontAwesomeIcon :icon="icons.leave" aria-hidden="true" /></button>
      </div>
    </header>

    <main>
      <!-- Before joining: one settings sheet -->
      <section v-if="!isRunning" class="setup">
        <div class="setup-intro">
          <h1>Start a mesh in your browser</h1>
          <p>
            Join, then open this page in another tab or on another device with the same room.
            The browsers find each other through a relay, connect directly over WebRTC, and
            pass messages along by gossip.
          </p>
        </div>

        <fieldset class="topologies">
          <legend>Topology</legend>
          <label
            v-for="option in topologyOptions"
            :key="option.id"
            class="topology"
            :class="{ chosen: topology === option.id }"
          >
            <input
              type="radio"
              name="topology"
              :value="option.id"
              :checked="topology === option.id"
              :disabled="isConnecting"
              data-testid="topology"
              @change="onTopologyChange"
            />
            <span class="topology-name">{{ option.name }}</span>
            <span class="topology-note">{{ option.note }}</span>
          </label>
        </fieldset>

        <div v-if="topology === 'custom'" class="limits">
          <label class="field">
            <span>Fewest peers</span>
            <input
              ref="minPeersInput"
              v-model.number="minPeers"
              type="number" min="1" max="50"
              :disabled="isConnecting"
              class="input"
              data-testid="min-peers"
              @input="onPeerBoundsInput"
            />
          </label>
          <label class="field">
            <span>Most peers</span>
            <input
              v-model.number="maxPeers"
              type="number" min="1" max="50"
              :disabled="isConnecting"
              class="input"
              data-testid="max-peers"
              @input="onPeerBoundsInput"
            />
          </label>
          <label class="field">
            <span>Spare links</span>
            <input
              v-model.number="tolerantPeers"
              type="number" min="0" max="20"
              :disabled="isConnecting"
              class="input"
              data-testid="tolerant-peers"
              @input="onPeerBoundsInput"
            />
          </label>
        </div>

        <div class="where">
          <label class="field">
            <span>Room</span>
            <input v-model.trim="roomSessionId" :disabled="isConnecting" class="input" data-testid="room-session-id" placeholder="my-room" />
          </label>
          <label class="field">
            <span>Network</span>
            <input v-model.trim="networkName" :disabled="isConnecting" class="input" data-testid="network-name" placeholder="peerpigeon" />
          </label>
          <label class="field field-wide">
            <span>Relay</span>
            <input
              v-model.trim="signalingServer"
              :disabled="isConnecting"
              class="input"
              data-testid="signaling-server"
              list="federated-signaling-servers"
              placeholder="auto"
              :title="activeSignalingServer || 'Automatic federated relay selection'"
            />
            <datalist id="federated-signaling-servers">
              <option value="auto">Automatic</option>
              <option v-for="relayUrl in signalingServerOptions" :key="relayUrl" :value="relayUrl"></option>
            </datalist>
            <small>Leave it on auto and the nearest healthy relay is chosen for you.</small>
          </label>
        </div>

        <div class="setup-go">
          <button
            type="button"
            class="btn btn-go btn-big"
            :disabled="isConnecting"
            data-testid="start-mesh"
            @click="startMesh"
          >{{ isConnecting ? 'Joining…' : 'Join the mesh' }}</button>
          <p
            v-if="status.message && status.message !== 'Idle'"
            class="status-line"
            :class="`status-${status.type}`"
            data-testid="status-message"
          >{{ status.message }}</p>
        </div>
      </section>

      <!-- In the mesh -->
      <section v-else class="live">
        <div
          ref="networkGraphContainer"
          class="stage"
          data-testid="mesh-visualizer"
        >
          <div class="stage-view">
            <PeerNetworkGraph
              ref="peerNetworkGraph"
              :nodes="networkGraphModel.nodes"
              :links="networkGraphModel.links"
              :activity-by-peer="networkGraphActivityByPeer"
              :show-network-status="false"
            />
          </div>
          <div class="stage-top">
            <span
              class="signal"
              :class="`signal-${connectedPeers === 0 ? 0 : combinedNetworkHealth.bars}`"
              :title="combinedNetworkHealth.title"
              :aria-label="combinedNetworkHealth.title"
              role="img"
              data-testid="network-combined-health"
            >
              <i v-for="n in 4" :key="n" :class="{ lit: connectedPeers > 0 && n <= combinedNetworkHealth.bars }"></i>
            </span>
            <span
              class="stage-count"
              :title="`Direct peers: ${networkGraphPeerSummary.direct}; indirect peers: ${networkGraphPeerSummary.indirect}; total peers: ${networkGraphPeerSummary.total}`"
            >
              {{ networkGraphPeerSummary.direct }} direct,
              {{ networkGraphPeerSummary.indirect }} through others,
              {{ networkGraphPeerSummary.total }} in all<template v-if="networkGraphPeerSummary.fading">,
              {{ networkGraphPeerSummary.fading }} gone quiet</template>
            </span>
            <span
              class="stage-gossip"
              :class="`gossip-${networkGossipState}`"
              data-testid="status-message"
              role="status"
              aria-live="polite"
            >{{ networkGraphStatusLabel }}</span>
          </div>
        </div>

        <aside class="side">
          <dl class="facts">
            <div class="fact fact-you">
              <dt>You</dt>
              <dd class="mono" :title="clientId" data-testid="client-id">{{ peerIdDisplay }}</dd>
            </div>
            <div class="fact">
              <dt>Connected</dt>
              <dd data-testid="connected-peers">{{ connectedPeers }} / {{ maxPeers }}</dd>
            </div>
            <div class="fact">
              <dt>Discovered</dt>
              <dd data-testid="discovered-peers">{{ discoveredPeers }}</dd>
            </div>
            <div class="fact">
              <dt>Gossip seen</dt>
              <dd data-testid="messages-seen">{{ messagesSeen }}</dd>
            </div>
          </dl>

          <label class="field side-topology">
            <span>Topology</span>
            <select
              ref="topologySelect"
              :value="topology"
              :disabled="isConnecting"
              class="input"
              data-testid="topology"
              @change="onTopologyChange"
            >
              <option v-for="option in topologyOptions" :key="option.id" :value="option.id">{{ option.name }}</option>
            </select>
          </label>

          <div class="tabs" role="tablist" aria-label="PeerPigeon panels">
            <button
              v-for="tab in uiTabs"
              :key="tab.id"
              type="button"
              role="tab"
              class="tab"
              :aria-selected="activeTab === tab.id"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >{{ tab.label }}</button>
          </div>

          <!-- Messages -->
          <div v-if="activeTab === 'message'" class="panel panel-messages" role="tabpanel" aria-label="Messages">
            <div ref="logContainer" class="thread">
              <p v-if="chatMessages.length === 0" class="empty">
                Nothing yet. Say something and every peer in the room gets it.
              </p>
              <div
                v-for="(entry, idx) in chatMessages"
                :key="idx"
                :class="['msg', entry.type, entryBubbleClass(entry), { local: entry.local }]"
              >
                <div class="msg-meta">
                  <span class="msg-who" :title="entry.local ? '' : messagePeerSha1(entry.sender)">{{ entry.local ? 'You' : formatMessagePeerId(entry.sender) }}</span>
                  <span v-if="entry.direct" class="msg-tag">direct</span>
                  <span class="msg-time">{{ formatTime(entry.timestamp) }}</span>
                </div>
                <div class="msg-text">
                  <FontAwesomeIcon v-if="entry.icon && icons[entry.icon]" :icon="icons[entry.icon]" class="msg-icon" aria-hidden="true" />
                  <span>{{ entry.text }}</span>
                </div>
                <div
                  v-if="entry.messageId && deliveryInferences[entry.messageId]"
                  class="msg-note"
                  :class="deliveryInferenceClass(entry.messageId)"
                >{{ deliveryInferenceLabel(entry.messageId) }}</div>
                <div
                  v-if="entry.type === 'received' && !entry.direct"
                  class="msg-note"
                  :title="formatHopTrace(entry.hopPath, entry.hops)"
                >{{ formatHopLatency(entry.hops, entry.latencyMs) }}</div>
              </div>
            </div>

            <div class="compose">
              <div class="compose-to">
                <label class="check">
                  <input v-model="directMode" type="checkbox" />
                  <span>Only to one peer</span>
                </label>
                <select v-if="directMode" v-model="dmTarget" class="input" data-testid="dm-target">
                  <option value="" disabled>{{ globalPeersList.length ? 'Choose a peer' : 'No peers yet' }}</option>
                  <option v-for="p in globalPeersList" :key="p" :value="p">{{ p.slice(0, 8) }}…</option>
                </select>
              </div>
              <div class="compose-row">
                <input
                  v-model="messageInput"
                  :disabled="!isRunning"
                  :placeholder="directMode ? 'Message one peer' : 'Message everyone'"
                  data-testid="dm-input"
                  class="input"
                  @keyup.enter="sendMessage"
                />
                <button
                  type="button"
                  class="btn btn-go"
                  :disabled="!isRunning || !messageInput.trim() || (directMode && !dmTarget)"
                  data-testid="dm-send"
                  @click="sendMessage"
                >Send</button>
              </div>
              <div class="compose-foot">
                <label class="check"><input v-model="autoScroll" type="checkbox" /><span>Follow new messages</span></label>
                <button type="button" class="link-btn" @click="clearLog">Clear</button>
              </div>
            </div>
          </div>

          <!-- Storage -->
          <div v-else-if="activeTab === 'storage'" class="panel panel-storage" role="tabpanel" aria-label="Storage">
            <p class="note">
              Saved here first. Get a key to fetch it from peers and keep following its changes.
              <span class="storage-state" :class="storageReady ? 'ready' : 'idle'">{{ storageReady ? 'Ready' : 'Waiting for this peer’s keys' }}</span>
            </p>

            <div class="storage-form">
              <label class="field">
                <span>Space</span>
                <select v-model="storageActiveSpace" class="input" @change="refreshStorageList">
                  <option value="user">user</option>
                  <option value="private">private</option>
                  <option value="public">public</option>
                  <option value="frozen">frozen</option>
                  <option value="epublic">epublic (read-only)</option>
                </select>
              </label>
              <label v-if="storageActiveSpace === 'user'" class="field">
                <span>Owner’s public key</span>
                <input v-model="storageLookupOwnerId" class="input" placeholder="Yours, if left blank" @input="refreshStorageList" />
              </label>
              <label class="field" :class="{ 'field-wide': storageActiveSpace === 'user' }">
                <span>Key</span>
                <input v-model="storageFormKey" class="input" placeholder="profile.theme" />
              </label>
              <label class="field field-wide">
                <span>Value</span>
                <input v-model="storageFormValue" class="input" placeholder='{"darkMode": true}' :disabled="storageActiveSpace === 'epublic'" />
              </label>
              <div class="storage-actions">
                <button type="button" class="btn btn-go" :disabled="storageActiveSpace === 'epublic' || !isRunning || !storageReady || storageBusy || !storageFormKey.trim()" @click="saveStorageEntry">Save</button>
                <button type="button" class="btn" :class="{ on: isStorageKeyInterested(storageActiveSpace, storageFormKey) }" :disabled="!storageFormKey.trim() || !isRunning || !storageReady || storageBusy" @click="getStorageKey">Get</button>
                <button type="button" class="btn btn-stop" :disabled="storageActiveSpace === 'epublic' || !isRunning || !storageReady || storageBusy || !storageFormKey.trim()" @click="deleteStorageEntry">Delete</button>
              </div>
            </div>

            <p class="note">{{ storageSpaceDescription }}</p>

            <div v-if="interestedKeysForSpace(storageActiveSpace).length" class="following">
              <span>Following</span>
              <button
                v-for="interest in interestedKeysForSpace(storageActiveSpace)"
                :key="interest.pk"
                type="button"
                class="chip"
                :title="`Stop following ${interest.key}`"
                @click="setStorageKeyInterest(storageActiveSpace, interest.key, false, interest.ownerId)"
              ><span class="mono">{{ interest.key }}</span> <span aria-hidden="true">×</span></button>
              <button type="button" class="link-btn" @click="clearStorageKeyInterestForSpace(storageActiveSpace)">Stop all</button>
            </div>

            <p v-if="storageError" class="error">{{ storageError }}</p>

            <div class="table-wrap">
              <table class="records">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                    <th>{{ storageOwnerLabel() }}</th>
                    <th>Version</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="storageRecords.length === 0">
                    <td colspan="5" class="empty">Nothing saved in {{ storageActiveSpace }} yet.</td>
                  </tr>
                  <tr v-for="record in storageRecords" :key="`${record.space}:${record.key}`" @click="selectStorageRecord(record)">
                    <td class="mono">{{ record.key }}</td>
                    <td class="mono">
                      <div
                        class="cell-scroll"
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

          <!-- Keys -->
          <div v-else-if="activeTab === 'crypto'" class="panel panel-keys" role="tabpanel" aria-label="Keys">
            <p class="note">Messages to everyone are encrypted for the room. Messages to one peer are sealed with that peer’s public key.</p>

            <h3>Yours to share</h3>
            <dl class="keys">
              <dt>Peer ID</dt>
              <dd class="mono">{{ clientId || (isRunning ? 'Reconnecting…' : 'Not connected') }}</dd>
              <dt>Signing key</dt>
              <dd class="mono">{{ localPublicCryptoInfo?.pub || 'Loading…' }}</dd>
              <dt>Encryption key</dt>
              <dd class="mono">{{ localPublicCryptoInfo?.epub || 'Loading…' }}</dd>
            </dl>

            <div class="keys-head">
              <h3>Keep private</h3>
              <button type="button" class="link-btn" :aria-pressed="showPrivateCrypto" @click="showPrivateCrypto = !showPrivateCrypto">
                {{ showPrivateCrypto ? 'Hide' : 'Show' }}
              </button>
            </div>
            <dl class="keys">
              <dt>Signing key</dt>
              <dd class="mono">{{ showPrivateCrypto ? (localPrivateCryptoInfo?.priv || 'Loading…') : maskSecret(localPrivateCryptoInfo?.priv) }}</dd>
              <dt>Encryption key</dt>
              <dd class="mono">{{ showPrivateCrypto ? (localPrivateCryptoInfo?.epriv || 'Loading…') : maskSecret(localPrivateCryptoInfo?.epriv) }}</dd>
            </dl>

            <h3>Other peers</h3>
            <p v-if="remoteCryptoPeers.length === 0" class="empty">No other peer has shared its keys yet.</p>
            <dl v-else class="keys">
              <template v-for="([peerId, info], idx) in remoteCryptoPeers" :key="`${peerId}-${idx}`">
                <dt class="mono">{{ peerId.slice(0, 8) }}…</dt>
                <dd class="mono">{{ info.pub }}<br />{{ info.epub }}</dd>
              </template>
            </dl>
          </div>
        </aside>

        <details class="diagnostics" open>
          <summary>
            <span class="diagnostics-title">Diagnostics</span>
            <span class="diagnostics-count">{{ diagnosticMessages.length }} lines</span>
          </summary>
          <div class="diagnostics-filters">
            <label class="check">
              <input v-model="chatLoggingEnabled" type="checkbox" data-testid="chat-logging-enabled" />
              <span>Record messages</span>
            </label>
            <label class="check">
              <input v-model="diagnosticLoggingEnabled" type="checkbox" data-testid="diagnostic-logging-enabled" />
              <span>Record diagnostics</span>
            </label>
            <label class="field field-inline">
              <span>Detail</span>
              <select v-model.number="diagnosticSyslogLevel" class="input" data-testid="diagnostics-verbosity" aria-label="Diagnostics syslog verbosity">
                <option v-for="level in diagnosticSyslogLevels" :key="level.value" :value="level.value">{{ level.name }} ({{ level.value }})</option>
              </select>
            </label>
            <label class="field field-inline">
              <span>From</span>
              <select v-model="diagnosticSourceFilter" class="input" data-testid="diagnostics-source" aria-label="Diagnostics source filter">
                <option v-for="source in diagnosticSourceFilters" :key="source.value" :value="source.value">{{ source.name }}</option>
              </select>
            </label>
            <input
              v-if="diagnosticSourceFilter === 'custom'"
              v-model="diagnosticCustomSearch"
              class="input"
              data-testid="diagnostics-custom-search"
              type="search"
              placeholder="Search diagnostics"
              aria-label="Search diagnostics"
            />
          </div>
          <div
            ref="diagLogContainer"
            class="log"
            data-testid="diag-log"
            tabindex="0"
            @scroll.passive="handleDiagnosticScroll"
            @wheel.passive="markDiagnosticScrollIntent"
            @touchstart.passive="markDiagnosticScrollIntent"
            @keydown="handleDiagnosticScrollKey"
            @pointerdown="handleDiagnosticPointerDown"
          >
            <div v-for="(entry, idx) in diagnosticMessages" :key="`diag-${idx}`" class="log-line">
              <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
              <span class="log-from">{{ entry.sender }}</span>
              <span class="log-text">{{ entry.text }}<span v-if="entry.duplicateCount > 1" class="log-repeat" :aria-label="`${entry.duplicateCount} occurrences`"> ×{{ entry.duplicateCount }}</span></span>
            </div>
            <p v-if="diagnosticMessages.length === 0" class="empty">Nothing matches these filters.</p>
          </div>
        </details>
      </section>
    </main>

    <div
      v-if="customTopologyModalOpen"
      class="modal-backdrop"
      @click.self="cancelCustomTopology"
      @keydown.esc="cancelCustomTopology"
    >
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-topology-modal-title"
        aria-describedby="custom-topology-modal-description"
      >
        <h2 id="custom-topology-modal-title">Leave the mesh to set your own limits?</h2>
        <p id="custom-topology-modal-description">
          A custom topology is set before joining. You’ll leave the mesh, set the fewest and
          most peers, then join again.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn" @click="cancelCustomTopology">Stay in the mesh</button>
          <button
            ref="confirmCustomTopologyButton"
            type="button"
            class="btn btn-stop"
            data-testid="confirm-custom-topology"
            @click="confirmCustomTopology"
          >Leave and customize</button>
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
import {
  calculateMessageLatency,
  formatHopLatency,
  formatHopTrace,
  formatMessagePeerId,
  messagePeerSha1,
} from './message-latency.js';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import {
  faCommentDots,
  faCircle,
  faDatabase,
  faDiagramProject,
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
  faWifi,
  faXmark,
  faSun,
  faMoon,
  faRightFromBracket,
} from '@fortawesome/free-solid-svg-icons';
import PeerNetworkGraph from './components/PeerNetworkGraph.vue';
import { canonicalPeerId } from './peer-id.js';
import {
  CHAT_LOG_BUFFER_LIMIT,
  DEFAULT_DIAGNOSTIC_SYSLOG_LEVEL,
  DIAGNOSTIC_LOG_BUFFER_LIMIT,
  DIAGNOSTIC_SOURCE_FILTERS,
  SYSLOG_LEVELS,
  appendBoundedLogEntry,
  collapseDuplicateDiagnosticEntries,
  diagnosticEntryMatchesSource,
  diagnosticEntryVisible,
  inferDiagnosticSyslogLevel,
  normalizeDiagnosticSourceFilter,
  normalizeSyslogLevel,
} from './diagnostic-syslog.js';
import {
  combinedNetworkGossipHealth,
  gossipBadgeState,
  gossipQualityForCoverage,
  graphCoverageSnapshot as calculateGraphCoverageSnapshot,
  graphLiveness,
  graphPeerSummary,
} from './graph-coverage.js';

/** How long the gossip badge holds through losing every link before it says Offline. */
const NO_LINKS_GRACE_MS = 4000;

const APP_ICONS = Object.freeze({
  state: faCircle,
  network: faDiagramProject,
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
  leave: faRightFromBracket,
  light: faSun,
  dark: faMoon,
});

const [wifiIconWidth, wifiIconHeight, , , wifiIconPathData] = faWifi.icon;
const wifiIconPaths = (Array.isArray(wifiIconPathData) ? wifiIconPathData : [wifiIconPathData])
  .map((pathData) => `<path d="${pathData}"/>`)
  .join('');
const FONT_AWESOME_WIFI_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${wifiIconWidth} ${wifiIconHeight}">${wifiIconPaths}</svg>`,
)}")`;
const wifiSlashInset = Math.round(Math.min(wifiIconWidth, wifiIconHeight) * 0.08);
const wifiSlashWidth = Math.round(Math.min(wifiIconWidth, wifiIconHeight) * 0.12);
const FONT_AWESOME_WIFI_OFFLINE_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${wifiIconWidth} ${wifiIconHeight}">${wifiIconPaths}<path d="M ${wifiSlashInset} ${wifiSlashInset} L ${wifiIconWidth - wifiSlashInset} ${wifiIconHeight - wifiSlashInset}" fill="none" stroke="black" stroke-width="${wifiSlashWidth}" stroke-linecap="round"/></svg>`,
)}")`;

const DEFAULT_TOPOLOGY = 'token-ring';
const CRYPTO_PUBLIC_INFO_TYPE = 'pp-crypto-public-info-v1';
const CRYPTO_PUBLIC_REQUEST_TYPE = 'pp-crypto-public-request-v1';
const ENCRYPTED_BROADCAST_TYPE = 'pp-encrypted-broadcast-v1';
const ENCRYPTED_DIRECT_TYPE = 'pp-encrypted-direct-v1';
const STORAGE_SYNC_ENVELOPE_TYPE = 'pp-storage-sync-v1';
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
      // True for a moment after the last link drops; see gossipBadgeSnapshot.
      noLinksHeld: false,
      // Dark unless this browser chose light (Light / Dark in the top bar).
      theme: (() => {
        try { return localStorage.getItem('peerpigeon:theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
      })(),
      mesh: null,
      icons: APP_ICONS,
      wifiIconMask: FONT_AWESOME_WIFI_MASK,
      wifiOfflineIconMask: FONT_AWESOME_WIFI_OFFLINE_MASK,
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
      chatLogBuffer: [],
      diagnosticLogBuffer: [],
      chatLoggingEnabled: true,
      diagnosticLoggingEnabled: true,
      diagnosticSyslogLevel: DEFAULT_DIAGNOSTIC_SYSLOG_LEVEL,
      diagnosticSyslogLevels: SYSLOG_LEVELS,
      diagnosticSourceFilter: 'all',
      diagnosticSourceFilters: DIAGNOSTIC_SOURCE_FILTERS,
      diagnosticCustomSearch: '',
      diagnosticAutoScroll: true,
      diagnosticScrollIntentUntil: 0,
      diagnosticScrollFrame: null,
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
      uiStateKey: 'peerpigeon:ui-state',
      uiTabs: [
        { id: 'message', label: 'Messages' },
        { id: 'storage', label: 'Storage' },
        { id: 'crypto', label: 'Keys' }
      ],
      topologyOptions: [
        { id: 'token-ring', name: 'Ring', note: 'Each peer links to two neighbors, with one spare.' },
        { id: 'star', name: 'Star', note: 'One to twenty links per peer; a few peers become hubs.' },
        { id: 'partial-mesh', name: 'Partial mesh', note: 'Two to five links per peer.' },
        { id: 'dense-mesh', name: 'Dense mesh', note: 'Three to ten links per peer: more paths, more traffic.' },
        { id: 'custom', name: 'Custom', note: 'Set the fewest and most peers yourself.' }
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
      networkGraphBadgeScrollHandler: null,
      networkGraphBadgeScrollFrame: null,
      networkGraphBadgesPinned: false,
      browserSuspended: false,
      pageLifecycleFreezeHandler: null,
      pageLifecycleResumeHandler: null,
      pageLifecycleVisibilityHandler: null,
      pageLifecyclePageHideHandler: null,
      debugMonitorTimer: null,
      debugLastByPeer: {},
      debugLastLogAtByPeer: {},
      unexpectedMeshRestartInFlight: false,
      // Constant-size topology estimates plus reverse subtree aggregates.
      // No sender-side peer list or per-peer delivery bitset is retained.
      deliveryInferences: {},
    };
  },
  mounted() {
    window.__app = this;
    this.setTheme(this.theme);
    const params = new URLSearchParams(window.location.search);

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
      this.scheduleNetworkGraphBadgePinUpdate();
    };
    window.addEventListener('resize', this.networkGraphResizeHandler);
    this.networkGraphBadgeScrollHandler = () => this.scheduleNetworkGraphBadgePinUpdate();
    window.addEventListener('scroll', this.networkGraphBadgeScrollHandler, { passive: true });
    this.$nextTick(() => this.scheduleNetworkGraphBadgePinUpdate());
    this.pageLifecycleFreezeHandler = () => {
      this.browserSuspended = true;
      this.syncGossipStatus();
    };
    this.pageLifecycleResumeHandler = (event) => {
      const wasSuspended = this.browserSuspended;
      this.browserSuspended = false;
      if (!this.isRunning) return;

      // Safari can resume a page without first dispatching `freeze`, and it can
      // discard a suspended requestAnimationFrame callback. Recovery therefore
      // follows every foreground signal directly; it must never depend on a
      // subsequent pointer move causing Vue or the canvas to repaint.
      const lifecycleReason = String(event?.type || 'resume').trim() || 'resume';
      if (wasSuspended) {
        this.showStatus('Reconnecting', 'Browser resumed; restoring peer connections...', 'connecting');
      }
      try {
        this.mesh?.recoverAfterInactivity?.(`app-${lifecycleReason}`);
      } catch {
        // Transport maintenance remains available as a fallback.
      }
      this.updateStats();
      this.networkGraphRevision += 1;
      this.$nextTick(() => this.$refs.peerNetworkGraph?.restartAnimationLoop?.());
    };
    this.pageLifecycleVisibilityHandler = (event) => {
      if (document.hidden) {
        this.pageLifecycleFreezeHandler?.();
        return;
      }
      this.pageLifecycleResumeHandler?.(event);
    };
    this.pageLifecyclePageHideHandler = (event) => {
      if (!event?.persisted) return;
      this.pageLifecycleFreezeHandler?.();
    };
    document.addEventListener('freeze', this.pageLifecycleFreezeHandler);
    document.addEventListener('resume', this.pageLifecycleResumeHandler);
    document.addEventListener('visibilitychange', this.pageLifecycleVisibilityHandler);
    window.addEventListener('pageshow', this.pageLifecycleResumeHandler);
    window.addEventListener('focus', this.pageLifecycleResumeHandler);
    window.addEventListener('online', this.pageLifecycleResumeHandler);
    window.addEventListener('pagehide', this.pageLifecyclePageHideHandler);
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
    this.scheduleNetworkGraphBadgePinUpdate();
  },
  computed: {
    gossipBadgeSnapshot() {
      const badge = gossipBadgeState({
        running: this.isRunning,
        suspended: this.browserSuspended,
        connectedPeerCount: this.connectedPeersList.length,
        coverageSnapshot: this.gossipCoverageSnapshot(),
      });
      // Losing every link for a moment is normal when neighbours leave
      // together (the end of a stress test); a link to a live peer follows
      // within a second. Show the last live badge through that blip, and
      // Offline only if no link comes back within NO_LINKS_GRACE_MS.
      if (badge.label !== 'Offline') {
        this.lastLiveGossipBadge = badge;
        return badge;
      }
      if (this.noLinksHeld && this.lastLiveGossipBadge) return this.lastLiveGossipBadge;
      return badge;
    },

    networkGraphStatusLabel() {
      const badge = this.gossipBadgeSnapshot;
      return `Gossip ${badge.label} (${badge.reachablePeers}/${badge.knownPeers})`;
    },

    networkGossipState() {
      return this.gossipBadgeSnapshot.state;
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

    networkGraphPeerSummary() {
      return graphPeerSummary(this.networkGraphModel, { relayListed: this.relayListedPeers() });
    },

    combinedNetworkHealth() {
      return combinedNetworkGossipHealth(
        this.networkGraphPeerSummary,
        this.gossipCoverageSnapshot(this.networkGraphModel),
        this.browserSuspended,
      );
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
      return this.chatLogBuffer.filter(e => (
        (e.type === 'sent' || e.type === 'received') &&
        !e.system &&
        !isInternalChatText(e.text)
      ));
    },
    messageLog() {
      return [...this.chatLogBuffer, ...this.diagnosticLogBuffer]
        .sort((left, right) => Number(left?.timestamp || 0) - Number(right?.timestamp || 0));
    },
    diagnosticMessages() {
      const visibleEntries = this.diagnosticLogBuffer.filter((entry) => {
        const diagnostic = (entry.type !== 'sent' && entry.type !== 'received') || entry.system;
        return diagnostic
          && diagnosticEntryVisible(entry, this.diagnosticSyslogLevel)
          && diagnosticEntryMatchesSource(
            entry,
            this.diagnosticSourceFilter,
            this.diagnosticCustomSearch,
          );
      });
      return this.diagnosticSourceFilter === 'duplicate'
        ? collapseDuplicateDiagnosticEntries(visibleEntries)
        : visibleEntries;
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
    'connectedPeersList.length'(count, previous) {
      clearTimeout(this.noLinksHoldTimer);
      if (count === 0 && previous > 0 && this.isRunning) {
        this.noLinksHeld = true;
        this.noLinksHoldTimer = setTimeout(() => { this.noLinksHeld = false; }, NO_LINKS_GRACE_MS);
      } else {
        this.noLinksHeld = false;
      }
    },
    isRunning(running) {
      this.$nextTick(() => this.scheduleNetworkGraphBadgePinUpdate());
      if (running) this.scheduleDiagnosticScroll();
    },
    diagnosticSyslogLevel() {
      this.saveUiState();
      this.scheduleDiagnosticScroll();
    },
    diagnosticSourceFilter() {
      this.saveUiState();
      this.scheduleDiagnosticScroll();
    },
    diagnosticCustomSearch() {
      this.saveUiState();
      this.scheduleDiagnosticScroll();
    },
    chatLoggingEnabled() {
      this.saveUiState();
    },
    diagnosticLoggingEnabled() {
      this.saveUiState();
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
    setTheme(theme) {
      this.theme = theme === 'light' ? 'light' : 'dark';
      // The page behind the app (overscroll, the browser chrome) follows too.
      document.documentElement.dataset.theme = this.theme;
      document.documentElement.style.colorScheme = this.theme;
      try { localStorage.setItem('peerpigeon:theme', this.theme); } catch { /* private mode: not remembered */ }
    },

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
      this.storageChangeUnsubscribe = this.storage.subscribe(() => {
        if (this.activeTab === 'storage') {
          this.refreshStorageList({ silent: true });
        }
      });

      this.storageReady = true;
      this.storageError = '';
      // Local-first: render from IndexedDB immediately.
      await this.refreshStorageList({ silent: true, syncInterested: false });

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
          // Fallback watchdog for environments that never surface transport
          // failure events; initial and replacement dials are still immediate.
          underConnectedResetMs: 20_000
        });

        this.gossip = new GossipProtocol(this.mesh);

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
        this.cryptoProtocol.on('encryptedBroadcastReceived', ({ plaintext, message, local, fromPeer, receivedAt: gossipReceivedAt }) => {
          if (local) return;
          const receivedAt = Number.isFinite(gossipReceivedAt) && Number(gossipReceivedAt) > 0
            ? Number(gossipReceivedAt)
            : Date.now();
          const sourcePeer = String(fromPeer || message?.sender || 'peer');
          this.messagesSeen++;
          this.addLog('received', plaintext, sourcePeer, message.hops, false, {
            icon: 'received',
            receivedAt,
            latencyMs: calculateMessageLatency(message?.timestamp ?? message?.data?.timestamp, receivedAt),
            hopPath: message?.path,
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
          this.addLog('connected', `Connected to peer`, peerId);
          this.markNetworkGraphPeerActivity(peerId);
          this.markNetworkGraphPeerActivity(this.mesh?.getClientId?.() || this.clientId);
          this.announceCryptoPublicInfo();
          this.requestInterestedKeySync('peer-connected');
          this.updateStats();
        });

        this.mesh.on('peer:disconnected', (peerId) => {
          this.addLog('disconnected', `Disconnected from peer`, peerId);
          this.updateStats();
        });

        this.mesh.on('peer:error', ({ peerId, error }) => {
          const message = String(error?.message || error || 'unknown error');
          this.addLog('info', `Peer error: ${message}`, peerId || 'peer');
          this.updateStats();
        });

        this.mesh.on('peer:discovered', (peerId) => {
          this.addLog('info', 'Dial eligible -> immediate offer', peerId || 'debug');
        });

        this.mesh.on('mesh:membership', () => {
          this.refreshDeliveryInferences();
          this.updateStats();
        });

        this.mesh.on('mesh:graph', () => {
          this.syncSelfGlowForGraphConnections();
          this.networkGraphRevision += 1;
          this.refreshDeliveryInferences();
          this.syncGossipStatus();
          this.scheduleNetworkGraphRender({ reason: 'mesh:graph' });
        });

        this.mesh.on('mesh:ready', () => {
          this.addLog('info', 'Gossip reached ready state', 'System');
          this.requestInterestedKeySync('mesh-ready');
        });

        // Gossip events
        this.gossip.on('messageReceived', ({ message, local, fromPeer, receivedAt }) => {
          this.handleGossipPayload({ message, local, fromPeer, receivedAt }).catch((error) => {
            this.addLog('info', `Failed to process gossip payload: ${String(error?.message || error || '')}`, 'crypto');
          });
        });
        const updateAggregateDelivery = (status) => {
          this.recordAggregateDelivery(status);
        };
        this.gossip.on('aggregateProgress', updateAggregateDelivery);
        this.gossip.on('aggregateSettled', updateAggregateDelivery);
        this.gossip.on('cecrStateChanged', () => {
          this.refreshDeliveryInferences();
          this.syncGossipStatus();
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
      this.chatLogBuffer = [];
      this.diagnosticLogBuffer = [];
      this.deliveryInferences = {};
      this.dmTarget = '';
      this.directMode = false;
      this.connectedPeersList = [];
      this.discoveredPeersList = [];
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
            this.addLog('info', `Queued DM for ${formatMessagePeerId(target)} until its direct key arrives`, 'crypto');
            return;
          }

          const encryptedDirectPayload = await this.buildEncryptedDirectPayload(target, message);
          const id = this.gossip.sendDirect(target, encryptedDirectPayload);
          if (!id) {
            this.addLog('info', 'Direct message failed: local peer ID is not ready yet', 'System');
            return;
          }

          this.messagesSeen++;
          this.addLog('sent', `[DM→${formatMessagePeerId(target)}] ${message}`, 'You', 0, true, {
            direct: true,
            icon: 'directSend'
          });
        } else {
          const encryptedBroadcastPayload = await this.buildEncryptedBroadcastPayload(message);
          const messageId = this.gossip.broadcast(encryptedBroadcastPayload, {
            sender: this.clientId,
            timestamp: Date.now(),
            encrypted: true
          }, {
            aggregateDelivery: true,
            deliveryTimeoutMs: 30_000,
          });
          this.recordDeliveryInference(messageId);

          // Local history should not depend on decrypting our own echo envelope.
          this.messagesSeen++;
          this.addLog('sent', message, 'You', 0, true, {
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
        this.addLog('sent', `[DM→${formatMessagePeerId(target)}] ${message}`, 'You', 0, true, {
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

    async handleGossipPayload({ message, local, fromPeer, receivedAt: gossipReceivedAt }) {
      const receivedAt = Number.isFinite(gossipReceivedAt) && Number(gossipReceivedAt) > 0
        ? Number(gossipReceivedAt)
        : Date.now();
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
        const source = local ? 'You' : sourcePeer;
        this.addLog(
          local ? 'sent' : 'received',
          decrypted,
          source,
          message.hops,
          local,
          {
            icon,
            receivedAt,
            latencyMs: calculateMessageLatency(message?.timestamp ?? payload?.timestamp, receivedAt),
            hopPath: message?.path,
          }
        );
        if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
        return;
      }

      // Backward-compatible path for plaintext messages.
      this.messagesSeen++;
      const icon = local ? 'sent' : (sourcePeer ? 'received' : 'broadcast');
      const source = local ? 'You' : sourcePeer;
      this.addLog(
        local ? 'sent' : 'received',
        this.displayPayloadText(payload),
        source,
        message.hops,
        local,
        {
          icon,
          receivedAt,
          latencyMs: calculateMessageLatency(message?.timestamp ?? payload?.timestamp, receivedAt),
          hopPath: message?.path,
        }
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
        // Signaling discovery is only a dial hint. All visible membership,
        // graph nodes, and user-facing peer totals use CECR membership.
        const cecrPeers = this.mesh.getGlobalPeers ? this.mesh.getGlobalPeers() : [];
        this.discoveredPeersList = [...new Set(cecrPeers)];
        const self = meshClientId;
        this.globalPeersList = [...new Set([
          ...cecrPeers,
          ...this.connectedPeersList,
        ])].filter(p => p && p !== self);

        // Keep DM target valid as the membership view converges.
        if (!this.globalPeersList.includes(this.dmTarget) || this.dmTarget === self) {
          this.dmTarget = this.globalPeersList[0] || '';
        }

        this.saveUiState();
      }

      this.syncGossipStatus();
    },

    scheduleNetworkGraphBadgePinUpdate() {
      if (this.networkGraphBadgeScrollFrame != null) return;
      this.networkGraphBadgeScrollFrame = window.requestAnimationFrame(() => {
        this.networkGraphBadgeScrollFrame = null;
        this.updateNetworkGraphBadgePinning();
      });
    },

    updateNetworkGraphBadgePinning() {
      const graph = this.$refs.networkGraphContainer;
      const shouldPin = Boolean(this.isRunning && graph && graph.getBoundingClientRect().top < 0);
      if (this.networkGraphBadgesPinned !== shouldPin) {
        this.networkGraphBadgesPinned = shouldPin;
      }
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
            observedBy: Array.isArray(edge.observedBy) ? edge.observedBy : [],
          }));
        // Peers still on their lease but with no live links fade out and are
        // left out of every count (see graphLiveness).
        const { fading } = graphLiveness({ nodes, links }, localSelf, { relayListed: this.relayListedPeers() });
        for (const node of nodes) node.isFading = fading.has(node.id);
        return { nodes, links };
      }

      return { nodes: [], links: [] };
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

    gossipCoverageSnapshot(graph = this.networkGraphModel) {
      // Live peers only. The CECR network-size estimate is not used here: it is
      // a high-water mark that keeps counting a departed peer for a while.
      const self = String(this.mesh?.getClientId?.() || this.clientId || '').trim();
      return calculateGraphCoverageSnapshot(graph, self, 0, { relayListed: this.relayListedPeers() });
    },

    /** The relay's current peer list, or null while we are off the relay (an idle list is stale). */
    relayListedPeers() {
      const client = this.mesh?.signalingClient;
      if (!client?.isConnected?.() || client?.client?.relayIdle === true) return null;
      return this.mesh?.getActiveSignalingPeers?.() ?? null;
    },

    syncGossipStatus() {
      if (!this.isRunning) return;

      if (this.browserSuspended) {
        this.showStatus('Suspended', 'Suspended (browser paused this peer)', 'info');
        return;
      }

      if (!this.signalingConnected) {
        this.showStatus('Reconnecting', 'Signaling reconnect in progress...', 'connecting');
        return;
      }

      const coverageSnapshot = this.gossipCoverageSnapshot();
      if ((this.connectedPeersList || []).length === 0) {
        // Losing every link for a moment is normal when neighbours leave
        // together (the end of a stress test): a link to a live peer follows
        // within a second. Hold the last gossip badge through that blip and
        // only call it offline if no link comes back.
        const now = Date.now();
        if (this.noLinksSince == null) this.noLinksSince = now;
        const heldTitle = String(this.status?.title || '');
        const holding = heldTitle.startsWith('Gossip ') && heldTitle !== 'Gossip Offline';
        if (holding && now - this.noLinksSince < NO_LINKS_GRACE_MS) {
          clearTimeout(this.noLinksTimer);
          this.noLinksTimer = setTimeout(() => this.syncGossipStatus(), NO_LINKS_GRACE_MS - (now - this.noLinksSince) + 50);
          return;
        }
        this.showStatus(
          'Gossip Offline',
          `Gossip Offline (${coverageSnapshot.reachablePeers}/${coverageSnapshot.knownPeers} reachable; no live remote connections)`,
          'connecting'
        );
        return;
      }
      this.noLinksSince = null;
      clearTimeout(this.noLinksTimer);
      const coverage = coverageSnapshot.coverage;
      const { label: quality, statusType } = gossipQualityForCoverage(coverage);

      this.showStatus(
        `Gossip ${quality}`,
        `Gossip ${quality} (${coverageSnapshot.reachablePeers}/${coverageSnapshot.knownPeers} reachable)`,
        statusType
      );
    },

    recordDeliveryInference(rawMessageId) {
      const messageId = String(rawMessageId || '').trim();
      if (!messageId) return;
      const coverage = this.gossipCoverageSnapshot();
      const existing = this.deliveryInferences[messageId] || {};
      this.deliveryInferences = {
        ...this.deliveryInferences,
        [messageId]: {
          ...existing,
          reachablePeers: coverage.reachablePeers,
          knownPeers: Math.max(
            coverage.knownPeers,
            Number(existing.confirmedPeerCount || 0),
            Number(existing.inferredAudienceCount || 0),
          ),
          coverage: coverage.coverage,
          inferredAt: Date.now(),
        }
      };
    },

    recordAggregateDelivery(status) {
      const messageId = String(status?.messageId || '').trim();
      if (!messageId) return;
      const existing = this.deliveryInferences[messageId] || {};
      const confirmedPeerCount = Math.max(0, Number(status?.confirmedPeerCount || 0));
      const inferredAudienceCount = Math.max(
        confirmedPeerCount,
        Number(status?.inferredAudienceCount || 0),
      );
      this.deliveryInferences = {
        ...this.deliveryInferences,
        [messageId]: {
          ...existing,
          confirmedPeerCount,
          inferredAudienceCount,
          knownPeers: Math.max(Number(existing.knownPeers || 0), inferredAudienceCount),
          maxConfirmedHops: Math.max(0, Number(status?.maxConfirmedHops || 0)),
          settled: Boolean(status?.settled),
          aggregateUpdatedAt: Number(status?.updatedAt || Date.now()),
        },
      };
      this.syncGossipStatus();
    },

    refreshDeliveryInferences() {
      const messageIds = Object.keys(this.deliveryInferences || {});
      if (messageIds.length === 0) return;
      const coverage = this.gossipCoverageSnapshot();
      const inferredAt = Date.now();
      this.deliveryInferences = Object.fromEntries(messageIds.map((messageId) => {
        const existing = this.deliveryInferences[messageId] || {};
        const confirmedPeerCount = Math.max(0, Number(existing.confirmedPeerCount || 0));
        const knownPeers = Math.max(
          coverage.knownPeers,
          confirmedPeerCount,
          Number(existing.inferredAudienceCount || 0),
        );
        return [messageId, {
          ...existing,
          reachablePeers: coverage.reachablePeers,
          knownPeers,
          coverage: knownPeers > 0 ? Math.max(coverage.reachablePeers, confirmedPeerCount) / knownPeers : 0,
          inferredAt,
        }];
      }));
    },

    deliveryInferenceLabel(messageId) {
      const status = this.deliveryInferences[messageId];
      if (!status) return '';
      if (Number.isFinite(status.confirmedPeerCount)) {
        const prefix = status.settled ? 'Confirmed reach' : 'Aggregating reach';
        return `${prefix} (${status.confirmedPeerCount}/${status.knownPeers})`;
      }
      return `Inferred reach (${status.reachablePeers}/${status.knownPeers})`;
    },

    deliveryInferenceClass(messageId) {
      const status = this.deliveryInferences[messageId];
      if (!status) return '';
      const representedPeers = Math.max(
        Number(status.reachablePeers || 0),
        Number(status.confirmedPeerCount || 0),
      );
      return status.knownPeers > 0 && representedPeers >= status.knownPeers
        ? 'complete'
        : 'partial';
    },

    entryBubbleClass(entry) {
      if (entry?.direct) {
        return entry.local ? 'dm-me' : 'dm-peer';
      }
      return entry.local ? 'me' : 'peer';
    },

    formatHopLatency,
    formatHopTrace,
    formatMessagePeerId,
    messagePeerSha1,

    addLog(type, text, sender = 'System', hops = 0, local = false, options = {}) {
      const requestedTimestamp = Number(options.receivedAt);
      const latencyMs = Number(options.latencyMs);
      const normalizedHops = type === 'received' && !local && !options.direct
        ? Math.max(1, Math.floor(Number(hops) || 0))
        : Math.max(0, Math.floor(Number(hops) || 0));
      const syslogLevel = normalizeSyslogLevel(
        options.syslogLevel ?? options.severity,
        inferDiagnosticSyslogLevel({ type, text, sender }),
      );
      const entry = {
        type,
        text,
        sender,
        syslogLevel,
        hops: normalizedHops,
        timestamp: new Date(Number.isFinite(requestedTimestamp) && requestedTimestamp > 0 ? requestedTimestamp : Date.now()),
        local,
        system: options.system === true || sender === 'System',
        direct: !!options.direct,
        icon: String(options.icon || ''),
        messageId: String(options.messageId || ''),
        latencyMs: Number.isFinite(latencyMs) && latencyMs >= 0 ? Math.round(latencyMs) : null,
        hopPath: Array.isArray(options.hopPath)
          ? options.hopPath.filter((peerId) => typeof peerId === 'string' && peerId.length > 0)
          : [],
      };

      const chatEntry = (entry.type === 'sent' || entry.type === 'received')
        && !entry.system
        && !isInternalChatText(entry.text);
      const diagnosticEntry = (entry.type !== 'sent' && entry.type !== 'received') || entry.system;

      if (import.meta.env.DEV && type !== 'info') {
        // Mirror all app logs to browser console for rapid debugging.
        // eslint-disable-next-line no-console
        console.log(`[mesh:${type}] ${sender} ${text}`);
      }

      if (chatEntry && this.chatLoggingEnabled) {
        appendBoundedLogEntry(this.chatLogBuffer, entry, CHAT_LOG_BUFFER_LIMIT);
        if (this.autoScroll) this.$nextTick(() => this.scrollToBottom());
      } else if (diagnosticEntry && this.diagnosticLoggingEnabled) {
        appendBoundedLogEntry(this.diagnosticLogBuffer, entry, DIAGNOSTIC_LOG_BUFFER_LIMIT);
        this.scheduleDiagnosticScroll();
      }
    },

    clearLog() {
      this.chatLogBuffer = [];
      this.diagnosticLogBuffer = [];
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
      this.diagnosticAutoScroll = true;
    },

    scheduleDiagnosticScroll() {
      if (!this.diagnosticAutoScroll) return;
      this.$nextTick(() => {
        if (!this.diagnosticAutoScroll) return;
        this.scrollDiagToBottom();
        if (this.diagnosticScrollFrame != null) {
          window.cancelAnimationFrame(this.diagnosticScrollFrame);
        }
        this.diagnosticScrollFrame = window.requestAnimationFrame(() => {
          this.diagnosticScrollFrame = null;
          if (this.diagnosticAutoScroll) this.scrollDiagToBottom();
        });
      });
    },

    markDiagnosticScrollIntent() {
      this.diagnosticScrollIntentUntil = Date.now() + 1000;
    },

    handleDiagnosticScrollKey(event) {
      const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
      if (scrollKeys.has(event?.key)) this.markDiagnosticScrollIntent();
    },

    handleDiagnosticPointerDown(event) {
      const container = event?.currentTarget;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const scrollbarGutter = Math.max(16, container.offsetWidth - container.clientWidth + 4);
      if (event.clientX >= rect.right - scrollbarGutter) {
        this.diagnosticScrollIntentUntil = Date.now() + 5000;
      }
    },

    handleDiagnosticScroll(event) {
      const container = event?.currentTarget || this.$refs.diagLogContainer;
      if (!container) return;
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom <= 8) {
        this.diagnosticAutoScroll = true;
      } else if (Date.now() <= this.diagnosticScrollIntentUntil) {
        this.diagnosticAutoScroll = false;
      }
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
          diagnosticSyslogLevel: normalizeSyslogLevel(this.diagnosticSyslogLevel),
          diagnosticSourceFilter: normalizeDiagnosticSourceFilter(this.diagnosticSourceFilter),
          diagnosticCustomSearch: String(this.diagnosticCustomSearch || ''),
          chatLoggingEnabled: this.chatLoggingEnabled !== false,
          diagnosticLoggingEnabled: this.diagnosticLoggingEnabled !== false,
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
        this.diagnosticSyslogLevel = normalizeSyslogLevel(
          parsed.diagnosticSyslogLevel,
          DEFAULT_DIAGNOSTIC_SYSLOG_LEVEL,
        );
        this.diagnosticSourceFilter = normalizeDiagnosticSourceFilter(parsed.diagnosticSourceFilter);
        if (typeof parsed.diagnosticCustomSearch === 'string') {
          this.diagnosticCustomSearch = parsed.diagnosticCustomSearch;
        }
        if (typeof parsed.chatLoggingEnabled === 'boolean') {
          this.chatLoggingEnabled = parsed.chatLoggingEnabled;
        }
        if (typeof parsed.diagnosticLoggingEnabled === 'boolean') {
          this.diagnosticLoggingEnabled = parsed.diagnosticLoggingEnabled;
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
    clearTimeout(this.noLinksTimer);
    clearTimeout(this.noLinksHoldTimer);
    clearTimeout(this.storageTableScrollTimer);
    this.storageTableScrollTimer = null;
    if (this.diagnosticScrollFrame != null) {
      window.cancelAnimationFrame(this.diagnosticScrollFrame);
      this.diagnosticScrollFrame = null;
    }
    if (this.networkGraphResizeObserver) {
      this.networkGraphResizeObserver.disconnect();
      this.networkGraphResizeObserver = null;
      this.networkGraphResizeObservedElement = null;
    }
    if (this.networkGraphResizeHandler) {
      window.removeEventListener('resize', this.networkGraphResizeHandler);
      this.networkGraphResizeHandler = null;
    }
    if (this.networkGraphBadgeScrollHandler) {
      window.removeEventListener('scroll', this.networkGraphBadgeScrollHandler);
      this.networkGraphBadgeScrollHandler = null;
    }
    if (this.networkGraphBadgeScrollFrame != null) {
      window.cancelAnimationFrame(this.networkGraphBadgeScrollFrame);
      this.networkGraphBadgeScrollFrame = null;
    }
    if (this.pageLifecycleFreezeHandler) {
      document.removeEventListener('freeze', this.pageLifecycleFreezeHandler);
      this.pageLifecycleFreezeHandler = null;
    }
    if (this.pageLifecycleResumeHandler) {
      document.removeEventListener('resume', this.pageLifecycleResumeHandler);
      window.removeEventListener('pageshow', this.pageLifecycleResumeHandler);
      window.removeEventListener('focus', this.pageLifecycleResumeHandler);
      window.removeEventListener('online', this.pageLifecycleResumeHandler);
      this.pageLifecycleResumeHandler = null;
    }
    if (this.pageLifecycleVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.pageLifecycleVisibilityHandler);
      this.pageLifecycleVisibilityHandler = null;
    }
    if (this.pageLifecyclePageHideHandler) {
      window.removeEventListener('pagehide', this.pageLifecyclePageHideHandler);
      this.pageLifecyclePageHideHandler = null;
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
/*
  PeerPigeon, in "Pigeon slate" (shared with chess.peer.ooo).
  Feather greys for the room, slate for structure, and the green sheen of a
  pigeon's neck only for what is live: joining, sending, being connected.
  The one loud thing is the network itself, drawn on a night sky.
*/
#app {
  --paper: #e9ecee;
  --surface: #f6f7f8;
  --ink: #1c2126;
  --ink-2: #56616b;
  --line: #c6ced4;
  --line-strong: #9aa6af;
  --wing: #d6dce0;
  --slate: #6e7f8d;
  --sheen: #2e7d6f;
  --sheen-deep: #24665a;
  --sheen-wash: #d3e6e1;
  --mark: #d6b234;
  --stop: #a8473d;
  --stop-wash: #f1dcd8;
  --night: #1b2228;
  --zebra: rgba(214, 220, 224, 0.35);
  --select-arrow: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%2356616b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  --radius: 6px;
  --font: 'Archivo', system-ui, sans-serif;
  --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  min-height: 100dvh;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

:global(html),
:global(body) {
  margin: 0;
  padding: 0;
  background: #e9ecee;
}

:global(html[data-theme='dark']),
:global(html[data-theme='dark'] body) {
  background: #14191d;
}

/* Night slate: the same feathers after dark. */
#app[data-theme='dark'] {
  --paper: #14191d;
  --surface: #1c2328;
  --ink: #e3e8eb;
  --ink-2: #98a4ad;
  --line: #2b343b;
  --line-strong: #44505a;
  --wing: #252d33;
  --slate: #8796a3;
  --sheen: #3f9c88;
  --sheen-deep: #4fb39f;
  --sheen-wash: #1d3732;
  --mark: #d6b234;
  --stop: #e07a6d;
  --stop-wash: #3a2522;
  --night: #0e1215;
  --zebra: rgba(255, 255, 255, 0.025);
  --select-arrow: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%2398a4ad' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
}

#app[data-theme='dark'] .msg-note.partial {
  color: var(--mark);
}

.link-btn.icon-btn {
  color: var(--ink-2);
  font-size: 1.05rem;
  line-height: 1;
  padding: 0.35rem;
}

.link-btn.icon-btn:hover {
  color: var(--stop);
}

.link-btn.theme-switch {
  margin-left: auto;
  color: var(--ink-2);
  font-size: 1.05rem;
  line-height: 1;
  padding: 0.35rem;
}

.link-btn.theme-switch:hover {
  color: var(--ink);
}

/* The logo is a black bird: on night slate it is drawn white. */
#app[data-theme='dark'] .brand-logo {
  filter: invert(1);
}

#app *,
#app *::before,
#app *::after {
  box-sizing: border-box;
}

#app :is(h1, h2, h3, p, dl, dd, fieldset) {
  margin: 0;
  padding: 0;
}

#app :focus-visible {
  outline: 2px solid var(--sheen);
  outline-offset: 2px;
}

.mono {
  font-family: var(--mono);
  font-size: 0.86em;
}

/* ---------- top bar ---------- */
.bar {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  height: 56px;
  padding: 0 24px;
  border-bottom: 1px solid var(--line);
  background: var(--paper);
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--ink);
  text-decoration: none;
}

.brand-logo {
  width: 30px;
  height: 30px;
}

.brand-name {
  font-weight: 800;
  font-size: 1.15rem;
  letter-spacing: -0.01em;
}

.room {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
  padding-left: 1.25rem;
  border-left: 1px solid var(--line);
}

.room-label {
  color: var(--ink-2);
  font-size: 0.85rem;
}

.link-btn,
.room-name {
  white-space: nowrap;
}

.room-name {
  font-family: var(--mono);
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-actions {
  margin-left: 0.5rem;
}

.bar-actions:empty {
  display: none;
}

/* ---------- controls ---------- */
.btn {
  font: inherit;
  font-weight: 600;
  font-size: 0.9rem;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
}

.btn:hover:not(:disabled) {
  border-color: var(--ink-2);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn.on {
  border-color: var(--sheen);
  background: var(--sheen-wash);
}

.btn-go {
  border-color: var(--sheen);
  background: var(--sheen);
  color: #fff;
}

.btn-go:hover:not(:disabled) {
  border-color: var(--sheen-deep);
  background: var(--sheen-deep);
}

.btn-stop {
  border-color: var(--stop);
  color: var(--stop);
}

.btn-stop:hover:not(:disabled) {
  border-color: var(--stop);
  background: var(--stop-wash);
}

.btn-big {
  padding: 0.75rem 1.4rem;
  font-size: 1rem;
}

.link-btn {
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0;
  border: 0;
  background: none;
  color: var(--sheen);
  cursor: pointer;
}

.link-btn:hover {
  text-decoration: underline;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.field > span {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink-2);
}

.field small {
  color: var(--ink-2);
  font-size: 0.8rem;
}

.field-inline {
  flex-direction: row;
  align-items: center;
  gap: 0.45rem;
}

.input {
  width: 100%;
  font: inherit;
  font-size: 0.92rem;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  padding: 0.45rem 0.6rem;
}

/* One height for every box, select or not: Safari draws its own, shorter select. */
.input {
  height: 2.4rem;
}

select.input {
  -webkit-appearance: none;
  appearance: none;
  padding-right: 2rem;
  background-image: var(--select-arrow);
  background-repeat: no-repeat;
  background-position: right 0.7rem center;
}

.input:focus {
  outline: none;
  border-color: var(--sheen);
  box-shadow: 0 0 0 2px var(--sheen-wash);
}

.input:disabled {
  color: var(--ink-2);
  background-color: var(--paper);
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.88rem;
  cursor: pointer;
}

.check input,
.topology input {
  accent-color: var(--sheen);
}

.empty,
.note {
  color: var(--ink-2);
  font-size: 0.9rem;
}

.error {
  color: var(--stop);
  font-size: 0.9rem;
}

/* ---------- before joining ---------- */
.setup {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-areas:
    'intro intro'
    'topologies where'
    'limits where'
    'go go';
  gap: 1.75rem 3rem;
  max-width: 980px;
  margin: 0 auto;
  padding: 3rem 24px 4rem;
}

.setup-intro {
  grid-area: intro;
  max-width: 62ch;
}

.setup-intro h1 {
  font-size: 2.1rem;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.02em;
  margin-bottom: 0.75rem;
}

.setup-intro p {
  color: var(--ink-2);
  font-size: 1.02rem;
}

.topologies {
  grid-area: topologies;
  border: 0;
  display: flex;
  flex-direction: column;
}

.topologies legend,
.where::before {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink-2);
  padding: 0;
  margin-bottom: 0.4rem;
}

.topology {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas:
    'radio name'
    'radio note';
  column-gap: 0.65rem;
  align-items: baseline;
  padding: 0.6rem 0;
  border-top: 1px solid var(--line);
  cursor: pointer;
}

.topology:last-child {
  border-bottom: 1px solid var(--line);
}

.topology input {
  grid-area: radio;
  margin: 0;
}

.topology-name {
  grid-area: name;
  font-weight: 600;
}

.topology-note {
  grid-area: note;
  color: var(--ink-2);
  font-size: 0.88rem;
}

.topology.chosen .topology-name {
  color: var(--sheen-deep);
}

.limits {
  grid-area: limits;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.where {
  grid-area: where;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-content: start;
  gap: 1rem 0.75rem;
}

.where::before {
  content: 'Where to meet';
  grid-column: 1 / -1;
  margin-bottom: -0.4rem;
}

.field-wide {
  grid-column: 1 / -1;
}

.setup-go {
  grid-area: go;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--line);
}

.status-line {
  font-size: 0.9rem;
  color: var(--ink-2);
}

.status-line.status-error {
  color: var(--stop);
}

/* ---------- in the mesh ---------- */
.live {
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(320px, 30vw, 420px);
  grid-template-areas:
    'stage side'
    'diag diag';
  gap: 24px 28px;
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px;
}

.stage {
  grid-area: stage;
  position: relative;
  min-height: 560px;
  height: calc(100dvh - 56px - 48px);
  max-height: 820px;
  border-radius: 10px;
  background: var(--night);
  overflow: hidden;
}

.stage-view {
  position: absolute;
  inset: 0;
}

.stage-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.85rem;
  pointer-events: none;
}

.stage-gossip {
  margin-left: auto;
  padding-left: 0.9rem;
  position: relative;
}

.stage-gossip::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 7px;
  height: 7px;
  margin-top: -3.5px;
  border-radius: 50%;
  background: #8b949c;
}

.gossip-green::before { background: #5fc4a9; }
.gossip-yellow::before { background: var(--mark); }
.gossip-red::before { background: #e07a6d; }

.signal {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 12px;
  pointer-events: auto;
  cursor: help;
}

.signal i {
  display: block;
  width: 3px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.22);
}

.signal i:nth-child(1) { height: 3px; }
.signal i:nth-child(2) { height: 6px; }
.signal i:nth-child(3) { height: 9px; }
.signal i:nth-child(4) { height: 12px; }

.signal i.lit {
  background: #5fc4a9;
}

.signal-1 i.lit { background: #e07a6d; }
.signal-2 i.lit { background: var(--mark); }

/* side column */
.side {
  grid-area: side;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: calc(100dvh - 56px - 48px);
  min-height: 560px;
  max-height: 820px;
}

.facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.9rem;
  row-gap: 0.75rem;
}

.fact dt {
  font-size: 0.8rem;
  color: var(--ink-2);
}

.fact dd {
  font-size: 1.35rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.fact-you {
  grid-column: 1 / -1;
}

.fact-you dd {
  font-family: var(--mono);
  font-size: 0.82rem;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.side-topology {
  padding: 0.9rem 0;
}

.tabs {
  display: flex;
  gap: 1.25rem;
  border-bottom: 1px solid var(--line);
}

.tab {
  font: inherit;
  font-weight: 600;
  font-size: 0.92rem;
  padding: 0.5rem 0;
  margin-bottom: -1px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--ink-2);
  cursor: pointer;
}

.tab:hover {
  color: var(--ink);
}

.tab.active {
  color: var(--ink);
  border-bottom-color: var(--sheen);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  flex: 1;
  min-height: 0;
  padding-top: 0.85rem;
  overflow-y: auto;
}

/* messages */
.panel-messages {
  overflow: hidden;
}

.thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-right: 0.25rem;
}

.msg {
  max-width: 88%;
  padding: 0.45rem 0.65rem;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--line);
  align-self: flex-start;
}

.msg.local {
  align-self: flex-end;
  background: var(--sheen-wash);
  border-color: transparent;
}

.msg.dm-peer,
.msg.dm-me {
  border-style: dashed;
  border-color: var(--slate);
}

.msg-meta {
  display: flex;
  gap: 0.45rem;
  align-items: baseline;
  font-size: 0.78rem;
  color: var(--ink-2);
}

.msg-who {
  font-weight: 700;
  color: var(--ink);
}

.msg-tag {
  font-style: italic;
}

.msg-time {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.msg-text {
  overflow-wrap: anywhere;
}

.msg-icon {
  margin-right: 0.35rem;
  color: var(--ink-2);
}

.msg-note {
  font-size: 0.76rem;
  color: var(--ink-2);
}

.msg-note.partial {
  color: #8a6a10;
}

.compose {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--line);
}

.compose-to {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.compose-to .input {
  width: auto;
  flex: 1;
}

.compose-row {
  display: flex;
  gap: 0.5rem;
}

/* No focus highlight on the message box */
#app .compose-row .input:focus,
#app .compose-row .input:focus-visible {
  outline: none;
  border-color: var(--line-strong);
  box-shadow: none;
}

.compose-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* storage */
.storage-state {
  margin-left: 0.35rem;
  font-weight: 600;
}

.storage-state.ready {
  color: var(--sheen-deep);
}

.storage-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.65rem;
}

.storage-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 0.5rem;
}

.storage-actions .btn-stop {
  margin-left: auto;
}

.following {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--ink-2);
}

.chip {
  font: inherit;
  font-size: 0.82rem;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
}

.chip:hover {
  border-color: var(--stop);
}

.table-wrap {
  overflow-x: auto;
}

.records {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}

.records th {
  text-align: left;
  font-weight: 600;
  color: var(--ink-2);
  padding: 0.35rem 0.5rem 0.35rem 0;
  border-bottom: 1px solid var(--line-strong);
}

.records td {
  padding: 0.4rem 0.5rem 0.4rem 0;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}

.records tbody tr:hover td {
  background: var(--surface);
  cursor: pointer;
}

.cell-scroll {
  max-width: 14rem;
  max-height: 4.5em;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* keys */
.panel-keys h3 {
  font-size: 0.95rem;
  font-weight: 700;
  margin-top: 0.4rem;
}

.keys-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.keys {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.35rem 0.85rem;
  font-size: 0.85rem;
}

.keys dt {
  color: var(--ink-2);
}

.keys dd {
  overflow-wrap: anywhere;
}

/* diagnostics */
.diagnostics {
  grid-area: diag;
  border-top: 1px solid var(--line);
  padding-top: 0.75rem;
}

.diagnostics summary {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  cursor: pointer;
  list-style: none;
}

.diagnostics summary::-webkit-details-marker {
  display: none;
}

.diagnostics summary::before {
  content: '';
  width: 0;
  height: 0;
  border-left: 5px solid var(--ink-2);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 0.15s;
}

.diagnostics[open] summary::before {
  transform: rotate(90deg);
}

.diagnostics-title {
  font-weight: 700;
}

.diagnostics-count {
  color: var(--ink-2);
  font-size: 0.85rem;
}

.diagnostics-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 1.25rem;
  padding: 0.75rem 0;
}

.diagnostics-filters .input {
  width: auto;
}

.log {
  max-height: 340px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: var(--mono);
  font-size: 0.78rem;
  line-height: 1.5;
  padding: 0.35rem 0;
}

.log-line {
  display: grid;
  grid-template-columns: max-content 8rem minmax(0, 1fr);
  gap: 0.75rem;
  padding: 0.1rem 0.75rem;
}

.log-line:nth-child(even) {
  background: var(--zebra);
}

.log-time,
.log-from {
  color: var(--ink-2);
}

/* Each column keeps to its own width: Safari lets long peer IDs run on into
   the next column unless the grid items may shrink and clip. */
.log-line > span {
  min-width: 0;
}

.log-time,
.log-from {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-text {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.log-repeat {
  color: var(--slate);
  font-weight: 700;
}

.log .empty {
  padding: 0.5rem 0.75rem;
}

/* ---------- dialog ---------- */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(28, 33, 38, 0.42);
}

.modal {
  width: min(100%, 460px);
  padding: 1.5rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 18px 50px rgba(28, 33, 38, 0.25);
}

.modal h2 {
  font-size: 1.15rem;
  margin-bottom: 0.6rem;
}

.modal p {
  color: var(--ink-2);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
}

/* ---------- small screens ---------- */
@media (max-width: 900px) {
  .bar {
    gap: 0.75rem;
    padding: 0 16px;
  }

  .room {
    padding-left: 0.75rem;
  }

  .room-label {
    display: none;
  }

  .setup {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'intro'
      'topologies'
      'limits'
      'where'
      'go';
    padding: 2rem 16px 3rem;
  }

  .setup-intro h1 {
    font-size: 1.7rem;
  }

  .setup-go {
    flex-direction: column;
    align-items: stretch;
  }

  .stage-count {
    display: none;
  }

  .live {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'stage'
      'side'
      'diag';
    padding: 16px;
  }

  .stage {
    height: 62vh;
    min-height: 340px;
  }

  .side {
    height: auto;
    min-height: 0;
    max-height: none;
  }

  .thread {
    max-height: 50vh;
  }

  .log-line {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .log-text {
    grid-column: 1 / -1;
  }
}

@media (max-width: 480px) {
  .brand-name {
    display: none;
  }

  .where,
  .storage-form,
  .limits {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .diagnostics summary::before {
    transition: none;
  }
}
</style>
