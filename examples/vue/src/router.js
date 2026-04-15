import { createRouter, createWebHistory } from 'vue-router';
import ConnectionView from './components/ConnectionView.vue';
import MessagingView from './components/MessagingView.vue';
import MediaView from './components/MediaView.vue';
import DHTView from './components/DHTView.vue';
import CryptoView from './components/CryptoView.vue';
import NetworkInfoView from './components/NetworkInfoView.vue';
import TestingView from './components/TestingView.vue';

const routes = [
  { path: '/', redirect: '/connection' },
  { path: '/connection', name: 'Connection', component: ConnectionView },
  { path: '/messaging', name: 'Messaging', component: MessagingView },
  { path: '/media', name: 'Media', component: MediaView },
  { path: '/dht', name: 'DHT', component: DHTView },
  { path: '/crypto', name: 'Crypto', component: CryptoView },
  { path: '/network', name: 'Network', component: NetworkInfoView },
  { path: '/testing', name: 'Testing', component: TestingView },
];

const router = createRouter({
  history: createWebHistory('/'),
  routes,
});

export default router;
