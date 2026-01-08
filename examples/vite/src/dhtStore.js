import { ref } from 'vue';

// Shared DHT instance across all pages
export const dht = ref(null);
export const ws = ref(null);
export const connected = ref(false);
export const nodeId = ref('');
export const connectedPeers = ref(0);
export const peerList = ref([]);
