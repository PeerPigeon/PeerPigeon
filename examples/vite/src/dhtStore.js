import { ref, watch } from 'vue';

// Shared DHT instance across all pages
export const dht = ref(null);
export const ws = ref(null);
export const connected = ref(false);
export const nodeId = ref('');
export const connectedPeers = ref(0);
export const peerList = ref([]);
export const messages = ref([]);
export const discoveredPeers = ref([]);
export const files = ref([]);
export const roomId = ref('');
export const roomSwitchDone = ref(false);
export const encryptionEnabled = ref(false);
export const cryptoKey = ref(null);
export const kv = ref({});
export const latency = ref({});

async function deriveRoomKey(id) {
  // Derive AES-GCM key from roomId via SHA-256
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(id));
  return crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function initRoomKey(id) {
  roomId.value = id;
  cryptoKey.value = await deriveRoomKey(id);
}

export async function encryptChat(text) {
  if (!cryptoKey.value) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(text);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey.value,
    data
  );
  return { iv: Array.from(iv), cipher: Array.from(new Uint8Array(cipher)) };
}

export async function decryptChat(payload) {
  if (!cryptoKey.value) return null;
  const iv = new Uint8Array(payload.iv);
  const cipher = new Uint8Array(payload.cipher);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey.value,
      cipher
    );
    return new TextDecoder().decode(plain);
  } catch (e) {
    return null;
  }
}

// Attach all DHT event listeners globally so they work across all pages
watch(dht, (newDht) => {
  if (newDht && newDht.on) {
    // Peer connection events
    newDht.on('signaling:connected', (data) => {
      nodeId.value = data.clientId;
      connected.value = true;
    });

    newDht.on('signaling:disconnected', () => {
      connected.value = false;
    });

    newDht.on('peer:connected', async (peerId) => {
      if (!peerList.value.includes(peerId)) {
        peerList.value.push(peerId);
        connectedPeers.value = peerList.value.length;
      }

      // First peer sets a deterministic active room for 30 minutes (no reconnects)
      try {
        if (connectedPeers.value === 1 && !roomSwitchDone.value) {
          const now = Date.now();
          const thirtyMinMs = 30 * 60 * 1000;
          const bucket = Math.floor(now / thirtyMinMs).toString(36);
          const leader = [nodeId.value, peerId].filter(Boolean).sort()[0] || nodeId.value;
          const suffix = (leader || '').substring(0, 4);
          const targetRoom = `room-${bucket}-${suffix}`;

          roomId.value = targetRoom;
          roomSwitchDone.value = true;
          await initRoomKey(targetRoom);
          try {
            newDht.broadcast(JSON.stringify({ type: 'room-switch', room: targetRoom }));
            try { window?.dispatchEvent?.(new CustomEvent('room-switch', { detail: { room: targetRoom } })); } catch (e) {}
          } catch (e) {}
        }
      } catch (e) {}
    });

    newDht.on('peer:discovered', (peerId) => {
      if (!discoveredPeers.value.includes(peerId)) {
        discoveredPeers.value.push(peerId);
      }
    });

    newDht.on('peer:disconnected', async (peerId) => {
      peerList.value = peerList.value.filter(p => p !== peerId);
      discoveredPeers.value = discoveredPeers.value.filter(p => p !== peerId);
      connectedPeers.value = peerList.value.length;
    });

    // Message events
    newDht.on('peer:data', async ({ peerId, data }) => {
      try {
        const raw = typeof data === 'string' ? data : new TextDecoder().decode(data);
        const msg = JSON.parse(raw);
        if (msg.type === 'chat') {
          messages.value.push({
            from: msg.from,
            text: msg.text,
            time: new Date(msg.timestamp).toLocaleTimeString(),
            encrypted: false
          });
        } else if (msg.type === 'chat-enc' && encryptionEnabled.value) {
          const text = await decryptChat(msg.payload);
          if (text) {
            messages.value.push({
              from: msg.from,
              text,
              time: new Date(msg.timestamp).toLocaleTimeString(),
              encrypted: true
            });
          }
        } else if (msg.type === 'file') {
          // Expect msg.payload: { name, dataBase64 }
          try {
            const { name, dataBase64 } = msg.payload || {};
            if (name && dataBase64) {
              const byteStr = atob(dataBase64);
              const bytes = new Uint8Array(byteStr.length);
              for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
              const blob = new Blob([bytes]);
              const url = URL.createObjectURL(blob);
              files.value.push({ from: msg.from, name, size: bytes.length, url });
            }
          } catch (e) {}
        } else if (msg.type === 'kv-set' && msg.key) {
          const value = msg.value;
          kv.value = { ...kv.value, [msg.key]: value };
        } else if (msg.type === 'kv-delete' && msg.key) {
          const newKv = { ...kv.value };
          delete newKv[msg.key];
          kv.value = newKv;
        } else if (msg.type === 'room-switch' && msg.room) {
          // Update local room, derive key, and notify UI to reconnect
          try {
            roomId.value = msg.room;
            await initRoomKey(msg.room);
            roomSwitchDone.value = true;
            try { window?.dispatchEvent?.(new CustomEvent('room-switch', { detail: { room: msg.room } })); } catch (e) {}
          } catch (e) {}
        } else if (msg.type === 'ping' && msg.t) {
          // respond to ping with pong
          try {
            dht.value?.send(peerId, JSON.stringify({ type: 'pong', t: msg.t }));
          } catch (e) {}
        } else if (msg.type === 'pong' && msg.t) {
          const rtt = Date.now() - msg.t;
          latency.value = { ...latency.value, [peerId]: rtt };
        }
      } catch (e) {}
    });
  }
}, { immediate: true });

