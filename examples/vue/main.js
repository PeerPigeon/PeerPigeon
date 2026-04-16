import { createApp } from 'vue'
import App from './App.vue'

if (typeof window !== 'undefined' && import.meta.env.DEV && 'serviceWorker' in navigator) {
	navigator.serviceWorker.getRegistrations().then((registrations) => {
		for (const registration of registrations) {
			registration.unregister().catch(() => {})
		}
	}).catch(() => {})
	if ('caches' in window) {
		caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).catch(() => {})
	}
}

createApp(App).mount('#app')
