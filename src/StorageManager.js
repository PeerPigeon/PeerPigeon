import { EventEmitter } from './EventEmitter.js';

/**
 * Manages storage operations, URL handling, and configuration persistence
 */
export class StorageManager extends EventEmitter {
    constructor(mesh) {
        super();
        this.mesh = mesh;
    }

    loadSignalingUrlFromStorage() {
        if (typeof localStorage !== 'undefined') {
            const savedUrl = localStorage.getItem('pigon-signaling-url');
            if (savedUrl) {
                this.mesh.signalingUrl = savedUrl;
                this.mesh.emit('statusChanged', { type: 'urlLoaded', signalingUrl: savedUrl });
                return savedUrl;
            }
        }
        return null;
    }

    saveSignalingUrlToStorage(url) {
        if (typeof localStorage !== 'undefined' && url) {
            localStorage.setItem('pigon-signaling-url', url);
        }
    }

    loadSignalingUrlFromQuery() {
        if (typeof window === 'undefined') return null;
        
        const urlParams = new URLSearchParams(window.location.search);
        const signalingUrl = urlParams.get('api') || urlParams.get('url') || urlParams.get('signaling');
        
        if (signalingUrl) {
            // Only emit event if URL is different from current one
            const currentUrl = this.mesh.signalingUrl;
            this.mesh.signalingUrl = signalingUrl;
            this.saveSignalingUrlToStorage(signalingUrl);
            
            if (currentUrl !== signalingUrl) {
                this.mesh.emit('statusChanged', { type: 'urlLoaded', signalingUrl });
            }
            return signalingUrl;
        }
        
        // Fallback to localStorage if no URL in query params
        return this.loadSignalingUrlFromStorage();
    }

    async generatePeerId() {
        const array = new Uint8Array(20);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    validatePeerId(peerId) {
        return typeof peerId === 'string' && /^[a-fA-F0-9]{40}$/.test(peerId);
    }

    saveSettings(settings) {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('pigon-settings', JSON.stringify(settings));
        }
    }

    loadSettings() {
        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem('pigon-settings');
            if (saved) {
                try {
                    return JSON.parse(saved);
                } catch (error) {
                    console.error('Failed to parse saved settings:', error);
                }
            }
        }
        return {};
    }

    clearStorage() {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('pigon-signaling-url');
            localStorage.removeItem('pigon-settings');
        }
    }
}
