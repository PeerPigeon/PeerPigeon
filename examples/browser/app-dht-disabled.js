import { PeerPigeonMesh } from '../../src/PeerPigeonMesh.js';
import { PeerPigeonUI } from './ui.js';

class PeerPigeonApp {
    constructor() {
        // Test: Initialize mesh with WebDHT disabled to demonstrate the UI setting
        this.mesh = new PeerPigeonMesh({ enableWebDHT: false });
        
        // To enable WebDHT (default), use:
        // this.mesh = new PeerPigeonMesh();
        // this.mesh = new PeerPigeonMesh({ enableWebDHT: true });
        
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

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new PeerPigeonApp();
});
