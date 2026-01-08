import { createRouter, createWebHistory } from 'vue-router';
import Network from './pages/Network.vue';

// Lazy placeholders for other sections
const Messaging = () => import('./pages/Messaging.vue');
const Media = () => import('./pages/Media.vue');
const DHT = () => import('./pages/DHT.vue');
const Storage = () => import('./pages/Storage.vue');
const Crypto = () => import('./pages/Crypto.vue');
const Debug = () => import('./pages/Debug.vue');
const Testing = () => import('./pages/Testing.vue');

const routes = [
  { path: '/', redirect: '/network' },
  { path: '/network', component: Network },
  { path: '/messaging', component: Messaging },
  { path: '/media', component: Media },
  { path: '/dht', component: DHT },
  { path: '/storage', component: Storage },
  { path: '/crypto', component: Crypto },
  { path: '/debug', component: Debug },
  { path: '/testing', component: Testing },
];

export default createRouter({
  history: createWebHistory(),
  routes,
});
