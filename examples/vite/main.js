import { createApp } from 'vue';
import App from 'webdht/src/App.vue';
import 'webdht/src/style.css';

// Ensure a private room by default to avoid public-room peers.
// This helps prevent ICE failures without needing TURN.
(function ensurePrivateRoom() {
	try {
		const url = new URL(window.location.href);
		if (!url.searchParams.get('room')) {
			const rand = Math.random().toString(16).slice(2, 8);
			url.searchParams.set('room', `local-${rand}`);
			// Keep other params intact, avoid a reload.
			window.history.replaceState(null, '', url.toString());
		}
	} catch {
		// best-effort; ignore in non-browser contexts
	}
})();

createApp(App).mount('#app');
