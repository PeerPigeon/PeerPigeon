import { createApp } from 'vue';
import App from '/src/App.vue';

const DEV_FALLBACK_HOST = 'peer.ooo';

function buildDevFallbackUrl() {
	if (typeof window === 'undefined' || typeof window.location === 'undefined') {
		return { toString: () => '', searchParams: { set: () => {} }, protocol: '', hostname: '', port: '' };
	}
	const redirectUrl = new URL(window.location.href);
	redirectUrl.protocol = 'https:';
	redirectUrl.hostname = DEV_FALLBACK_HOST;
	redirectUrl.port = '';
	redirectUrl.searchParams.set('peer_local_fallback', '1');
	return redirectUrl;
}

function redirectToDevFallback(reason: string) {
	if (typeof window === 'undefined') return;
	if (!/\.local$/i.test(window.location.hostname || '')) return;
	if (/^peer\.ooo$/i.test(window.location.hostname || '')) return;

	const redirectUrl = buildDevFallbackUrl();
	if (redirectUrl && redirectUrl.searchParams && typeof redirectUrl.searchParams.set === 'function') {
		redirectUrl.searchParams.set('fallback_reason', reason);
	}
	if (redirectUrl && typeof redirectUrl.toString === 'function') {
		window.location.replace(redirectUrl.toString());
	}
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
	const cryptoObj = window.crypto ?? globalThis.crypto;
	const hasSubtle = !!(cryptoObj && cryptoObj.subtle);
	const isLocalMdnsHost = /\.local$/i.test(window.location.hostname || '');

	if (!hasSubtle && isLocalMdnsHost) {
		redirectToDevFallback('missing-subtle');
	}
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
	const isLocalMdnsHost = /\.local$/i.test(window.location.hostname || '');

	if (isLocalMdnsHost) {
		window.addEventListener('offline', () => {
			redirectToDevFallback('offline');
		});

		window.addEventListener('load', () => {
			const controller = new AbortController();
			const timeoutId = window.setTimeout(() => controller.abort(), 2500);

			fetch(window.location.origin + '/favicon.ico', {
				cache: 'no-store',
				signal: controller.signal
			}).catch(() => {
				redirectToDevFallback('healthcheck-failed');
			}).finally(() => {
				window.clearTimeout(timeoutId);
			});
		});
	}
}

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
		} catch {
			// Non-fatal (some automation environments can be finicky).
			// console.warn('[sw] registration failed', err);
		}
	});
}

const app = createApp(App);
app.mount('#app');