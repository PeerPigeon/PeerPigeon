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

    newDht.on('peer:connected', (peerId) => {
      if (!peerList.value.includes(peerId)) {
        peerList.value.push(peerId);
        connectedPeers.value = peerList.value.length;
      }
    });

    newDht.on('peer:discovered', (peerId) => {
      if (!discoveredPeers.value.includes(peerId)) {
        discoveredPeers.value.push(peerId);
      }
    });

    newDht.on('peer:disconnected', (peerId) => {
      peerList.value = peerList.value.filter(p => p !== peerId);
      discoveredPeers.value = discoveredPeers.value.filter(p => p !== peerId);
      connectedPeers.value = peerList.value.length;
    });

    // Message events
    newDht.on('peer:data', ({ peerId, data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'chat') {
          messages.value.push({
            from: msg.from,
            text: msg.text,
            time: new Date(msg.timestamp).toLocaleTimeString()
          });
        }
      } catch (e) {}
    });
  }
}, { immediate: true });
