import { createApp } from 'vue';
import App from '/src/App.vue';

if (import.meta.env.DEV && typeof window !== 'undefined') {
	window.addEventListener('load', async () => {
		try {
			if ('serviceWorker' in navigator) {
				const regs = await navigator.serviceWorker.getRegistrations();
				await Promise.all(regs.map((reg) => reg.unregister()));
			}

			if ('caches' in window) {
				const keys = await caches.keys();
				await Promise.all(keys.map((key) => caches.delete(key)));
			}
		} catch {
			// ignore cleanup failures in dev
		}
	});
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
	window.addEventListener('load', async () => {
		try {
			await navigator.serviceWorker.register('/sw.js', { scope: '/' });
			// Keep logs quiet by default; uncomment when debugging.
			// console.log('[sw] registered');
		} catch (err) {
			// Non-fatal (some automation environments can be finicky).
			// console.warn('[sw] registration failed', err);
		}
	});
}

const app = createApp(App);
app.mount('#app');
