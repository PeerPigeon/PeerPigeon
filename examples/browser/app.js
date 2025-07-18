import { PeerPigeonMesh } from '../../src/PeerPigeonMesh.js';
import { PeerPigeonUI } from './ui.js';

class PeerPigeonApp {
    constructor() {
        // Initialize mesh with default options (WebDHT enabled)
        this.mesh = new PeerPigeonMesh();
        
        // To disable WebDHT, use:
        // this.mesh = new PeerPigeonMesh({ enableWebDHT: false });
        
        this.ui = new PeerPigeonUI(this.mesh);
        this.init();
    }

    async init() {
        try {
            await this.mesh.init();
            this.ui.updateUI();
            this.setupUnloadHandler();
        } catch (error) {
            console.error('Failed to initialize app:', error);
        }
    }

    setupUnloadHandler() {
        const handleUnload = () => {
            if (this.mesh.connected) {
                this.mesh.sendGoodbyeMessage();
            }
        };

        window.addEventListener('beforeunload', handleUnload);
        window.addEventListener('unload', handleUnload);
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    const peerPigeonApp = new PeerPigeonApp();
    
    // Expose for debugging and global access
    window.peerPigeonApp = peerPigeonApp;
    window.peerPigeonMesh = peerPigeonApp.mesh;
    window.peerPigeonUI = peerPigeonApp.ui;
    window.peerPigeonSignaling = peerPigeonApp.mesh.signalingClient;
    window.getPeerPigeonState = () => peerPigeonApp.mesh.getStatus();
    
    // Expose PeerPigeonMesh class for static validation in UI
    window.PeerPigeonMesh = PeerPigeonMesh;
});