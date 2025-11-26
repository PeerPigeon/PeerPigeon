<template>
  <div class="media-view">
    <div class="section-header">
      <h2>🎥 Media Streaming</h2>
      <p>Stream audio and video between peers in real-time using WebRTC</p>
    </div>

    <!-- Media Controls -->
    <div class="media-controls">
      <h3>📹 Local Media Controls</h3>
      
      <div class="controls-grid">
        <div class="control-group">
          <h4>Camera & Microphone</h4>
          <div class="control-buttons">
            <button 
              @click="startVideo"
              :disabled="!isConnected || mediaState.videoEnabled"
              class="btn btn-primary"
            >
              <span class="btn-icon">📹</span>
              Start Video
            </button>
            
            <button 
              @click="startAudio"
              :disabled="!isConnected || mediaState.audioEnabled"
              class="btn btn-primary"
            >
              <span class="btn-icon">🎤</span>
              Start Audio
            </button>
            
            <button 
              @click="startBoth"
              :disabled="!isConnected || (mediaState.audioEnabled && mediaState.videoEnabled)"
              class="btn btn-success"
            >
              <span class="btn-icon">🎬</span>
              Start Both
            </button>
            
            <button 
              @click="stopAllMedia"
              :disabled="!mediaState.localStream"
              class="btn btn-danger"
            >
              <span class="btn-icon">⏹️</span>
              Stop All
            </button>
          </div>
        </div>

        <div class="control-group">
          <h4>Stream Controls</h4>
          <div class="control-buttons">
            <button 
              @click="toggleVideo"
              :disabled="!mediaState.localStream"
              class="btn btn-secondary"
            >
              <span class="btn-icon">{{ mediaState.videoEnabled ? '📹' : '❌' }}</span>
              {{ mediaState.videoEnabled ? 'Disable Video' : 'Enable Video' }}
            </button>
            
            <button 
              @click="toggleAudio"
              :disabled="!mediaState.localStream"
              class="btn btn-secondary"
            >
              <span class="btn-icon">{{ mediaState.audioEnabled ? '🎤' : '🔇' }}</span>
              {{ mediaState.audioEnabled ? 'Mute Audio' : 'Unmute Audio' }}
            </button>
          </div>
        </div>

        <div class="control-group">
          <h4>Device Selection</h4>
          <div class="device-selectors">
            <select v-model="selectedVideoDevice" @change="changeVideoDevice" class="device-select">
              <option value="">Select Camera...</option>
              <option 
                v-for="device in videoDevices" 
                :key="device.deviceId"
                :value="device.deviceId"
              >
                {{ device.label || `Camera ${device.deviceId.slice(0, 8)}...` }}
              </option>
            </select>
            
            <select v-model="selectedAudioDevice" @change="changeAudioDevice" class="device-select">
              <option value="">Select Microphone...</option>
              <option 
                v-for="device in audioDevices" 
                :key="device.deviceId"
                :value="device.deviceId"
              >
                {{ device.label || `Microphone ${device.deviceId.slice(0, 8)}...` }}
              </option>
            </select>
            
            <button @click="refreshDevices" class="btn btn-secondary btn-sm">
              <span class="btn-icon">🔄</span>
              Refresh Devices
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Media Streams Display -->
    <div class="streams-container">
      <!-- Local Stream -->
      <div class="stream-section">
        <h3>📺 Your Stream</h3>
        <div class="local-stream-container">
          <video 
            ref="localVideo"
            autoplay 
            muted 
            playsinline
            class="media-stream local-stream"
            :class="{ active: mediaState.localStream }"
          ></video>
          
          <div class="stream-overlay" v-if="!mediaState.localStream">
            <div class="overlay-content">
              <span class="overlay-icon">📷</span>
              <p>No local stream</p>
              <p class="overlay-meta">Start your camera or microphone to see your stream here</p>
            </div>
          </div>
          
          <div class="stream-info" v-if="mediaState.localStream">
            <div class="stream-stats">
              <span class="stat">
                <span class="stat-icon">📹</span>
                {{ mediaState.videoEnabled ? 'Video ON' : 'Video OFF' }}
              </span>
              <span class="stat">
                <span class="stat-icon">🎤</span>
                {{ mediaState.audioEnabled ? 'Audio ON' : 'Audio OFF' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Remote Streams -->
      <div class="stream-section">
        <h3>📡 Remote Streams ({{ mediaState.remoteStreams.size }})</h3>
        
        <div v-if="mediaState.remoteStreams.size === 0" class="empty-streams">
          <div class="empty-icon">📺</div>
          <p>No remote streams</p>
          <p class="empty-meta">Remote streams from other peers will appear here</p>
        </div>
        
        <div class="remote-streams-grid" v-else>
          <div 
            v-for="[peerId, streamInfo] in mediaState.remoteStreams" 
            :key="peerId"
            class="remote-stream-container"
          >
            <video 
              :ref="el => setRemoteVideoRef(el, peerId)"
              autoplay 
              playsinline
              class="media-stream remote-stream"
            ></video>
            
            <div class="stream-info">
              <div class="peer-info">
                <span class="peer-icon">👤</span>
                {{ peerId.substring(0, 12) }}...
              </div>
              <div class="stream-stats">
                <span class="stream-time">{{ formatDuration(streamInfo.startTime) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Selective Streaming Controls -->
    <div class="media-controls">
      <h3>🎯 Selective Streaming</h3>
      <div class="controls-grid">
        <div class="control-group">
          <h4>Target Peers</h4>
          <div class="device-selectors">
            <select multiple v-model="selectedPeers" class="device-select">
              <option 
                v-for="peer in connectedPeersList" 
                :key="peer.id"
                :value="peer.id"
              >
                {{ peer.id.substring(0, 16) }}...
              </option>
            </select>
            <small class="hint">Hold Cmd/Ctrl to select multiple</small>
          </div>
        </div>
        <div class="control-group">
          <h4>Actions</h4>
          <div class="control-buttons">
            <button 
              @click="startSelective"
              :disabled="!isConnected || selectedPeers.length === 0"
              class="btn btn-primary"
            >
              <span class="btn-icon">🎯</span>
              Start Selective
            </button>
            <button 
              @click="switchToBroadcast"
              :disabled="!mediaState.localStream"
              class="btn btn-secondary"
            >
              <span class="btn-icon">📡</span>
              Switch to Broadcast
            </button>
            <button 
              @click="stopSelective"
              :disabled="!mediaState.localStream"
              class="btn btn-danger"
            >
              <span class="btn-icon">⏹️</span>
              Stop Selective
            </button>
          </div>
        </div>
        <div class="control-group">
          <h4>Block/Allow</h4>
          <div class="control-buttons">
            <button 
              @click="blockSelected"
              :disabled="selectedPeers.length === 0"
              class="btn btn-secondary"
            >
              <span class="btn-icon">🚫</span>
              Block Selected
            </button>
            <button 
              @click="allowSelected"
              :disabled="selectedPeers.length === 0"
              class="btn btn-secondary"
            >
              <span class="btn-icon">✅</span>
              Allow Selected
            </button>
          </div>
        </div>
      </div>

      <div class="streaming-status">
        <strong>Status:</strong>
        <span>{{ isStreamingToAll() ? 'Broadcast' : 'Selective' }}</span>
        <span>• Streaming to: {{ getStreamingPeers().length }}</span>
        <span>• Blocked: {{ getBlockedStreamingPeers().length }}</span>
      </div>
    </div>

    <!-- Media Statistics -->
    <div class="stats-section">
      <h3>📊 Media Statistics</h3>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">📹</div>
          <div class="stat-content">
            <h4>Local Stream</h4>
            <div class="stat-value">{{ mediaState.localStream ? 'Active' : 'Inactive' }}</div>
            <div class="stat-meta">
              Video: {{ mediaState.videoEnabled ? 'ON' : 'OFF' }}, 
              Audio: {{ mediaState.audioEnabled ? 'ON' : 'OFF' }}
            </div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">📡</div>
          <div class="stat-content">
            <h4>Remote Streams</h4>
            <div class="stat-value">{{ mediaState.remoteStreams.size }}</div>
            <div class="stat-meta">Connected peer streams</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">🎛️</div>
          <div class="stat-content">
            <h4>Available Devices</h4>
            <div class="stat-value">{{ totalDevices }}</div>
            <div class="stat-meta">
              {{ videoDevices.length }} cameras, {{ audioDevices.length }} mics
            </div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">🔗</div>
          <div class="stat-content">
            <h4>WebRTC Status</h4>
            <div class="stat-value">{{ webrtcStatus }}</div>
            <div class="stat-meta">Real-time communication</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Advanced Media Features -->
    <div class="advanced-section">
      <h3>🔧 Advanced Media Features</h3>
      
      <div class="advanced-features">
        <div class="feature-group">
          <h4>Stream Quality</h4>
          <div class="quality-controls">
            <label>Video Quality:</label>
            <select v-model="videoQuality" @change="updateVideoQuality" class="quality-select">
              <option value="low">Low (320x240)</option>
              <option value="medium">Medium (640x480)</option>
              <option value="high">High (1280x720)</option>
              <option value="ultra">Ultra (1920x1080)</option>
            </select>
          </div>
        </div>
        
        <div class="feature-group">
          <h4>Audio Settings</h4>
          <div class="audio-controls">
            <label>
              <input type="checkbox" v-model="echoCancellation" @change="updateAudioSettings">
              Echo Cancellation
            </label>
            <label>
              <input type="checkbox" v-model="noiseSuppression" @change="updateAudioSettings">
              Noise Suppression
            </label>
          </div>
        </div>
        
        <div class="feature-group">
          <h4>Screen Sharing</h4>
          <div class="screen-controls">
            <button @click="startScreenShare" :disabled="screenSharing" class="btn btn-secondary">
              <span class="btn-icon">🖥️</span>
              Start Screen Share
            </button>
            <button @click="stopScreenShare" :disabled="!screenSharing" class="btn btn-secondary">
              <span class="btn-icon">⏹️</span>
              Stop Screen Share
            </button>
          </div>
        </div>
        
        <div class="feature-group">
          <h4>Recording</h4>
          <div class="recording-controls">
            <button @click="startRecording" :disabled="recording" class="btn btn-secondary">
              <span class="btn-icon">⏺️</span>
              Start Recording
            </button>
            <button @click="stopRecording" :disabled="!recording" class="btn btn-secondary">
              <span class="btn-icon">⏹️</span>
              Stop Recording
            </button>
            <button @click="downloadRecording" :disabled="!recordedBlob" class="btn btn-secondary">
              <span class="btn-icon">💾</span>
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();

// Local reactive state
const localVideo = ref(null);
const remoteVideoRefs = ref(new Map());
const selectedVideoDevice = ref('');
const selectedAudioDevice = ref('');
const selectedPeers = ref([]);
const videoDevices = ref([]);
const audioDevices = ref([]);
const videoQuality = ref('medium');
const echoCancellation = ref(true);
const noiseSuppression = ref(true);
const screenSharing = ref(false);
const recording = ref(false);
const recordedBlob = ref(null);
const mediaRecorder = ref(null);

// Computed properties
const mediaState = computed(() => store.mediaState);
const isConnected = computed(() => store.isConnected);

const totalDevices = computed(() => {
  return videoDevices.value.length + audioDevices.value.length;
});

const webrtcStatus = computed(() => {
  return 'RTCPeerConnection' in window ? 'Supported' : 'Not Supported';
});

// Methods
const startVideo = async () => {
  try {
    await store.startMedia({ video: true, audio: false });
    updateLocalVideo();
  } catch (error) {
    store.addDebugLog(`Failed to start video: ${error.message}`, 'error');
  }
};

const startAudio = async () => {
  try {
    await store.startMedia({ video: false, audio: true });
  } catch (error) {
    store.addDebugLog(`Failed to start audio: ${error.message}`, 'error');
  }
};

const startBoth = async () => {
  try {
    await store.startMedia({ video: true, audio: true });
    updateLocalVideo();
  } catch (error) {
    store.addDebugLog(`Failed to start media: ${error.message}`, 'error');
  }
};

const stopAllMedia = async () => {
  try {
    await store.stopMedia();
    if (localVideo.value) {
      localVideo.value.srcObject = null;
    }
  } catch (error) {
    store.addDebugLog(`Failed to stop media: ${error.message}`, 'error');
  }
};

const toggleVideo = () => {
  try {
    const enabled = store.toggleVideo();
    store.addDebugLog(`Video ${enabled ? 'enabled' : 'disabled'}`);
  } catch (e) {
    store.addDebugLog(`Failed to toggle video: ${e.message}`, 'error');
  }
};

const toggleAudio = () => {
  try {
    const enabled = store.toggleAudio();
    store.addDebugLog(`Audio ${enabled ? 'enabled' : 'disabled'}`);
  } catch (e) {
    store.addDebugLog(`Failed to toggle audio: ${e.message}`, 'error');
  }
};

const updateLocalVideo = async () => {
  await nextTick();
  if (localVideo.value && mediaState.value.localStream) {
    localVideo.value.srcObject = mediaState.value.localStream;
  }
};

const setRemoteVideoRef = (el, peerId) => {
  if (el) {
    remoteVideoRefs.value.set(peerId, el);
    const streamInfo = mediaState.value.remoteStreams.get(peerId);
    if (streamInfo && streamInfo.stream) {
      el.srcObject = streamInfo.stream;
    }
  }
};

const refreshDevices = async () => {
  try {
    const devices = await store.enumerateMediaDevices();
    if (devices && (devices.cameras || devices.microphones)) {
      videoDevices.value = devices.cameras || [];
      audioDevices.value = devices.microphones || [];
    } else if (Array.isArray(devices)) {
      videoDevices.value = devices.filter(d => d.kind === 'videoinput');
      audioDevices.value = devices.filter(d => d.kind === 'audioinput');
    } else {
      // Fallback to browser API
      const raw = await navigator.mediaDevices.enumerateDevices();
      videoDevices.value = raw.filter(d => d.kind === 'videoinput');
      audioDevices.value = raw.filter(d => d.kind === 'audioinput');
    }
    const total = videoDevices.value.length + audioDevices.value.length;
    store.addDebugLog(`Found ${total} media devices`, 'info');
  } catch (error) {
    store.addDebugLog(`Failed to enumerate devices: ${error.message}`, 'error');
  }
};

// Selective streaming actions
const startSelective = async () => {
  if (selectedPeers.value.length === 0) return;
  try {
    await store.initializeMedia();
    const opts = {
      video: true,
      audio: true
    };
    await store.startSelectiveStream(selectedPeers.value, opts);
    store.addDebugLog(`Selective streaming started to ${selectedPeers.value.length} peer(s)`, 'success');
  } catch (error) {
    store.addDebugLog(`Failed to start selective streaming: ${error.message}`, 'error');
  }
};

const stopSelective = async () => {
  try {
    await store.stopSelectiveStream(false);
    store.addDebugLog('Selective streaming stopped', 'info');
  } catch (error) {
    store.addDebugLog(`Failed to stop selective streaming: ${error.message}`, 'error');
  }
};

const switchToBroadcast = async () => {
  try {
    await store.switchToBroadcastMode();
    store.addDebugLog('Switched to broadcast mode', 'info');
  } catch (error) {
    store.addDebugLog(`Failed to switch to broadcast mode: ${error.message}`, 'error');
  }
};

const blockSelected = async () => {
  if (selectedPeers.value.length === 0) return;
  try {
    await store.blockStreamingToPeers(selectedPeers.value);
    store.addDebugLog('Streaming blocked to selected peers', 'warning');
  } catch (error) {
    store.addDebugLog(`Failed to block streaming: ${error.message}`, 'error');
  }
};

const allowSelected = async () => {
  if (selectedPeers.value.length === 0) return;
  try {
    await store.allowStreamingToPeers(selectedPeers.value);
    store.addDebugLog('Streaming allowed to selected peers', 'success');
  } catch (error) {
    store.addDebugLog(`Failed to allow streaming: ${error.message}`, 'error');
  }
};

const changeVideoDevice = async () => {
  if (selectedVideoDevice.value && mediaState.value.localStream) {
    try {
      // Stop current stream and start with new device
      await stopAllMedia();
      await store.startMedia({ 
        video: { deviceId: selectedVideoDevice.value },
        audio: mediaState.value.audioEnabled
      });
      updateLocalVideo();
    } catch (error) {
      store.addDebugLog(`Failed to change video device: ${error.message}`, 'error');
    }
  }
};

const changeAudioDevice = async () => {
  if (selectedAudioDevice.value && mediaState.value.localStream) {
    try {
      // Stop current stream and start with new device
      await stopAllMedia();
      await store.startMedia({ 
        video: mediaState.value.videoEnabled,
        audio: { deviceId: selectedAudioDevice.value }
      });
      updateLocalVideo();
    } catch (error) {
      store.addDebugLog(`Failed to change audio device: ${error.message}`, 'error');
    }
  }
};

const updateVideoQuality = async () => {
  if (mediaState.value.localStream && mediaState.value.videoEnabled) {
    const constraints = getVideoConstraints();
    try {
      const videoTrack = mediaState.value.localStream.getVideoTracks()[0];
      await videoTrack.applyConstraints(constraints);
      store.addDebugLog(`Video quality updated to ${videoQuality.value}`, 'info');
    } catch (error) {
      store.addDebugLog(`Failed to update video quality: ${error.message}`, 'error');
    }
  }
};

const updateAudioSettings = async () => {
  if (mediaState.value.localStream && mediaState.value.audioEnabled) {
    const constraints = {
      echoCancellation: echoCancellation.value,
      noiseSuppression: noiseSuppression.value
    };
    
    try {
      const audioTrack = mediaState.value.localStream.getAudioTracks()[0];
      await audioTrack.applyConstraints(constraints);
      store.addDebugLog('Audio settings updated', 'info');
    } catch (error) {
      store.addDebugLog(`Failed to update audio settings: ${error.message}`, 'error');
    }
  }
};

const getVideoConstraints = () => {
  const qualityMap = {
    low: { width: 320, height: 240 },
    medium: { width: 640, height: 480 },
    high: { width: 1280, height: 720 },
    ultra: { width: 1920, height: 1080 }
  };
  
  return qualityMap[videoQuality.value] || qualityMap.medium;
};

const startScreenShare = async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });
    
    // Replace video track in local stream
    if (mediaState.value.localStream) {
      const videoTrack = stream.getVideoTracks()[0];
      const sender = store.mesh?.connectionManager?.getAllConnections()
        .find(conn => conn.peerConnection?.getSenders)
        ?.peerConnection?.getSenders()
        .find(s => s.track?.kind === 'video');
      
      if (sender) {
        await sender.replaceTrack(videoTrack);
      }
    }
    
    screenSharing.value = true;
    store.addDebugLog('Screen sharing started', 'success');
    
    // Handle screen share end
    stream.getVideoTracks()[0].onended = () => {
      screenSharing.value = false;
      store.addDebugLog('Screen sharing ended', 'info');
    };
  } catch (error) {
    store.addDebugLog(`Failed to start screen share: ${error.message}`, 'error');
  }
};

const stopScreenShare = async () => {
  try {
    // Switch back to camera
    if (mediaState.value.videoEnabled) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
      
      const videoTrack = stream.getVideoTracks()[0];
      const sender = store.mesh?.connectionManager?.getAllConnections()
        .find(conn => conn.peerConnection?.getSenders)
        ?.peerConnection?.getSenders()
        .find(s => s.track?.kind === 'video');
      
      if (sender) {
        await sender.replaceTrack(videoTrack);
      }
    }
    
    screenSharing.value = false;
    store.addDebugLog('Screen sharing stopped', 'info');
  } catch (error) {
    store.addDebugLog(`Failed to stop screen share: ${error.message}`, 'error');
  }
};

const startRecording = () => {
  if (!mediaState.value.localStream) {
    store.addDebugLog('No local stream to record', 'error');
    return;
  }
  
  try {
    const chunks = [];
    mediaRecorder.value = new MediaRecorder(mediaState.value.localStream);
    
    mediaRecorder.value.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    
    mediaRecorder.value.onstop = () => {
      recordedBlob.value = new Blob(chunks, { type: 'video/webm' });
      recording.value = false;
      store.addDebugLog('Recording stopped', 'info');
    };
    
    mediaRecorder.value.start();
    recording.value = true;
    store.addDebugLog('Recording started', 'success');
  } catch (error) {
    store.addDebugLog(`Failed to start recording: ${error.message}`, 'error');
  }
};

const stopRecording = () => {
  if (mediaRecorder.value && recording.value) {
    mediaRecorder.value.stop();
  }
};

const downloadRecording = () => {
  if (recordedBlob.value) {
    const url = URL.createObjectURL(recordedBlob.value);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `peerpigeon-recording-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    store.addDebugLog('Recording downloaded', 'success');
  }
};

const formatDuration = (startTime) => {
  if (!startTime) return '00:00';
  const now = new Date();
  const diff = Math.floor((now - startTime) / 1000);
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

// Watch for local stream changes
watch(() => mediaState.value.localStream, (newStream) => {
  if (newStream && localVideo.value) {
    localVideo.value.srcObject = newStream;
  }
});

// Watch for remote stream changes
watch(() => mediaState.value.remoteStreams, (newStreams) => {
  for (const [peerId, streamInfo] of newStreams) {
    const videoEl = remoteVideoRefs.value.get(peerId);
    if (videoEl && streamInfo.stream) {
      videoEl.srcObject = streamInfo.stream;
    }
  }
}, { deep: true });

onMounted(async () => {
  await refreshDevices();
  
  // Update devices when permissions are granted
  navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
});

onUnmounted(() => {
  navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
  
  if (recording.value) {
    stopRecording();
  }
});
</script>

<style scoped>
.media-view {
  max-width: 1200px;
  margin: 0 auto;
}

.section-header {
  text-align: center;
  margin-bottom: 30px;
}

.section-header h2 {
  font-size: 28px;
  color: #333;
  margin-bottom: 8px;
}

.section-header p {
  color: #666;
  font-size: 16px;
}

.media-controls {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.media-controls h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.controls-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
}

.control-group h4 {
  margin: 0 0 12px 0;
  color: #555;
  font-size: 16px;
}

.control-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.device-selectors {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.device-select {
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
}

.quality-select {
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  margin-left: 8px;
}

.btn {
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-secondary {
  background: #6b7280;
  color: white;
}

.btn-secondary:hover:not(:disabled) {
  background: #4b5563;
}

.btn-success {
  background: #10b981;
  color: white;
}

.btn-success:hover:not(:disabled) {
  background: #059669;
}

.btn-danger {
  background: #ef4444;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-sm {
  padding: 4px 8px;
  font-size: 11px;
}

.btn-icon {
  font-size: 14px;
}

.streams-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
  margin-bottom: 30px;
}

.stream-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.stream-section h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.local-stream-container {
  position: relative;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 16/9;
}

.media-stream {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
}

.media-stream.local-stream {
  transform: scaleX(-1); /* Mirror local video */
}

.stream-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.8);
  color: white;
}

.overlay-content {
  text-align: center;
}

.overlay-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 16px;
}

.overlay-content p {
  margin: 0 0 8px 0;
}

.overlay-meta {
  font-size: 14px;
  color: #ccc;
}

.stream-info {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
  color: white;
  padding: 16px;
}

.stream-stats {
  display: flex;
  gap: 16px;
}

.stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.stat-icon {
  font-size: 16px;
}

.peer-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-weight: 500;
}

.peer-icon {
  font-size: 16px;
}

.stream-time {
  font-size: 12px;
  color: #ccc;
}

.empty-streams {
  text-align: center;
  padding: 60px 20px;
  color: #666;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-streams p {
  margin: 0 0 8px 0;
}

.empty-meta {
  font-size: 14px;
  color: #999;
}

.remote-streams-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.remote-stream-container {
  position: relative;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 16/9;
}

.stats-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.stats-section h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #eee;
}

.stat-icon {
  font-size: 32px;
  opacity: 0.8;
}

.stat-content h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}

.stat-meta {
  font-size: 12px;
  color: #999;
}

.advanced-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.advanced-section h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.advanced-features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 24px;
}

.feature-group h4 {
  margin: 0 0 12px 0;
  color: #555;
  font-size: 16px;
}

.quality-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.audio-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.audio-controls label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
}

.screen-controls,
.recording-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Responsive design */
@media (max-width: 768px) {
  .streams-container {
    grid-template-columns: 1fr;
  }
  
  .controls-grid {
    grid-template-columns: 1fr;
  }
  
  .control-buttons {
    justify-content: center;
  }
  
  .remote-streams-grid {
    grid-template-columns: 1fr;
  }
}
</style>
