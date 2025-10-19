import { createRouter, createWebHistory } from 'vue-router';
import NetworkView from './components/NetworkView.vue';
import MessagingView from './components/MessagingView.vue';
import MediaView from './components/MediaView.vue';
import DHTView from './components/DHTView.vue';
import StorageView from './components/StorageView.vue';
import CryptoView from './components/CryptoView.vue';
import DebugView from './components/DebugView.vue';
import TestingView from './components/TestingView.vue';

const routes = [
  {
    path: '/',
    redirect: '/network'
  },
  {
    path: '/network',
    name: 'Network',
    component: NetworkView
  },
  {
    path: '/messaging',
    name: 'Messaging',
    component: MessagingView
  },
  {
    path: '/media',
    name: 'Media',
    component: MediaView
  },
  {
    path: '/dht',
    name: 'DHT',
    component: DHTView
  },
  {
    path: '/storage',
    name: 'Storage',
    component: StorageView
  },
  {
    path: '/crypto',
    name: 'Crypto',
    component: CryptoView
  },
  {
    path: '/debug',
    name: 'Debug',
    component: DebugView
  },
  {
    path: '/testing',
    name: 'Testing',
    component: TestingView
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

export default router;
