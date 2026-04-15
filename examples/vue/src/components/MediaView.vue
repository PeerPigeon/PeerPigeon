<template>
  <div>
    <h2 class="section-title">🎥 Media & Streaming</h2>

    <!-- Device Configuration -->
    <div class="card">
      <h3>🎛️ Media Configuration</h3>
      <div class="form-row">
        <div class="form-group">
          <label><input v-model="enableVideo" type="checkbox" /> Enable Video</label>
        </div>
        <div class="form-group">
          <label><input v-model="enableAudio" type="checkbox" /> Enable Audio</label>
        </div>
      </div>
      <div class="input-group" v-if="cameras.length">
        <label>Camera:</label>
        <select v-model="selectedCamera">
          <option value="">Default</option>
          <option v-for="d in cameras" :key="d.deviceId" :value="d.deviceId">{{ d.label || d.deviceId }}</option>
        </select>
      </div>
      <div class="input-group" v-if="microphones.length">
        <label>Microphone:</label>
        <select v-model="selectedMic">
          <option value="">Default</option>
          <option v-for="d in microphones" :key="d.deviceId" :value="d.deviceId">{{ d.label || d.deviceId }}</option>
        </select>
      </div>
      <div class="button-group">
        <button class="btn secondary" @click="enumerateDevices">🔍 Detect Devices</button>
        <button class="btn primary" :disabled="!store.isConnected || mediaActive" @click="startMedia">▶ Start Media</button>
        <button class="btn danger" :disabled="!mediaActive" @click="stopMedia">⏹ Stop Media</button>
      </div>
      <p v-if="mediaError" class="error-msg">{{ mediaError }}</p>
    </div>

    <!-- Local Stream -->
    <div class="card">
      <h3>📹 Local Stream</h3>
      <div class="video-container">
        <video ref="localVideo" class="video-element" autoplay muted playsinline></video>
        <div v-if="!mediaActive" class="video-overlay">No local stream</div>
      </div>
      <div class="button-group" style="margin-top:8px">
        <button class="btn secondary" :disabled="!mediaActive" @click="toggleVideo">
          {{ videoEnabled ? '📹 Disable Video' : '📷 Enable Video' }}
        </button>
        <button class="btn secondary" :disabled="!mediaActive" @click="toggleAudio">
          {{ audioEnabled ? '🔇 Mute Audio' : '🔊 Unmute Audio' }}
        </button>
      </div>
      <div class="status-info" style="margin-top:8px;font-size:12px;color:#90cdf4">
        <span>Video: {{ videoEnabled ? '✅ On' : '❌ Off' }}</span>
        <span style="margin-left:12px">Audio: {{ audioEnabled ? '✅ On' : '❌ Off' }}</span>
        <span style="margin-left:12px">Status: {{ mediaStatus }}</span>
      </div>
    </div>

    <!-- Remote Streams -->
    <div class="card">
      <h3>📺 Remote Streams ({{ remoteStreams.length }})</h3>
      <p v-if="remoteStreams.length === 0" class="empty-state" style="color:#90cdf4">No remote streams yet</p>
      <div class="video-grid">
        <div v-for="rs in remoteStreams" :key="rs.peerId" class="video-card">
          <div class="video-peer-label">{{ rs.peerId.substring(0,8) }}...</div>
          <video :ref="el => setRemoteVideo(el, rs.peerId)" class="video-element" autoplay playsinline></video>
        </div>
      </div>
    </div>

    <!-- Selective Streaming -->
    <div class="card">
      <h3>🎯 Selective Streaming</h3>
      <p class="description">Stream only to specific peers</p>
      <div class="input-group">
        <label>Target Peers (select multiple):</label>
        <select v-model="selectivePeers" multiple style="height:100px">
          <option v-for="peer in connectedPeers" :key="peer.id" :value="peer.id">
            {{ peer.id.substring(0,8) }}...
          </option>
        </select>
      </div>
      <div class="button-group">
        <button class="btn primary" :disabled="!mediaActive || selectivePeers.length === 0" @click="startSelective">
          🎯 Start Selective Stream
        </button>
        <button class="btn secondary" :disabled="!mediaActive" @click="stopSelective">
          ⏹ Stop Selective
        </button>
        <button class="btn secondary" :disabled="!mediaActive" @click="switchToBroadcast">
          📡 Switch to Broadcast
        </button>
      </div>
      <div class="button-group">
        <button class="btn secondary" :disabled="selectivePeers.length === 0" @click="blockPeers">
          🚫 Block Selected
        </button>
        <button class="btn secondary" :disabled="selectivePeers.length === 0" @click="allowPeers">
          ✅ Allow Selected
        </button>
        <button class="btn secondary" @click="showSelectiveStatus">
          ℹ️ Show Status
        </button>
      </div>
      <div v-if="selectiveStatus" class="status-card">
        <pre>{{ selectiveStatus }}</pre>
      </div>
    </div>

    <!-- Media Log -->
    <div class="card">
      <h3>📋 Media Activity</h3>
      <div class="activity-log">
        <p v-if="mediaLog.length === 0" class="empty-state" style="color:#90cdf4">No media events yet</p>
        <div v-for="(entry, i) in mediaLog" :key="i" class="log-entry info">{{ entry }}</div>
      </div>
      <button class="btn tertiary" @click="mediaLog.length = 0">Clear</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();

const localVideo = ref(null);
const remoteVideoRefs = {};
const enableVideo = ref(true);
const enableAudio = ref(true);
const selectedCamera = ref('');
const selectedMic = ref('');
const cameras = ref([]);
const microphones = ref([]);
const mediaActive = ref(false);
const videoEnabled = ref(true);
const audioEnabled = ref(true);
const mediaStatus = ref('idle');
const mediaError = ref('');
const remoteStreams = ref([]);
const selectivePeers = ref([]);
const selectiveStatus = ref('');
const mediaLog = ref([]);

const connectedPeers = computed(() =>
  Array.from(store.peers.values()).filter(p => p.connected)
);

function ts() { return new Date().toLocaleTimeString(); }
function log(msg) { mediaLog.value.push(`[${ts()}] ${msg}`); }

function setRemoteVideo(el, peerId) {
  if (el) remoteVideoRefs[peerId] = el;
}

const startStreamOnVideoElement = (el, stream) => {
  if (el && stream) el.srcObject = stream;
};

const onLocalStreamStarted = (data) => {
  mediaActive.value = true;
  mediaStatus.value = 'streaming';
  log(`▶ Local stream started — tracks: ${data.stream?.getTracks().length ?? 0}`);
  if (localVideo.value) localVideo.value.srcObject = data.stream;
  store.mediaState.localStream = true;
};

const onLocalStreamStopped = () => {
  mediaActive.value = false;
  mediaStatus.value = 'stopped';
  log('⏹ Local stream stopped');
  if (localVideo.value) localVideo.value.srcObject = null;
  store.mediaState.localStream = false;
};

const onRemoteStream = (data) => {
  const { peerId, stream } = data;
  const existing = remoteStreams.value.find(r => r.peerId === peerId);
  if (!existing) remoteStreams.value.push({ peerId, stream });
  log(`📺 Remote stream from ${peerId.substring(0,8)}...`);
  // Assign stream after DOM updates
  setTimeout(() => {
    const el = remoteVideoRefs[peerId];
    if (el) el.srcObject = stream;
  }, 100);
};

const onRemoteStreamEnded = (data) => {
  const idx = remoteStreams.value.findIndex(r => r.peerId === data.peerId);
  if (idx !== -1) remoteStreams.value.splice(idx, 1);
  log(`📺 Remote stream ended from ${data.peerId?.substring(0,8)}...`);
};

onMounted(() => {
  const m = store.mesh;
  if (!m) return;
  m.addEventListener('localStreamStarted', onLocalStreamStarted);
  m.addEventListener('localStreamStopped', onLocalStreamStopped);
  m.addEventListener('remoteStream', onRemoteStream);
  m.addEventListener('remoteStreamEnded', onRemoteStreamEnded);
});

onUnmounted(() => {
  const m = store.mesh;
  if (!m) return;
  m.removeEventListener('localStreamStarted', onLocalStreamStarted);
  m.removeEventListener('localStreamStopped', onLocalStreamStopped);
  m.removeEventListener('remoteStream', onRemoteStream);
  m.removeEventListener('remoteStreamEnded', onRemoteStreamEnded);
});

const enumerateDevices = async () => {
  const m = store.mesh;
  if (!m) { mediaError.value = 'Not initialized'; return; }
  try {
    const devices = await m.enumerateMediaDevices();
    cameras.value = devices.filter(d => d.kind === 'videoinput');
    microphones.value = devices.filter(d => d.kind === 'audioinput');
    log(`🔍 Found ${cameras.value.length} cameras, ${microphones.value.length} mics`);
  } catch (e) {
    mediaError.value = e.message;
  }
};

const startMedia = async () => {
  mediaError.value = '';
  const m = store.mesh;
  if (!m) { mediaError.value = 'Not initialized'; return; }
  try {
    mediaStatus.value = 'initializing';
    const opts = {
      video: enableVideo.value ? (selectedCamera.value ? { deviceId: selectedCamera.value } : true) : false,
      audio: enableAudio.value ? (selectedMic.value ? { deviceId: selectedMic.value } : true) : false
    };
    await m.startMedia(opts);
    log(`🎥 Starting media stream...`);
  } catch (e) {
    mediaError.value = e.message;
    mediaStatus.value = 'error';
    log(`❌ Media start failed: ${e.message}`);
  }
};

const stopMedia = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    await m.stopMedia();
    log(`⏹ Media stopped`);
  } catch (e) {
    mediaError.value = e.message;
  }
};

const toggleVideo = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    videoEnabled.value = await m.toggleVideo();
    log(`📹 Video ${videoEnabled.value ? 'enabled' : 'disabled'}`);
  } catch (e) {
    mediaError.value = e.message;
  }
};

const toggleAudio = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    audioEnabled.value = await m.toggleAudio();
    log(`🔊 Audio ${audioEnabled.value ? 'unmuted' : 'muted'}`);
  } catch (e) {
    mediaError.value = e.message;
  }
};

const startSelective = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    await m.startSelectiveStream(selectivePeers.value.slice(), { video: enableVideo.value, audio: enableAudio.value });
    log(`🎯 Selective stream started to ${selectivePeers.value.length} peers`);
  } catch (e) {
    mediaError.value = e.message;
  }
};

const stopSelective = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    await m.stopSelectiveStream(false);
    log(`⏹ Selective stream stopped`);
  } catch (e) {
    mediaError.value = e.message;
  }
};

const switchToBroadcast = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    await m.stopSelectiveStream(true);
    log(`📡 Switched to broadcast mode`);
  } catch (e) {
    mediaError.value = e.message;
  }
};

const blockPeers = async () => {
  const m = store.mesh;
  if (!m) return;
  for (const pid of selectivePeers.value) {
    try { await m.blockPeerFromStream(pid); log(`🚫 Blocked ${pid.substring(0,8)}...`); }
    catch (e) { log(`❌ Block failed: ${e.message}`); }
  }
};

const allowPeers = async () => {
  const m = store.mesh;
  if (!m) return;
  for (const pid of selectivePeers.value) {
    try { await m.allowPeerInStream(pid); log(`✅ Allowed ${pid.substring(0,8)}...`); }
    catch (e) { log(`❌ Allow failed: ${e.message}`); }
  }
};

const showSelectiveStatus = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    const s = m.getSelectiveStreamStatus ? m.getSelectiveStreamStatus() : m.mediaManager?.getSelectiveStatus?.();
    selectiveStatus.value = JSON.stringify(s, null, 2);
  } catch (e) {
    selectiveStatus.value = e.message;
  }
};
</script>

<style scoped>
.video-container { position: relative; background: #1a202c; border-radius: 8px; overflow: hidden; aspect-ratio: 16/9; max-width: 640px; }
.video-element { width: 100%; height: 100%; object-fit: cover; }
.video-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #718096; font-size: 14px; }
.video-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.video-card { background: #1a202c; border-radius: 8px; overflow: hidden; }
.video-peer-label { font-size: 11px; color: #90cdf4; padding: 4px 8px; background: rgba(0,0,0,0.5); }
.status-card { background: #1a202c; border-radius: 6px; padding: 10px; margin-top: 8px; }
.status-card pre { color: #90cdf4; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.form-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
.error-msg { color: #c53030; font-size: 12px; margin-top: 4px; }
</style>
