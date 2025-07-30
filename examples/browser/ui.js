// Updated: 2025-07-04 - Fixed getConnectionStatus method name
import DebugLogger from '../../src/DebugLogger.js';

export class PeerPigeonUI {
  constructor(mesh) {
    this.mesh = mesh;
    this.debug = DebugLogger.create('PeerPigeonUI');
    this.lastCleanupTime = 0; // Track when we last did cleanup
    this.setupEventListeners();
    this.bindDOMEvents();
    this.initializeMedia();
  }

  setupEventListeners() {
    this.mesh.addEventListener('statusChanged', (data) => {
      this.handleStatusChange(data);
    });

    this.mesh.addEventListener('peerDiscovered', (_data) => {
      this.updateDiscoveredPeers();
    });

    this.mesh.addEventListener('peerConnected', (_data) => {
      this.updateUI();
      this.updateDiscoveredPeers();
    });

    this.mesh.addEventListener('peerDisconnected', (data) => {
      this.addMessage('System', `Peer ${data.peerId.substring(0, 8)}... disconnected (${data.reason})`);
      this.updateUI();
      this.updateDiscoveredPeers();
    });

    this.mesh.addEventListener('messageReceived', (data) => {
      // Only show messages from other peers, not self
      if (data.from !== this.mesh.peerId) {
        if (data.direct) {
          this.addMessage(`${data.from.substring(0, 8)}...`, `(DM) ${data.content}`, 'dm');
        } else {
          this.addMessage(`${data.from.substring(0, 8)}...`, data.content);
        }
      }
    });

    this.mesh.addEventListener('peerEvicted', (_data) => {
      this.updateUI();
      this.updateDiscoveredPeers();
    });

    this.mesh.addEventListener('peersUpdated', () => {
      this.updateDiscoveredPeers();
    });

    this.mesh.addEventListener('connectionStats', (_stats) => {
      // Handle connection stats if needed
    });

    // DHT event listeners
    this.mesh.addEventListener('dhtValueChanged', (data) => {
      const { key, newValue, timestamp } = data;
      this.addDHTLogEntry(`🔔 Value Changed: ${key} = ${JSON.stringify(newValue)} (timestamp: ${timestamp})`);
    });

    // Media event listeners
    this.mesh.addEventListener('localStreamStarted', (data) => {
      this.handleLocalStreamStarted(data);
    });

    this.mesh.addEventListener('localStreamStopped', () => {
      this.handleLocalStreamStopped();
    });

    this.mesh.addEventListener('mediaError', (data) => {
      this.addMessage('System', `Media error: ${data.error.message}`, 'error');
    });

    // Listen for remote streams
    this.mesh.addEventListener('remoteStream', (data) => {
      this.handleRemoteStream(data);
    });

    // Crypto event listeners
    this.mesh.addEventListener('cryptoReady', (_data) => {
      this.addMessage('System', '🔐 Crypto initialized successfully', 'success');
      this.updateCryptoStatus();
    });

    this.mesh.addEventListener('cryptoError', (data) => {
      this.addMessage('System', `🔐 Crypto error: ${data.error}`, 'error');
      this.addCryptoTestResult(`❌ Crypto Error: ${data.error}`, 'error');
    });

    this.mesh.addEventListener('peerKeyAdded', (data) => {
      this.addMessage('System', `🔐 Public key received from ${data.peerId.substring(0, 8)}...`);
      this.updateCryptoStatus();
    });

    this.mesh.addEventListener('userAuthenticated', (data) => {
      this.addMessage('System', `🔐 Authenticated as ${data.alias}`, 'success');
      this.updateCryptoStatus();
    });
  }

  handleStatusChange(data) {
    switch (data.type) {
      case 'initialized':
        this.updateUI();
        break;
      case 'connecting':
        this.addMessage('System', 'Connecting to signaling server...');
        this.updateUI();
        break;
      case 'connected':
        this.addMessage('System', 'Connected to signaling server');
        this.updateUI();
        break;
      case 'disconnected':
        this.addMessage('System', 'Disconnected from signaling server');
        this.updateUI();
        this.updateDiscoveredPeers();
        break;
      case 'error':
        this.addMessage('System', data.message, 'error');
        this.updateUI();
        break;
      case 'warning':
        this.addMessage('System', data.message, 'warning');
        break;
      case 'info':
        this.addMessage('System', data.message);
        break;
      case 'urlLoaded':
        document.getElementById('signaling-url').value = data.signalingUrl;
        this.addMessage('System', `API Gateway URL loaded: ${data.signalingUrl}`);
        break;
      case 'setting': {
        const settingName = data.setting === 'autoDiscovery'
          ? 'Auto discovery'
          : data.setting === 'evictionStrategy'
            ? 'Smart eviction strategy'
            : data.setting === 'xorRouting'
              ? 'XOR-based routing'
              : data.setting === 'connectionType' ? 'Connection type' : data.setting;

        if (data.setting === 'connectionType') {
          this.addMessage('System', `${settingName} set to: ${data.value}`);
        } else {
          this.addMessage('System', `${settingName} ${data.value ? 'enabled' : 'disabled'}`);
        }
        break;
      }
    }
  }

  bindDOMEvents() {
    // Connection controls
    document.getElementById('connect-btn').addEventListener('click', () => {
      this.handleConnect();
    });

    document.getElementById('disconnect-btn').addEventListener('click', () => {
      this.handleDisconnect();
    });

    document.getElementById('cleanup-btn').addEventListener('click', () => {
      this.handleCleanup();
    });

    document.getElementById('health-check-btn').addEventListener('click', () => {
      this.handleHealthCheck();
    });

    document.getElementById('refresh-btn').addEventListener('click', () => {
      window.location.reload();
    });

    // Messaging
    document.getElementById('send-message-btn').addEventListener('click', () => {
      this.sendMessage();
    });

    document.getElementById('message-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendMessage();
      }
    });

    // Manual connection
    document.getElementById('connect-peer-btn').addEventListener('click', () => {
      this.connectToPeer();
    });

    document.getElementById('target-peer').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.connectToPeer();
      }
    });

    // Settings
    document.getElementById('min-peers').addEventListener('change', (e) => {
      this.mesh.setMinPeers(parseInt(e.target.value));
    });

    document.getElementById('max-peers').addEventListener('change', (e) => {
      this.mesh.setMaxPeers(parseInt(e.target.value));
    });

    document.getElementById('auto-discovery-toggle').addEventListener('change', (e) => {
      this.mesh.setAutoDiscovery(e.target.checked);
    });

    document.getElementById('eviction-strategy-toggle').addEventListener('change', (e) => {
      this.mesh.setEvictionStrategy(e.target.checked);
    });

    document.getElementById('xor-routing-toggle').addEventListener('change', (e) => {
      this.mesh.setXorRouting(e.target.checked);
    });

    // DHT controls
    this.setupDHTControls();

    // Storage controls
    this.setupStorageControls();

    // Crypto controls
    this.setupCryptoControls();

    // Collapsible sections
    this.setupCollapsibleSections();

    // Media controls
    this.setupMediaControls();
  }

  setupDHTControls() {
    // DHT input fields and controls
    const dhtKey = document.getElementById('dht-key');
    const dhtValue = document.getElementById('dht-value');
    const dhtGetKey = document.getElementById('dht-get-key'); // Separate key field for retrieval
    const dhtSubscribeKey = document.getElementById('dht-subscribe-key'); // Separate key field for subscription
    const dhtPutBtn = document.getElementById('dht-put-btn');
    const dhtUpdateBtn = document.getElementById('dht-update-btn');
    const dhtGetBtn = document.getElementById('dht-get-btn');
    const dhtSubscribeBtn = document.getElementById('dht-subscribe-btn');
    const dhtUnsubscribeBtn = document.getElementById('dht-unsubscribe-btn');
    const dhtEnableTtl = document.getElementById('dht-enable-ttl');
    const dhtTtlGroup = document.getElementById('dht-ttl-group');
    const dhtTtl = document.getElementById('dht-ttl');

    // Debug: Check if elements are found
    this.debug.log('DHT Controls setup - Elements found:', {
      dhtKey: !!dhtKey,
      dhtValue: !!dhtValue,
      dhtGetKey: !!dhtGetKey,
      dhtSubscribeKey: !!dhtSubscribeKey,
      dhtPutBtn: !!dhtPutBtn,
      dhtUpdateBtn: !!dhtUpdateBtn,
      dhtGetBtn: !!dhtGetBtn,
      dhtSubscribeBtn: !!dhtSubscribeBtn,
      dhtUnsubscribeBtn: !!dhtUnsubscribeBtn
    });

    if (!dhtKey) {
      this.debug.error('DHT key input element not found!');
      this.addDHTLogEntry('❌ Error: DHT key input field not found in DOM');
    }

    if (!dhtValue) {
      this.debug.error('DHT value input element not found!');
      this.addDHTLogEntry('❌ Error: DHT value input field not found in DOM');
    }

    if (!dhtGetKey) {
      this.debug.error('DHT get-key input element not found!');
      this.addDHTLogEntry('❌ Error: DHT get-key input field not found in DOM');
    }

    // Toggle TTL input visibility
    if (dhtEnableTtl && dhtTtlGroup) {
      dhtEnableTtl.addEventListener('change', (e) => {
        dhtTtlGroup.style.display = e.target.checked ? 'block' : 'none';
      });
    }

    // Store in DHT
    if (dhtPutBtn) {
      dhtPutBtn.addEventListener('click', async () => {
        const key = dhtKey?.value?.trim();
        const value = dhtValue?.value?.trim();

        // Debug logging
        this.debug.log('DHT PUT - Elements found:', {
          dhtKey: !!dhtKey,
          dhtValue: !!dhtValue,
          keyValue: key,
          valueValue: value
        });

        if (!key || !value) {
          this.addDHTLogEntry('❌ Error: Both key and value are required');
          this.addDHTLogEntry(`   Debug: key="${key}", value="${value}"`);
          return;
        }

        if (!this.mesh.isDHTEnabled()) {
          this.addDHTLogEntry('❌ Error: WebDHT is disabled');
          return;
        }

        try {
          let parsedValue;
          try {
            parsedValue = JSON.parse(value);
          } catch {
            parsedValue = value; // Use as string if not valid JSON
          }

          const options = {};
          if (dhtEnableTtl?.checked && dhtTtl?.value) {
            options.ttl = parseInt(dhtTtl.value) * 1000; // Convert to milliseconds
          }

          const success = await this.mesh.dhtPut(key, parsedValue, options);
          if (success) {
            this.addDHTLogEntry(`✅ Stored: ${key} = ${JSON.stringify(parsedValue)}`);
            if (options.ttl) {
              this.addDHTLogEntry(`   TTL: ${options.ttl / 1000} seconds`);
            }
            this.addDHTLogEntry(`   🏆 This peer is now an ORIGINAL STORING PEER for "${key}"`);

            // Auto-subscribe to the key we just stored (essential for original storing peers)
            try {
              await this.mesh.dhtSubscribe(key);
              this.addDHTLogEntry(`🔔 Auto-subscribed as original storing peer: ${key}`);
              this.addDHTLogEntry('   📡 Will receive and relay all future updates for this key');
            } catch (subscribeError) {
              this.addDHTLogEntry(`⚠️ Failed to auto-subscribe to ${key}: ${subscribeError.message}`);
            }
          } else {
            this.addDHTLogEntry(`❌ Failed to store: ${key}`);
          }
        } catch (error) {
          this.addDHTLogEntry(`❌ Error storing ${key}: ${error.message}`);
        }
      });
    }

    // Update in DHT
    if (dhtUpdateBtn) {
      dhtUpdateBtn.addEventListener('click', async () => {
        const key = dhtKey?.value?.trim();
        const value = dhtValue?.value?.trim();

        // Debug logging
        this.debug.log('DHT UPDATE - Elements found:', {
          dhtKey: !!dhtKey,
          dhtValue: !!dhtValue,
          keyValue: key,
          valueValue: value
        });

        if (!key || !value) {
          this.addDHTLogEntry('❌ Error: Both key and value are required');
          this.addDHTLogEntry(`   Debug: key="${key}", value="${value}"`);
          return;
        }

        if (!this.mesh.isDHTEnabled()) {
          this.addDHTLogEntry('❌ Error: WebDHT is disabled');
          return;
        }

        try {
          let parsedValue;
          try {
            parsedValue = JSON.parse(value);
          } catch {
            parsedValue = value; // Use as string if not valid JSON
          }

          const options = {};
          if (dhtEnableTtl?.checked && dhtTtl?.value) {
            options.ttl = parseInt(dhtTtl.value) * 1000; // Convert to milliseconds
          }

          const success = await this.mesh.dhtUpdate(key, parsedValue, options);
          if (success) {
            this.addDHTLogEntry(`🔄 Updated: ${key} = ${JSON.stringify(parsedValue)}`);
            if (options.ttl) {
              this.addDHTLogEntry(`   TTL: ${options.ttl / 1000} seconds`);
            }
            this.addDHTLogEntry(`   🏆 This peer is now an ORIGINAL STORING PEER for "${key}"`);

            // Auto-subscribe to the key we just updated (essential for original storing peers)
            try {
              await this.mesh.dhtSubscribe(key);
              this.addDHTLogEntry(`🔔 Auto-subscribed as original storing peer: ${key}`);
              this.addDHTLogEntry('   📡 Will receive and relay all future updates for this key');
            } catch (subscribeError) {
              this.addDHTLogEntry(`⚠️ Failed to auto-subscribe to ${key}: ${subscribeError.message}`);
            }
          } else {
            this.addDHTLogEntry(`❌ Failed to update: ${key}`);
          }
        } catch (error) {
          this.addDHTLogEntry(`❌ Error updating ${key}: ${error.message}`);
        }
      });
    }

    // Get from DHT
    if (dhtGetBtn) {
      dhtGetBtn.addEventListener('click', async () => {
        const key = dhtGetKey?.value?.trim(); // Fixed: Use dhtGetKey instead of dhtKey

        // Debug logging
        this.debug.log('DHT GET - Elements found:', {
          dhtGetKey: !!dhtGetKey,
          keyValue: key
        });

        if (!key) {
          this.addDHTLogEntry('❌ Error: Key is required');
          this.addDHTLogEntry(`   Debug: key="${key}"`);
          return;
        }

        if (!this.mesh.isDHTEnabled()) {
          this.addDHTLogEntry('❌ Error: WebDHT is disabled');
          return;
        }

        try {
          this.addDHTLogEntry(`🔍 Fetching from ORIGINAL STORING PEERS: ${key}`);
          this.addDHTLogEntry('   📡 Bypassing local cache to ensure fresh data');

          // Force fresh retrieval from original storing peers
          const value = await this.mesh.dhtGet(key, { forceRefresh: true });
          if (value !== null) {
            this.addDHTLogEntry(`📥 Retrieved from original peers: ${key} = ${JSON.stringify(value)}`);
            this.addDHTLogEntry('   ✅ Data is FRESH from authoritative source');
            if (dhtValue) {
              dhtValue.value = typeof value === 'string' ? value : JSON.stringify(value);
            }

            // Auto-subscribe to the key we just retrieved for future updates
            try {
              await this.mesh.dhtSubscribe(key);
              this.addDHTLogEntry(`🔔 Auto-subscribed for future updates: ${key}`);
              this.addDHTLogEntry('   📡 Will receive notifications when original peers update this key');
            } catch (subscribeError) {
              this.addDHTLogEntry(`⚠️ Failed to auto-subscribe to ${key}: ${subscribeError.message}`);
            }
          } else {
            this.addDHTLogEntry(`❌ Not found on original storing peers: ${key}`);
            this.addDHTLogEntry('   💡 Key may not exist or all original storing peers are offline');
          }
        } catch (error) {
          this.addDHTLogEntry(`❌ Error retrieving ${key}: ${error.message}`);
        }
      });
    }

    // Subscribe to DHT key
    if (dhtSubscribeBtn) {
      dhtSubscribeBtn.addEventListener('click', async () => {
        // Use the dedicated subscription key field
        const key = dhtSubscribeKey?.value?.trim();

        if (!key) {
          this.addDHTLogEntry('❌ Error: Key is required for subscription');
          return;
        }

        if (!this.mesh.isDHTEnabled()) {
          this.addDHTLogEntry('❌ Error: WebDHT is disabled');
          return;
        }

        try {
          this.addDHTLogEntry(`🔔 Explicitly subscribing to key: ${key}`);
          this.addDHTLogEntry('   📡 Will receive notifications when original storing peers update this key');

          const value = await this.mesh.dhtSubscribe(key);
          this.addDHTLogEntry(`✅ Subscribed to: ${key}`);
          if (value !== null) {
            this.addDHTLogEntry(`   Current value from original storing peers: ${JSON.stringify(value)}`);
          } else {
            this.addDHTLogEntry('   No current value found on original storing peers');
          }

          // Clear the subscription key field after successful subscription
          if (dhtSubscribeKey) {
            dhtSubscribeKey.value = '';
          }
        } catch (error) {
          this.addDHTLogEntry(`❌ Error subscribing to ${key}: ${error.message}`);
        }
      });
    }

    // Unsubscribe from DHT key
    if (dhtUnsubscribeBtn) {
      dhtUnsubscribeBtn.addEventListener('click', async () => {
        // Use the dedicated subscription key field
        const key = dhtSubscribeKey?.value?.trim();

        if (!key) {
          this.addDHTLogEntry('❌ Error: Key is required for unsubscription');
          return;
        }

        if (!this.mesh.isDHTEnabled()) {
          this.addDHTLogEntry('❌ Error: WebDHT is disabled');
          return;
        }

        try {
          await this.mesh.dhtUnsubscribe(key);
          this.addDHTLogEntry(`🔕 Unsubscribed from: ${key}`);

          // Clear the subscription key field after successful unsubscription
          if (dhtSubscribeKey) {
            dhtSubscribeKey.value = '';
          }
        } catch (error) {
          this.addDHTLogEntry(`❌ Error unsubscribing from ${key}: ${error.message}`);
        }
      });
    }
  }

  setupStorageControls() {
    // Ensure storage section starts collapsed with robust hiding
    const storageSection = document.querySelector('.storage');
    const storageToggle = document.getElementById('storage-toggle');
    const storageContent = document.getElementById('storage-content');

    if (storageSection && storageToggle && storageContent) {
      // Force initial collapsed state with multiple approaches
      storageSection.setAttribute('aria-expanded', 'false');
      storageToggle.setAttribute('aria-expanded', 'false');

      // Use multiple ways to hide the content
      storageContent.style.display = 'none';
      storageContent.style.visibility = 'hidden';
      storageContent.style.maxHeight = '0';
      storageContent.style.overflow = 'hidden';
      storageContent.classList.add('collapsed');

      // Ensure the toggle button shows collapsed state
      if (storageToggle.textContent && !storageToggle.textContent.includes('▶')) {
        storageToggle.textContent = storageToggle.textContent.replace('▼', '▶');
      }
    }

    // Enable/Disable Storage
    const storageEnableBtn = document.getElementById('storage-enable-btn');
    const storageDisableBtn = document.getElementById('storage-disable-btn');
    const storageClearBtn = document.getElementById('storage-clear-btn');

    if (storageEnableBtn) {
      storageEnableBtn.addEventListener('click', async () => {
        try {
          if (!this.mesh.distributedStorage) {
            this.addStorageLogEntry('❌ Error: Distributed storage not available');
            return;
          }

          await this.mesh.distributedStorage.enable();
          this.addStorageLogEntry('✅ Distributed storage enabled');
          this.updateStorageStatus();
        } catch (error) {
          this.addStorageLogEntry(`❌ Error enabling storage: ${error.message}`);
        }
      });
    }

    if (storageDisableBtn) {
      storageDisableBtn.addEventListener('click', async () => {
        try {
          if (!this.mesh.distributedStorage) {
            this.addStorageLogEntry('❌ Error: Distributed storage not available');
            return;
          }

          await this.mesh.distributedStorage.disable();
          this.addStorageLogEntry('⚠️ Distributed storage disabled');
          this.updateStorageStatus();
        } catch (error) {
          this.addStorageLogEntry(`❌ Error disabling storage: ${error.message}`);
        }
      });
    }

    if (storageClearBtn) {
      storageClearBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to clear all stored data? This cannot be undone.')) {
          return;
        }

        try {
          if (!this.mesh.distributedStorage) {
            this.addStorageLogEntry('❌ Error: Distributed storage not available');
            return;
          }

          await this.mesh.distributedStorage.clear();
          this.addStorageLogEntry('🗑️ All stored data cleared');
          this.updateStorageStatus();
        } catch (error) {
          this.addStorageLogEntry(`❌ Error clearing storage: ${error.message}`);
        }
      });
    }

    // Store Data
    const storageStoreBtn = document.getElementById('storage-store-btn');
    const storageUpdateBtn = document.getElementById('storage-update-btn');

    if (storageStoreBtn) {
      storageStoreBtn.addEventListener('click', async () => {
        await this.handleStorageStore(false);
      });
    }

    if (storageUpdateBtn) {
      storageUpdateBtn.addEventListener('click', async () => {
        await this.handleStorageStore(true);
      });
    }

    // Retrieve Data
    const storageGetBtn = document.getElementById('storage-get-btn');
    const storageDeleteBtn = document.getElementById('storage-delete-btn');

    if (storageGetBtn) {
      storageGetBtn.addEventListener('click', async () => {
        const key = document.getElementById('storage-get-key')?.value?.trim();

        if (!key) {
          this.addStorageLogEntry('❌ Error: Key is required');
          return;
        }

        try {
          if (!this.mesh.distributedStorage) {
            this.addStorageLogEntry('❌ Error: Distributed storage not available');
            return;
          }

          const result = await this.mesh.distributedStorage.retrieve(key);
          if (result !== null) {
            this.addStorageLogEntry(`📋 Retrieved: ${key} = ${JSON.stringify(result)}`);

            // Get key info for metadata display
            try {
              const keyInfo = await this.mesh.distributedStorage.getKeyInfo(key);
              if (keyInfo) {
                this.addStorageLogEntry(`   Metadata: public=${keyInfo.isPublic}, immutable=${keyInfo.isImmutable}, owner=${keyInfo.owner?.substring(0, 8)}...`);
                this.addStorageLogEntry(`   Created: ${new Date(keyInfo.createdAt).toLocaleString()}`);
              }
            } catch (metaError) {
              // Metadata display is optional, don't fail the retrieval
              this.debug.warn('Could not get metadata for display:', metaError);
            }
          } else {
            this.addStorageLogEntry(`❌ Key not found or access denied: ${key}`);
          }
        } catch (error) {
          this.addStorageLogEntry(`❌ Error retrieving ${key}: ${error.message}`);
        }
      });
    }

    if (storageDeleteBtn) {
      storageDeleteBtn.addEventListener('click', async () => {
        const key = document.getElementById('storage-get-key')?.value?.trim();

        if (!key) {
          this.addStorageLogEntry('❌ Error: Key is required');
          return;
        }

        if (!confirm(`Are you sure you want to delete "${key}"? This cannot be undone.`)) {
          return;
        }

        try {
          if (!this.mesh.distributedStorage) {
            this.addStorageLogEntry('❌ Error: Distributed storage not available');
            return;
          }

          const success = await this.mesh.distributedStorage.delete(key);
          if (success) {
            this.addStorageLogEntry(`🗑️ Deleted: ${key}`);
            this.updateStorageStatus();
          } else {
            this.addStorageLogEntry(`❌ Failed to delete: ${key}`);
          }
        } catch (error) {
          this.addStorageLogEntry(`❌ Error deleting ${key}: ${error.message}`);
        }
      });
    }

    // Access Control
    const storageGrantAccessBtn = document.getElementById('storage-grant-access-btn');
    const storageRevokeAccessBtn = document.getElementById('storage-revoke-access-btn');

    if (storageGrantAccessBtn) {
      storageGrantAccessBtn.addEventListener('click', async () => {
        const key = document.getElementById('storage-access-key')?.value?.trim();
        const peerId = document.getElementById('storage-access-peer')?.value?.trim();
        const level = document.getElementById('storage-access-level')?.value;

        if (!key || !peerId) {
          this.addStorageLogEntry('❌ Error: Key and peer ID are required');
          return;
        }

        try {
          if (!this.mesh.distributedStorage) {
            this.addStorageLogEntry('❌ Error: Distributed storage not available');
            return;
          }

          const success = await this.mesh.distributedStorage.grantAccess(key, peerId, level);
          if (success) {
            this.addStorageLogEntry(`✅ Granted ${level} access to ${peerId.substring(0, 8)}... for key: ${key}`);
          } else {
            this.addStorageLogEntry('❌ Failed to grant access');
          }
        } catch (error) {
          this.addStorageLogEntry(`❌ Error granting access: ${error.message}`);
        }
      });
    }

    if (storageRevokeAccessBtn) {
      storageRevokeAccessBtn.addEventListener('click', async () => {
        const key = document.getElementById('storage-revoke-key')?.value?.trim();
        const peerId = document.getElementById('storage-revoke-peer')?.value?.trim();

        if (!key || !peerId) {
          this.addStorageLogEntry('❌ Error: Key and peer ID are required');
          return;
        }

        try {
          if (!this.mesh.distributedStorage) {
            this.addStorageLogEntry('❌ Error: Distributed storage not available');
            return;
          }

          const success = await this.mesh.distributedStorage.revokeAccess(key, peerId);
          if (success) {
            this.addStorageLogEntry(`✅ Revoked access from ${peerId.substring(0, 8)}... for key: ${key}`);
          } else {
            this.addStorageLogEntry('❌ Failed to revoke access');
          }
        } catch (error) {
          this.addStorageLogEntry(`❌ Error revoking access: ${error.message}`);
        }
      });
    }

    // Bulk Operations
    const storageListBtn = document.getElementById('storage-list-btn');
    const storageBulkDeleteBtn = document.getElementById('storage-bulk-delete-btn');

    if (storageListBtn) {
      storageListBtn.addEventListener('click', async () => {
        const prefix = document.getElementById('storage-prefix')?.value?.trim() || '';

        try {
          if (!this.mesh.distributedStorage) {
            this.addStorageLogEntry('❌ Error: Distributed storage not available');
            return;
          }

          const keys = await this.mesh.distributedStorage.listKeys(prefix);
          if (keys.length > 0) {
            this.addStorageLogEntry(`📋 Found ${keys.length} keys with prefix "${prefix}":`);
            keys.forEach(key => {
              this.addStorageLogEntry(`   • ${key}`);
            });
          } else {
            this.addStorageLogEntry(`❌ No keys found with prefix "${prefix}"`);
          }
        } catch (error) {
          this.addStorageLogEntry(`❌ Error listing keys: ${error.message}`);
        }
      });
    }

    if (storageBulkDeleteBtn) {
      storageBulkDeleteBtn.addEventListener('click', async () => {
        const prefix = document.getElementById('storage-prefix')?.value?.trim();

        if (!prefix) {
          this.addStorageLogEntry('❌ Error: Prefix is required for bulk delete');
          return;
        }

        if (!confirm(`Are you sure you want to delete all keys with prefix "${prefix}"? This cannot be undone.`)) {
          return;
        }

        try {
          if (!this.mesh.distributedStorage) {
            this.addStorageLogEntry('❌ Error: Distributed storage not available');
            return;
          }

          const count = await this.mesh.distributedStorage.bulkDelete(prefix);
          this.addStorageLogEntry(`🗑️ Bulk deleted ${count} keys with prefix "${prefix}"`);
          this.updateStorageStatus();
        } catch (error) {
          this.addStorageLogEntry(`❌ Error bulk deleting: ${error.message}`);
        }
      });
    }

    // Search
    const storageSearchBtn = document.getElementById('storage-search-btn');

    if (storageSearchBtn) {
      storageSearchBtn.addEventListener('click', async () => {
        const query = document.getElementById('storage-search-query')?.value?.trim();
        const type = document.getElementById('storage-search-type')?.value || 'key';

        if (!query) {
          this.addStorageLogEntry('❌ Error: Search query is required');
          return;
        }

        try {
          if (!this.mesh.distributedStorage) {
            this.addStorageLogEntry('❌ Error: Distributed storage not available');
            return;
          }

          const results = await this.mesh.distributedStorage.search(query, type);
          if (results.length > 0) {
            this.addStorageLogEntry(`🔍 Found ${results.length} results for "${query}" in ${type}:`);
            results.forEach(result => {
              this.addStorageLogEntry(`   • ${result.key}: ${JSON.stringify(result.value).substring(0, 100)}...`);
            });
          } else {
            this.addStorageLogEntry(`❌ No results found for "${query}" in ${type}`);
          }
        } catch (error) {
          this.addStorageLogEntry(`❌ Error searching: ${error.message}`);
        }
      });
    }

    // Backup/Restore
    const storageBackupBtn = document.getElementById('storage-backup-btn');
    const storageRestoreBtn = document.getElementById('storage-restore-btn');
    const storageRestoreFile = document.getElementById('storage-restore-file');

    if (storageBackupBtn) {
      storageBackupBtn.addEventListener('click', async () => {
        try {
          if (!this.mesh.distributedStorage) {
            this.addStorageLogEntry('❌ Error: Distributed storage not available');
            return;
          }

          const backup = await this.mesh.distributedStorage.backup();
          const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);

          const a = document.createElement('a');
          a.href = url;
          a.download = `peerpigeon-storage-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
          a.click();

          URL.revokeObjectURL(url);
          this.addStorageLogEntry(`💾 Backup created with ${backup.items.length} items`);
        } catch (error) {
          this.addStorageLogEntry(`❌ Error creating backup: ${error.message}`);
        }
      });
    }

    if (storageRestoreBtn) {
      storageRestoreBtn.addEventListener('click', () => {
        storageRestoreFile?.click();
      });
    }

    if (storageRestoreFile) {
      storageRestoreFile.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const text = await file.text();
          const backup = JSON.parse(text);

          if (!this.mesh.distributedStorage) {
            this.addStorageLogEntry('❌ Error: Distributed storage not available');
            return;
          }

          const result = await this.mesh.distributedStorage.restore(backup);
          this.addStorageLogEntry(`📥 Restored ${result.restored} items (${result.failed} failed)`);
          this.updateStorageStatus();
        } catch (error) {
          this.addStorageLogEntry(`❌ Error restoring backup: ${error.message}`);
        }

        // Clear the file input
        e.target.value = '';
      });
    }

    // Setup Lexical Storage Interface
    this.setupLexicalStorageControls();
  }

  setupLexicalStorageControls() {
    // Chain Operations
    const lexicalPutBtn = document.getElementById('lexical-put-btn');
    const lexicalGetBtn = document.getElementById('lexical-get-btn');
    const lexicalValBtn = document.getElementById('lexical-val-btn');
    const lexicalUpdateBtn = document.getElementById('lexical-update-btn');
    const lexicalDeleteBtn = document.getElementById('lexical-delete-btn');

    // Set Operations
    const lexicalSetBtn = document.getElementById('lexical-set-btn');
    const lexicalMapBtn = document.getElementById('lexical-map-btn');

    // Property Access
    const lexicalProxySetBtn = document.getElementById('lexical-proxy-set-btn');
    const lexicalProxyGetBtn = document.getElementById('lexical-proxy-get-btn');

    // Utility Operations
    const lexicalExistsBtn = document.getElementById('lexical-exists-btn');
    const lexicalKeysBtn = document.getElementById('lexical-keys-btn');
    const lexicalPathBtn = document.getElementById('lexical-path-btn');

    // Chain Operations Event Handlers
    if (lexicalPutBtn) {
      lexicalPutBtn.addEventListener('click', async () => {
        const path = document.getElementById('lexical-path')?.value?.trim();
        const data = document.getElementById('lexical-data')?.value?.trim();

        if (!path || !data) {
          this.addLexicalLogEntry('❌ Error: Both path and data are required');
          return;
        }

        try {
          const parsedData = JSON.parse(data);
          const lex = this.mesh.distributedStorage.lexical();
          const pathParts = path.split('.');

          let current = lex;
          for (const part of pathParts) {
            current = current.get(part);
          }

          await current.put(parsedData);
          this.addLexicalLogEntry(`✅ Put data at path: ${path}`);
        } catch (error) {
          this.addLexicalLogEntry(`❌ Error: ${error.message}`);
        }
      });
    }

    if (lexicalGetBtn) {
      lexicalGetBtn.addEventListener('click', async () => {
        const path = document.getElementById('lexical-path')?.value?.trim();
        const property = document.getElementById('lexical-property')?.value?.trim();

        if (!path || !property) {
          this.addLexicalLogEntry('❌ Error: Both path and property are required');
          return;
        }

        try {
          const lex = this.mesh.distributedStorage.lexical();
          const pathParts = path.split('.');

          let current = lex;
          for (const part of pathParts) {
            current = current.get(part);
          }

          const value = await current.get(property).val();
          this.addLexicalLogEntry(`📄 ${path}.${property}: ${JSON.stringify(value)}`);
        } catch (error) {
          this.addLexicalLogEntry(`❌ Error: ${error.message}`);
        }
      });
    }

    if (lexicalValBtn) {
      lexicalValBtn.addEventListener('click', async () => {
        const path = document.getElementById('lexical-path')?.value?.trim();

        if (!path) {
          this.addLexicalLogEntry('❌ Error: Path is required');
          return;
        }

        try {
          const lex = this.mesh.distributedStorage.lexical();
          const pathParts = path.split('.');

          let current = lex;
          for (const part of pathParts) {
            current = current.get(part);
          }

          const value = await current.val();
          this.addLexicalLogEntry(`📄 Full object at ${path}: ${JSON.stringify(value, null, 2)}`);
        } catch (error) {
          this.addLexicalLogEntry(`❌ Error: ${error.message}`);
        }
      });
    }

    if (lexicalUpdateBtn) {
      lexicalUpdateBtn.addEventListener('click', async () => {
        const path = document.getElementById('lexical-path')?.value?.trim();
        const data = document.getElementById('lexical-data')?.value?.trim();

        if (!path || !data) {
          this.addLexicalLogEntry('❌ Error: Both path and data are required');
          return;
        }

        try {
          const parsedData = JSON.parse(data);
          const lex = this.mesh.distributedStorage.lexical();
          const pathParts = path.split('.');

          let current = lex;
          for (const part of pathParts) {
            current = current.get(part);
          }

          await current.update(parsedData);
          this.addLexicalLogEntry(`✅ Updated data at path: ${path}`);
        } catch (error) {
          this.addLexicalLogEntry(`❌ Error: ${error.message}`);
        }
      });
    }

    if (lexicalDeleteBtn) {
      lexicalDeleteBtn.addEventListener('click', async () => {
        const path = document.getElementById('lexical-path')?.value?.trim();

        if (!path) {
          this.addLexicalLogEntry('❌ Error: Path is required');
          return;
        }

        try {
          const lex = this.mesh.distributedStorage.lexical();
          const pathParts = path.split('.');

          let current = lex;
          for (const part of pathParts) {
            current = current.get(part);
          }

          await current.delete();
          this.addLexicalLogEntry(`✅ Deleted data at path: ${path}`);
        } catch (error) {
          this.addLexicalLogEntry(`❌ Error: ${error.message}`);
        }
      });
    }

    // Set Operations Event Handlers
    if (lexicalSetBtn) {
      lexicalSetBtn.addEventListener('click', async () => {
        const path = document.getElementById('lexical-set-path')?.value?.trim();
        const data = document.getElementById('lexical-set-data')?.value?.trim();

        if (!path || !data) {
          this.addLexicalLogEntry('❌ Error: Both path and data are required');
          return;
        }

        try {
          const parsedData = JSON.parse(data);
          const lex = this.mesh.distributedStorage.lexical();
          const pathParts = path.split('.');

          let current = lex;
          for (const part of pathParts) {
            current = current.get(part);
          }

          await current.set(parsedData);
          this.addLexicalLogEntry(`✅ Set data at path: ${path}`);
        } catch (error) {
          this.addLexicalLogEntry(`❌ Error: ${error.message}`);
        }
      });
    }

    if (lexicalMapBtn) {
      lexicalMapBtn.addEventListener('click', async () => {
        const path = document.getElementById('lexical-set-path')?.value?.trim();

        if (!path) {
          this.addLexicalLogEntry('❌ Error: Path is required');
          return;
        }

        try {
          const lex = this.mesh.distributedStorage.lexical();
          const pathParts = path.split('.');

          let current = lex;
          for (const part of pathParts) {
            current = current.get(part);
          }

          const mapResults = [];
          const unsubscribe = current.map().on((value, key) => {
            mapResults.push({ key, value });
            this.addLexicalLogEntry(`🗺️ Map result - ${key}: ${JSON.stringify(value)}`);
          });

          // Stop mapping after a short delay
          setTimeout(() => {
            if (unsubscribe) unsubscribe();
            this.addLexicalLogEntry(`✅ Map operation completed with ${mapResults.length} results`);
          }, 1000);
        } catch (error) {
          this.addLexicalLogEntry(`❌ Error: ${error.message}`);
        }
      });
    }

    // Property Access Event Handlers
    if (lexicalProxySetBtn) {
      lexicalProxySetBtn.addEventListener('click', async () => {
        const path = document.getElementById('lexical-proxy-path')?.value?.trim();
        const value = document.getElementById('lexical-proxy-value')?.value?.trim();

        if (!path || !value) {
          this.addLexicalLogEntry('❌ Error: Both path and value are required');
          return;
        }

        try {
          const lex = this.mesh.distributedStorage.lexical();
          const pathParts = path.split('.');

          // Use proxy property access
          let current = lex;
          for (const part of pathParts.slice(0, -1)) {
            current = current[part];
          }

          const lastPart = pathParts[pathParts.length - 1];
          await current[lastPart].put(value);

          this.addLexicalLogEntry(`✅ Set via proxy: ${path} = ${value}`);
        } catch (error) {
          this.addLexicalLogEntry(`❌ Error: ${error.message}`);
        }
      });
    }

    if (lexicalProxyGetBtn) {
      lexicalProxyGetBtn.addEventListener('click', async () => {
        const path = document.getElementById('lexical-proxy-path')?.value?.trim();

        if (!path) {
          this.addLexicalLogEntry('❌ Error: Path is required');
          return;
        }

        try {
          const lex = this.mesh.distributedStorage.lexical();
          const pathParts = path.split('.');

          // Use proxy property access
          let current = lex;
          for (const part of pathParts.slice(0, -1)) {
            current = current[part];
          }

          const lastPart = pathParts[pathParts.length - 1];
          const value = await current[lastPart].val();

          this.addLexicalLogEntry(`📄 Proxy get ${path}: ${JSON.stringify(value)}`);
        } catch (error) {
          this.addLexicalLogEntry(`❌ Error: ${error.message}`);
        }
      });
    }

    // Utility Operations Event Handlers
    if (lexicalExistsBtn) {
      lexicalExistsBtn.addEventListener('click', async () => {
        const path = document.getElementById('lexical-util-path')?.value?.trim();

        if (!path) {
          this.addLexicalLogEntry('❌ Error: Path is required');
          return;
        }

        try {
          const lex = this.mesh.distributedStorage.lexical();
          const pathParts = path.split('.');

          let current = lex;
          for (const part of pathParts) {
            current = current.get(part);
          }

          const exists = await current.exists();
          this.addLexicalLogEntry(`🔍 ${path} exists: ${exists}`);
        } catch (error) {
          this.addLexicalLogEntry(`❌ Error: ${error.message}`);
        }
      });
    }

    if (lexicalKeysBtn) {
      lexicalKeysBtn.addEventListener('click', async () => {
        const path = document.getElementById('lexical-util-path')?.value?.trim();

        if (!path) {
          this.addLexicalLogEntry('❌ Error: Path is required');
          return;
        }

        try {
          const lex = this.mesh.distributedStorage.lexical();
          const pathParts = path.split('.');

          let current = lex;
          for (const part of pathParts) {
            current = current.get(part);
          }

          const keys = await current.keys();
          this.addLexicalLogEntry(`🔑 Keys at ${path}: [${keys.join(', ')}]`);
        } catch (error) {
          this.addLexicalLogEntry(`❌ Error: ${error.message}`);
        }
      });
    }

    if (lexicalPathBtn) {
      lexicalPathBtn.addEventListener('click', async () => {
        const path = document.getElementById('lexical-util-path')?.value?.trim();

        if (!path) {
          this.addLexicalLogEntry('❌ Error: Path is required');
          return;
        }

        try {
          const lex = this.mesh.distributedStorage.lexical();
          const pathParts = path.split('.');

          let current = lex;
          for (const part of pathParts) {
            current = current.get(part);
          }

          const fullPath = current.getPath();
          this.addLexicalLogEntry(`🛤️ Full storage path: ${fullPath}`);
        } catch (error) {
          this.addLexicalLogEntry(`❌ Error: ${error.message}`);
        }
      });
    }
  }

  async handleStorageStore(isUpdate = false) {
    const key = document.getElementById('storage-key')?.value?.trim();
    const value = document.getElementById('storage-value')?.value?.trim();
    const encrypt = document.getElementById('storage-encrypt')?.checked ?? true;
    const isPublic = document.getElementById('storage-public')?.checked ?? false;
    const immutable = document.getElementById('storage-immutable')?.checked ?? false;
    const enableCrdt = document.getElementById('storage-crdt')?.checked ?? false;
    const ttl = parseInt(document.getElementById('storage-ttl')?.value) || 0;

    if (!key || !value) {
      this.addStorageLogEntry('❌ Error: Both key and value are required');
      return;
    }

    try {
      if (!this.mesh.distributedStorage) {
        this.addStorageLogEntry('❌ Error: Distributed storage not available');
        return;
      }

      let parsedValue;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value; // Use as string if not valid JSON
      }

      const options = {
        encrypt,
        isPublic,
        isImmutable: immutable,
        enableCRDT: enableCrdt,
        ttl: ttl > 0 ? ttl * 1000 : undefined // Convert to milliseconds
      };

      let success;
      if (isUpdate) {
        success = await this.mesh.distributedStorage.update(key, parsedValue, options);
        if (success) {
          this.addStorageLogEntry(`🔄 Updated: ${key} = ${JSON.stringify(parsedValue)}`);
        } else {
          this.addStorageLogEntry(`❌ Failed to update: ${key}`);
        }
      } else {
        success = await this.mesh.distributedStorage.store(key, parsedValue, options);
        if (success) {
          this.addStorageLogEntry(`💾 Stored: ${key} = ${JSON.stringify(parsedValue)}`);
        } else {
          this.addStorageLogEntry(`❌ Failed to store: ${key}`);
        }
      }

      if (success) {
        const optionsStr = [];
        if (encrypt) optionsStr.push('encrypted');
        if (isPublic) optionsStr.push('public');
        if (immutable) optionsStr.push('immutable');
        if (enableCrdt) optionsStr.push('CRDT');
        if (ttl > 0) optionsStr.push(`TTL: ${ttl}s`);

        if (optionsStr.length > 0) {
          this.addStorageLogEntry(`   Options: ${optionsStr.join(', ')}`);
        }

        this.updateStorageStatus();
      }
    } catch (error) {
      this.addStorageLogEntry(`❌ Error ${isUpdate ? 'updating' : 'storing'} ${key}: ${error.message}`);
    }
  }

  addStorageLogEntry(message) {
    const logElement = document.getElementById('storage-log');
    if (!logElement) return;

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;

    logElement.appendChild(entry);
    logElement.scrollTop = logElement.scrollHeight;

    // Keep only last 100 entries
    while (logElement.children.length > 100) {
      logElement.removeChild(logElement.firstChild);
    }
  }

  addLexicalLogEntry(message) {
    const logElement = document.getElementById('lexical-log');
    if (!logElement) return;

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;

    logElement.appendChild(entry);
    logElement.scrollTop = logElement.scrollHeight;

    // Keep only last 100 entries
    while (logElement.children.length > 100) {
      logElement.removeChild(logElement.firstChild);
    }
  }

  updateStorageStatus() {
    if (!this.mesh.distributedStorage) {
      document.getElementById('storage-status').textContent = 'Not Available';
      document.getElementById('storage-item-count').textContent = '0';
      document.getElementById('storage-total-size').textContent = '0 bytes';
      return;
    }

    const isEnabled = this.mesh.distributedStorage.isEnabled();
    document.getElementById('storage-status').textContent = isEnabled ? 'Enabled' : 'Disabled';

    // Get storage stats if available
    this.mesh.distributedStorage.getStats().then(stats => {
      document.getElementById('storage-item-count').textContent = stats.itemCount.toString();
      document.getElementById('storage-total-size').textContent = this.formatBytes(stats.totalSize);
    }).catch(() => {
      document.getElementById('storage-item-count').textContent = '0';
      document.getElementById('storage-total-size').textContent = '0 bytes';
    });

    // Get persistent storage stats if available
    if (this.mesh.distributedStorage.getStorageStats) {
      this.mesh.distributedStorage.getStorageStats().then(persistentStats => {
        // Update storage type display
        const storageTypeElement = document.getElementById('storage-type');
        if (storageTypeElement) {
          storageTypeElement.textContent = persistentStats.type;
        }

        // Update persistent storage stats
        const persistentKeysElement = document.getElementById('storage-persistent-keys');
        if (persistentKeysElement) {
          persistentKeysElement.textContent = persistentStats.keys.toString();
        }

        const persistentSizeElement = document.getElementById('storage-persistent-size');
        if (persistentSizeElement) {
          persistentSizeElement.textContent = this.formatBytes(persistentStats.estimatedSize || 0);
        }
      }).catch(error => {
        this.debug.warn('Failed to get persistent storage stats:', error);
      });
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 bytes';
    const k = 1024;
    const sizes = ['bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  setupCryptoControls() {
    // Key Management Controls
    const generateBtn = document.getElementById('crypto-generate-btn');
    const resetBtn = document.getElementById('crypto-reset-btn');
    const selfTestBtn = document.getElementById('crypto-self-test-btn');

    // User Authentication Controls
    const loginBtn = document.getElementById('crypto-login-btn');
    const aliasInput = document.getElementById('crypto-alias');
    const passwordInput = document.getElementById('crypto-password');

    // Messaging Controls
    const testMessageInput = document.getElementById('crypto-test-message');
    const testPeerInput = document.getElementById('crypto-test-peer');
    const sendEncryptedBtn = document.getElementById('crypto-send-encrypted-btn');

    // Group Encryption Controls
    const groupIdInput = document.getElementById('crypto-group-id');
    const createGroupBtn = document.getElementById('crypto-create-group-btn');
    const groupMessageInput = document.getElementById('crypto-group-message');
    const groupSelect = document.getElementById('crypto-group-select');
    const sendGroupBtn = document.getElementById('crypto-send-group-btn');

    // Advanced Controls
    const exportKeyBtn = document.getElementById('crypto-export-key-btn');
    const importPeerKeyBtn = document.getElementById('crypto-import-peer-key-btn');
    const benchmarkBtn = document.getElementById('crypto-benchmark-btn');

    // Import Form Controls
    const importForm = document.getElementById('crypto-import-form');
    const importPeerIdInput = document.getElementById('crypto-import-peer-id');
    const importPublicKeyInput = document.getElementById('crypto-import-public-key');
    const importConfirmBtn = document.getElementById('crypto-import-confirm-btn');
    const importCancelBtn = document.getElementById('crypto-import-cancel-btn');

    // Key Management Event Handlers
    if (generateBtn) {
      generateBtn.addEventListener('click', async () => {
        try {
          this.addCryptoTestResult('🔄 Generating new keypair...', 'info');
          await this.mesh.initCrypto({ generateKeypair: true });
          this.addCryptoTestResult('✅ New keypair generated successfully', 'success');
          this.updateCryptoStatus();
        } catch (error) {
          this.addCryptoTestResult(`❌ Failed to generate keypair: ${error.message}`, 'error');
        }
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('This will clear all crypto keys and reset the crypto system. Continue?')) {
          try {
            this.mesh.resetCrypto();
            this.addCryptoTestResult('✅ Crypto system reset', 'success');
            this.updateCryptoStatus();
            this.clearCryptoTestResults();
          } catch (error) {
            this.addCryptoTestResult(`❌ Failed to reset crypto: ${error.message}`, 'error');
          }
        }
      });
    }

    if (selfTestBtn) {
      selfTestBtn.addEventListener('click', async () => {
        try {
          this.addCryptoTestResult('🔄 Running crypto self-tests...', 'info');
          const results = await this.mesh.runCryptoTests();

          // Handle the actual format returned by CryptoManager
          if (results.keypairGeneration !== undefined) {
            const status = results.keypairGeneration ? '✅' : '❌';
            const type = results.keypairGeneration ? 'success' : 'error';
            this.addCryptoTestResult(`${status} keypairGeneration: ${results.keypairGeneration}`, type);
          }

          if (results.encryption !== undefined) {
            const status = results.encryption ? '✅' : '❌';
            const type = results.encryption ? 'success' : 'error';
            this.addCryptoTestResult(`${status} encryption: ${results.encryption}`, type);
          }

          if (results.decryption !== undefined) {
            const status = results.decryption ? '✅' : '❌';
            const type = results.decryption ? 'success' : 'error';
            this.addCryptoTestResult(`${status} decryption: ${results.decryption}`, type);
          }

          if (results.signing !== undefined) {
            const status = results.signing ? '✅' : '❌';
            const type = results.signing ? 'success' : 'error';
            this.addCryptoTestResult(`${status} signing: ${results.signing}`, type);
          }

          if (results.verification !== undefined) {
            const status = results.verification ? '✅' : '❌';
            const type = results.verification ? 'success' : 'error';
            this.addCryptoTestResult(`${status} verification: ${results.verification}`, type);
          }

          if (results.groupEncryption !== undefined) {
            const status = results.groupEncryption ? '✅' : '❌';
            const type = results.groupEncryption ? 'success' : 'error';
            this.addCryptoTestResult(`${status} groupEncryption: ${results.groupEncryption}`, type);
          }

          if (results.errors && results.errors.length > 0) {
            results.errors.forEach(error => {
              this.addCryptoTestResult(`❌ errors: ${error}`, 'error');
            });
          }
        } catch (error) {
          this.addCryptoTestResult(`❌ Self-test failed: ${error.message}`, 'error');
        }
      });
    }

    // User Authentication Event Handlers
    if (loginBtn && aliasInput && passwordInput) {
      loginBtn.addEventListener('click', async () => {
        const alias = aliasInput.value.trim();
        const password = passwordInput.value.trim();

        if (!alias || !password) {
          this.addCryptoTestResult('❌ Both alias and password are required', 'error');
          return;
        }

        try {
          this.addCryptoTestResult(`🔄 Authenticating as ${alias}...`, 'info');
          await this.mesh.initCrypto({ alias, password });
          this.addCryptoTestResult(`✅ Authenticated as ${alias}`, 'success');
          this.updateCryptoStatus();

          // Clear password for security
          passwordInput.value = '';
        } catch (error) {
          this.addCryptoTestResult(`❌ Authentication failed: ${error.message}`, 'error');
        }
      });
    }

    // Messaging Event Handlers
    if (sendEncryptedBtn && testMessageInput && testPeerInput) {
      sendEncryptedBtn.addEventListener('click', async () => {
        const message = testMessageInput.value.trim();
        const peerId = testPeerInput.value.trim();

        if (!message) {
          this.addCryptoTestResult('❌ Message is required', 'error');
          return;
        }

        if (!peerId) {
          this.addCryptoTestResult('❌ Target peer ID is required', 'error');
          return;
        }

        try {
          this.addCryptoTestResult(`🔄 Sending encrypted message to ${peerId.substring(0, 8)}...`, 'info');
          await this.mesh.sendEncryptedMessage(peerId, message);
          this.addCryptoTestResult('✅ Encrypted message sent', 'success');
          testMessageInput.value = '';
        } catch (error) {
          this.addCryptoTestResult(`❌ Failed to send encrypted message: ${error.message}`, 'error');
        }
      });
    }

    // Group Encryption Event Handlers
    if (createGroupBtn && groupIdInput) {
      createGroupBtn.addEventListener('click', async () => {
        const groupId = groupIdInput.value.trim();

        if (!groupId) {
          this.addCryptoTestResult('❌ Group ID is required', 'error');
          return;
        }

        try {
          this.addCryptoTestResult(`🔄 Creating group key for ${groupId}...`, 'info');
          await this.mesh.generateGroupKey(groupId);
          this.addCryptoTestResult(`✅ Group key created for ${groupId}`, 'success');
          this.updateGroupSelect();
          groupIdInput.value = '';
        } catch (error) {
          this.addCryptoTestResult(`❌ Failed to create group key: ${error.message}`, 'error');
        }
      });
    }

    if (sendGroupBtn && groupMessageInput && groupSelect) {
      sendGroupBtn.addEventListener('click', async () => {
        const message = groupMessageInput.value.trim();
        const groupId = groupSelect.value;

        if (!message) {
          this.addCryptoTestResult('❌ Group message is required', 'error');
          return;
        }

        if (!groupId) {
          this.addCryptoTestResult('❌ Please select a group', 'error');
          return;
        }

        try {
          this.addCryptoTestResult(`🔄 Sending encrypted group message to ${groupId}...`, 'info');
          await this.mesh.sendEncryptedBroadcast(message, groupId);
          this.addCryptoTestResult('✅ Encrypted group message sent', 'success');
          groupMessageInput.value = '';
        } catch (error) {
          this.addCryptoTestResult(`❌ Failed to send group message: ${error.message}`, 'error');
        }
      });
    }

    // Advanced Controls Event Handlers
    if (exportKeyBtn) {
      exportKeyBtn.addEventListener('click', () => {
        try {
          const keyData = this.mesh.exportPublicKey();
          if (keyData) {
            const exportText = JSON.stringify(keyData, null, 2);
            navigator.clipboard.writeText(exportText).then(() => {
              this.addCryptoTestResult('✅ Public key copied to clipboard', 'success');
            }).catch(() => {
              // Fallback - show in alert
              alert('Public Key:\n\n' + exportText);
              this.addCryptoTestResult('✅ Public key exported (check dialog)', 'success');
            });
          } else {
            this.addCryptoTestResult('❌ No public key available to export', 'error');
          }
        } catch (error) {
          this.addCryptoTestResult(`❌ Failed to export key: ${error.message}`, 'error');
        }
      });
    }

    if (importPeerKeyBtn && importForm) {
      importPeerKeyBtn.addEventListener('click', () => {
        importForm.style.display = importForm.style.display === 'none' ? 'block' : 'none';
      });
    }

    if (importConfirmBtn && importPeerIdInput && importPublicKeyInput && importForm) {
      importConfirmBtn.addEventListener('click', () => {
        const peerId = importPeerIdInput.value.trim();
        const publicKey = importPublicKeyInput.value.trim();

        if (!peerId || peerId.length !== 40) {
          this.addCryptoTestResult('❌ Valid 40-character peer ID is required', 'error');
          return;
        }

        if (!publicKey) {
          this.addCryptoTestResult('❌ Public key is required', 'error');
          return;
        }

        try {
          // Try to parse as JSON first (for full keypair with pub/epub)
          let keyData;
          try {
            keyData = JSON.parse(publicKey);
            // Validate that it has the expected structure
            if (!keyData.pub && !keyData.epub && !keyData.publicKey) {
              throw new Error('Invalid key format');
            }
          } catch (jsonError) {
            // If JSON parsing fails, treat as plain string (legacy format)
            keyData = publicKey;
          }

          const success = this.mesh.addPeerPublicKey(peerId, keyData);
          if (success) {
            const keyType = typeof keyData === 'object'
              ? (keyData.pub && keyData.epub ? 'complete keypair' : 'partial key')
              : 'legacy key';
            this.addCryptoTestResult(`✅ Public key imported for ${peerId.substring(0, 8)}... (${keyType})`, 'success');
            if (typeof keyData === 'string' || !keyData.epub) {
              this.addCryptoTestResult('⚠️ Warning: Only signing key imported. Encryption may not work.', 'warning');
            }
            this.updateCryptoStatus();
            importPeerIdInput.value = '';
            importPublicKeyInput.value = '';
            importForm.style.display = 'none';
          } else {
            this.addCryptoTestResult('❌ Failed to import public key', 'error');
          }
        } catch (error) {
          this.addCryptoTestResult(`❌ Failed to import key: ${error.message}`, 'error');
        }
      });
    }

    if (importCancelBtn && importForm) {
      importCancelBtn.addEventListener('click', () => {
        importForm.style.display = 'none';
        if (importPeerIdInput) importPeerIdInput.value = '';
        if (importPublicKeyInput) importPublicKeyInput.value = '';
      });
    }

    if (benchmarkBtn) {
      benchmarkBtn.addEventListener('click', async () => {
        try {
          this.addCryptoTestResult('🔄 Running crypto benchmark...', 'info');

          const testData = 'This is a test message for benchmarking crypto performance.';
          const iterations = 100;

          // Test encryption/decryption performance
          const startTime = performance.now();
          for (let i = 0; i < iterations; i++) {
            const encrypted = await this.mesh.encryptMessage(testData);
            await this.mesh.decryptMessage(encrypted);
          }
          const endTime = performance.now();

          const totalTime = endTime - startTime;
          const avgTime = totalTime / iterations;

          this.addCryptoTestResult(`✅ Benchmark completed: ${iterations} iterations`, 'success');
          this.addCryptoTestResult(`   Total time: ${totalTime.toFixed(2)}ms`, 'info');
          this.addCryptoTestResult(`   Average time per cycle: ${avgTime.toFixed(2)}ms`, 'info');
        } catch (error) {
          this.addCryptoTestResult(`❌ Benchmark failed: ${error.message}`, 'error');
        }
      });
    }
  }

  setupMediaControls() {
    // Start media button
    document.getElementById('start-media-btn').addEventListener('click', async () => {
      await this.startMedia();
    });

    // Stop media button
    document.getElementById('stop-media-btn').addEventListener('click', async () => {
      await this.stopMedia();
    });

    // Toggle video button
    document.getElementById('toggle-video-btn').addEventListener('click', () => {
      this.toggleVideo();
    });

    // Toggle audio button
    document.getElementById('toggle-audio-btn').addEventListener('click', () => {
      this.toggleAudio();
    });

    // Audio test button
    document.getElementById('test-audio-btn').addEventListener('click', () => {
      this.testAudio();
    });

    // Media type checkboxes
    document.getElementById('enable-video').addEventListener('change', () => {
      this.updateMediaButtonStates();
    });

    document.getElementById('enable-audio').addEventListener('change', () => {
      this.updateMediaButtonStates();
    });

    // Device selection dropdowns
    document.getElementById('camera-select').addEventListener('change', () => {
      // Auto-restart media if it's currently active
      if (this.mesh.getMediaState().hasLocalStream) {
        this.startMedia();
      }
    });

    document.getElementById('microphone-select').addEventListener('change', () => {
      // Auto-restart media if it's currently active
      if (this.mesh.getMediaState().hasLocalStream) {
        this.startMedia();
      }
    });
  }

  setupCollapsibleSections() {
    const sections = [
      'discovered-peers',
      'connected-peers',
      'manual-connection',
      'settings',
      'dht',
      'storage',
      'crypto',
      'media'
    ];

    sections.forEach(sectionId => {
      const toggle = document.getElementById(`${sectionId}-toggle`);
      const content = document.getElementById(`${sectionId}-content`);
      const section = document.querySelector(`.${sectionId}`);

      if (toggle && content && section) {
        // Force all sections to start collapsed with multiple approaches
        section.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-expanded', 'false');

        // Use multiple ways to hide the content
        content.style.display = 'none';
        content.style.visibility = 'hidden';
        content.style.maxHeight = '0';
        content.style.overflow = 'hidden';
        content.classList.add('collapsed');

        // Ensure the toggle button shows collapsed state
        if (toggle.textContent && !toggle.textContent.includes('▶')) {
          toggle.textContent = toggle.textContent.replace('▼', '▶');
        }

        toggle.addEventListener('click', () => {
          this.toggleSection(sectionId);
        });
      }
    });
  }

  toggleSection(sectionId) {
    const toggle = document.getElementById(`${sectionId}-toggle`);
    const content = document.getElementById(`${sectionId}-content`);

    if (!toggle || !content) {
      this.debug.warn(`Could not find elements for section: ${sectionId}`);
      return;
    }

    const section = toggle.closest(`.${sectionId}`);

    if (!section) {
      this.debug.warn(`Could not find section container for: ${sectionId}`, {
        toggle,
        toggleParent: toggle.parentElement,
        toggleParentParent: toggle.parentElement?.parentElement,
        classList: toggle.parentElement?.parentElement?.classList
      });
      return;
    }

    const isExpanded = toggle.getAttribute('aria-expanded') === 'true';

    toggle.setAttribute('aria-expanded', !isExpanded);

    // Add null check before calling setAttribute
    if (section) {
      section.setAttribute('aria-expanded', !isExpanded);
    }

    if (isExpanded) {
      // Collapse - hide with multiple approaches
      content.style.display = 'none';
      content.style.visibility = 'hidden';
      content.style.maxHeight = '0';
      content.style.overflow = 'hidden';
      content.classList.add('collapsed');
      toggle.textContent = toggle.textContent.replace('▼', '▶');
    } else {
      // Expand - show and reset styles
      content.style.display = 'block';
      content.style.visibility = 'visible';
      content.style.maxHeight = 'none';
      content.style.overflow = 'visible';
      content.classList.remove('collapsed');
      toggle.textContent = toggle.textContent.replace('▶', '▼');
    }
  }

  // Media-related methods
  async initializeMedia() {
    try {
      // Initialize media manager
      await this.mesh.initializeMedia();

      // Populate device lists
      await this.updateDeviceLists();

      // Update button states
      this.updateMediaButtonStates();

      this.debug.log('Media initialized successfully');
    } catch (error) {
      this.debug.error('Failed to initialize media:', error);
      this.addMessage('System', `Failed to initialize media: ${error.message}`, 'error');
    }
  }

  async updateDeviceLists() {
    try {
      const devices = await this.mesh.enumerateMediaDevices();

      // Update camera list
      const cameraSelect = document.getElementById('camera-select');
      if (cameraSelect) {
        cameraSelect.innerHTML = '<option value="">Select camera...</option>';
        devices.cameras.forEach(device => {
          const option = document.createElement('option');
          option.value = device.deviceId;
          option.textContent = device.label || `Camera ${device.deviceId.substring(0, 8)}...`;
          cameraSelect.appendChild(option);
        });
        cameraSelect.disabled = devices.cameras.length === 0;
      }

      // Update microphone list
      const micSelect = document.getElementById('microphone-select');
      if (micSelect) {
        micSelect.innerHTML = '<option value="">Select microphone...</option>';
        devices.microphones.forEach(device => {
          const option = document.createElement('option');
          option.value = device.deviceId;
          option.textContent = device.label || `Microphone ${device.deviceId.substring(0, 8)}...`;
          micSelect.appendChild(option);
        });
        micSelect.disabled = devices.microphones.length === 0;
      }
    } catch (error) {
      this.debug.error('Failed to update device lists:', error);
    }
  }

  updateMediaButtonStates() {
    const videoEnabled = document.getElementById('enable-video')?.checked || false;
    const audioEnabled = document.getElementById('enable-audio')?.checked || false;
    const mediaState = this.mesh.getMediaState();

    // Enable start button if at least one media type is selected
    const startBtn = document.getElementById('start-media-btn');
    if (startBtn) {
      startBtn.disabled = !(videoEnabled || audioEnabled) || mediaState.hasLocalStream;
    }

    // Enable stop button if media is active
    const stopBtn = document.getElementById('stop-media-btn');
    if (stopBtn) {
      stopBtn.disabled = !mediaState.hasLocalStream;
    }

    // Enable toggle buttons if media is active
    const toggleVideoBtn = document.getElementById('toggle-video-btn');
    const toggleAudioBtn = document.getElementById('toggle-audio-btn');

    if (toggleVideoBtn) {
      toggleVideoBtn.disabled = !mediaState.hasLocalStream;
      toggleVideoBtn.textContent = mediaState.videoEnabled ? 'Turn Off Video' : 'Turn On Video';
    }

    if (toggleAudioBtn) {
      toggleAudioBtn.disabled = !mediaState.hasLocalStream;
      toggleAudioBtn.textContent = mediaState.audioEnabled ? 'Turn Off Audio' : 'Turn On Audio';
    }
  }

  async startMedia() {
    try {
      const videoEnabled = document.getElementById('enable-video')?.checked || false;
      const audioEnabled = document.getElementById('enable-audio')?.checked || false;

      // Initialize audio context for better audio support
      if (audioEnabled && (window.AudioContext || window.webkitAudioContext)) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        try {
          const audioContext = new AudioContext();
          if (audioContext.state === 'suspended') {
            await audioContext.resume();
            this.debug.log('Audio context resumed for local media');
          }
          this.debug.log('Audio context state:', audioContext.state);
        } catch (e) {
          this.debug.log('Could not initialize audio context:', e);
        }
      }

      const deviceIds = {};
      const cameraSelect = document.getElementById('camera-select');
      const micSelect = document.getElementById('microphone-select');

      if (cameraSelect?.value) {
        deviceIds.camera = cameraSelect.value;
      }

      if (micSelect?.value) {
        deviceIds.microphone = micSelect.value;
      }

      await this.mesh.startMedia({
        video: videoEnabled,
        audio: audioEnabled,
        deviceIds
      });

      this.addMessage('System', 'Media started successfully');
      this.updateMediaButtonStates();
    } catch (error) {
      this.debug.error('Failed to start media:', error);
      this.addMessage('System', `Failed to start media: ${error.message}`, 'error');
    }
  }

  async stopMedia() {
    try {
      await this.mesh.stopMedia();
      this.addMessage('System', 'Media stopped');
      this.updateMediaButtonStates();
      this.clearLocalVideo();
    } catch (error) {
      this.debug.error('Failed to stop media:', error);
      this.addMessage('System', `Failed to stop media: ${error.message}`, 'error');
    }
  }

  toggleVideo() {
    try {
      const enabled = this.mesh.toggleVideo();
      this.addMessage('System', `Video ${enabled ? 'enabled' : 'disabled'}`);
      this.updateMediaButtonStates();
    } catch (error) {
      this.debug.error('Failed to toggle video:', error);
      this.addMessage('System', `Failed to toggle video: ${error.message}`, 'error');
    }
  }

  toggleAudio() {
    try {
      const enabled = this.mesh.toggleAudio();
      this.addMessage('System', `Audio ${enabled ? 'enabled' : 'disabled'}`);
      this.updateMediaButtonStates();
    } catch (error) {
      this.debug.error('Failed to toggle audio:', error);
      this.addMessage('System', `Failed to toggle audio: ${error.message}`, 'error');
    }
  }

  async testAudio() {
    try {
      this.debug.log('🔊 Starting audio test...');
      this.addMessage('System', '🔊 Testing audio system...', 'info');

      // First, run diagnostics to understand current state
      this.logPeerDiagnostics();

      // Test 0: Verify we have actual peer connections (not just self)
      const allPeers = this.mesh.getPeers();
      const connectedPeers = allPeers.filter(peer => peer.status === 'connected');
      const peersWithMedia = allPeers.filter(peer => {
        const peerConnection = this.mesh.connectionManager.getPeer(peer.peerId);
        return peerConnection && (peerConnection.remoteStream || peerConnection.connection?.connectionState === 'connected');
      });

      this.debug.log('🔊 All peers:', allPeers.length);
      this.debug.log('🔊 Connected peers (data channel):', connectedPeers.length);
      this.debug.log('🔊 Peers with media/WebRTC:', peersWithMedia.length);

      // Log detailed peer status
      allPeers.forEach(peer => {
        const peerConnection = this.mesh.connectionManager.getPeer(peer.peerId);
        this.debug.log(`🔊 Peer ${peer.peerId.substring(0, 8)}:`, {
          status: peer.status,
          webrtcState: peerConnection?.connection?.connectionState,
          dataChannelState: peerConnection?.dataChannel?.readyState,
          hasRemoteStream: !!peerConnection?.remoteStream,
          hasLocalStream: !!peerConnection?.localStream
        });
      });

      this.addMessage('System', `🔊 Found ${allPeers.length} total peers (${connectedPeers.length} with data channel, ${peersWithMedia.length} with media)`, 'info');

      if (peersWithMedia.length === 0) {
        this.addMessage('System', '❌ No peers with active media! You need to open this in TWO different browser tabs/windows and connect them.', 'error');
        this.debug.log('❌ NO PEERS WITH MEDIA: Open this URL in two different browser tabs and ensure they connect to each other');
        return;
      }

      // Test each peer connection individually
      peersWithMedia.forEach((peer, index) => {
        const connection = this.mesh.connectionManager.peers.get(peer.peerId);
        if (connection) {
          this.debug.log(`🔊 Peer ${index + 1} (${peer.peerId.substring(0, 8)}...):`);

          const localStream = connection.getLocalStream();
          const remoteStream = connection.getRemoteStream();

          // Check local stream
          if (localStream) {
            const localAudioTracks = localStream.getAudioTracks();
            this.debug.log(`  - Local audio tracks: ${localAudioTracks.length}`);
            this.addMessage('System', `  Peer ${index + 1} - Local audio: ${localAudioTracks.length} tracks`, 'info');
            localAudioTracks.forEach((track, i) => {
              this.debug.log(`    Track ${i}: enabled=${track.enabled}, id=${track.id.substring(0, 8)}...`);
            });
          } else {
            this.debug.log('  - No local stream');
            this.addMessage('System', `  Peer ${index + 1} - No local stream`, 'warning');
          }

          // Check remote stream
          if (remoteStream) {
            const remoteAudioTracks = remoteStream.getAudioTracks();
            this.debug.log(`  - Remote audio tracks: ${remoteAudioTracks.length}`);
            this.addMessage('System', `  Peer ${index + 1} - Remote audio: ${remoteAudioTracks.length} tracks`, remoteAudioTracks.length > 0 ? 'success' : 'warning');

            remoteAudioTracks.forEach((track, i) => {
              this.debug.log(`    Track ${i}: enabled=${track.enabled}, id=${track.id.substring(0, 8)}..., readyState=${track.readyState}`);
            });

            // CRITICAL: Check if remote stream ID matches local stream ID (loopback detection)
            if (localStream && remoteStream.id === localStream.id) {
              this.debug.error('❌ LOOPBACK DETECTED: Remote stream ID matches local stream ID!');
              this.addMessage('System', `❌ Peer ${index + 1} - LOOPBACK: Getting own audio back!`, 'error');
            } else {
              this.debug.log(`✅ Stream IDs different: local=${localStream?.id.substring(0, 8) || 'none'}, remote=${remoteStream.id.substring(0, 8)}`);
              this.addMessage('System', `✅ Peer ${index + 1} - Stream IDs are different (good!)`, 'success');
            }

            // Check video elements playing this stream
            const videoElements = document.querySelectorAll('video');
            let foundVideoElement = false;
            videoElements.forEach(video => {
              if (video.srcObject === remoteStream) {
                foundVideoElement = true;
                this.debug.log(`  - Video element: volume=${video.volume}, muted=${video.muted}, paused=${video.paused}, readyState=${video.readyState}`);
                this.addMessage('System', `  Peer ${index + 1} - Video element: volume=${video.volume}, muted=${video.muted}`, video.muted ? 'warning' : 'success');
              }
            });

            if (!foundVideoElement) {
              this.debug.log('  - ❌ No video element found for this remote stream');
              this.addMessage('System', `  Peer ${index + 1} - ❌ No video element displaying this stream`, 'error');
            }
          } else {
            this.debug.log('  - ❌ No remote stream');
            this.addMessage('System', `  Peer ${index + 1} - ❌ No remote stream received`, 'error');
          }
        } else {
          this.debug.log(`❌ No connection object found for peer ${peer.peerId}`);
          this.addMessage('System', `❌ No connection for peer ${index + 1}`, 'error');
        }
      });

      // Test 1: Audio Context
      if (window.AudioContext || window.webkitAudioContext) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContext();
        this.debug.log('Audio context state:', audioContext.state);

        if (audioContext.state === 'suspended') {
          await audioContext.resume();
          this.debug.log('Audio context resumed');
        }

        // Generate a test tone
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 note
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime); // Low volume

        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.5); // Play for 0.5 seconds

        this.addMessage('System', '🔊 Audio test tone played (440Hz for 0.5s)', 'success');
      } else {
        this.addMessage('System', '❌ Audio context not supported', 'error');
      }

      // Test 2: Check current media streams
      const peers = this.mesh.getPeers();
      this.debug.log('Current peers:', peers.length);

      peers.forEach(peer => {
        const connection = this.mesh.connectionManager.peers.get(peer.peerId);
        if (connection) {
          const localStream = connection.getLocalStream();
          const remoteStream = connection.getRemoteStream();

          this.debug.log(`Peer ${peer.peerId.substring(0, 8)}:`);
          if (localStream) {
            const audioTracks = localStream.getAudioTracks();
            this.debug.log(`- Local audio tracks: ${audioTracks.length}`);
            audioTracks.forEach((track, i) => {
              this.debug.log(`  Track ${i}: enabled=${track.enabled}, readyState=${track.readyState}, muted=${track.muted}`);
            });
          }

          if (remoteStream) {
            const audioTracks = remoteStream.getAudioTracks();
            this.debug.log(`- Remote audio tracks: ${audioTracks.length}`);
            audioTracks.forEach((track, i) => {
              this.debug.log(`  Track ${i}: enabled=${track.enabled}, readyState=${track.readyState}, muted=${track.muted}`);
            });

            // Check if there are video elements for this stream
            const videoElements = document.querySelectorAll('video');
            videoElements.forEach(video => {
              if (video.srcObject === remoteStream) {
                this.debug.log(`- Video element: volume=${video.volume}, muted=${video.muted}, paused=${video.paused}`);
              }
            });
          }
        }
      });

      // Test 3: Check microphone access
      try {
        const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.debug.log('✅ Microphone access working');
        this.addMessage('System', '✅ Microphone access: OK', 'success');
        testStream.getTracks().forEach(track => track.stop());
      } catch (error) {
        this.debug.log('❌ Microphone access failed:', error);
        this.addMessage('System', `❌ Microphone access failed: ${error.message}`, 'error');
      }
    } catch (error) {
      this.debug.error('Audio test failed:', error);
      this.addMessage('System', `❌ Audio test failed: ${error.message}`, 'error');
    }
  }

  handleLocalStreamStarted(data) {
    this.updateMediaButtonStates();

    // Display local video if video is enabled
    if (data.video) {
      this.displayLocalVideo(data.stream);
    }

    const mediaTypes = [];
    if (data.video) mediaTypes.push('video');
    if (data.audio) mediaTypes.push('audio');

    this.addMessage('System', `Local ${mediaTypes.join(' and ')} started`);
  }

  handleLocalStreamStopped() {
    this.updateMediaButtonStates();
    this.clearLocalVideo();
    this.addMessage('System', 'Local media stopped');
  }

  displayLocalVideo(stream) {
    const localVideoContainer = document.getElementById('local-video-container');
    if (!localVideoContainer) return;

    let video = localVideoContainer.querySelector('video');
    if (!video) {
      video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.style.width = '100%';
      video.style.borderRadius = '8px';
      localVideoContainer.appendChild(video);
    }

    video.srcObject = stream;
  }

  clearLocalVideo() {
    const localVideoContainer = document.getElementById('local-video-container');
    if (localVideoContainer) {
      const video = localVideoContainer.querySelector('video');
      if (video) {
        video.srcObject = null;
        video.remove();
      }
    }
  }

  handleRemoteStream(data) {
    this.debug.log('🎵 Handling remote stream:', data);
    const { peerId, stream } = data;

    // CRITICAL: Prevent audio loopback - check if this is our own stream
    if (peerId === this.mesh.peerId) {
      this.debug.warn('🚨 LOOPBACK DETECTED: Received our own stream as remote! This should not happen.');
      this.debug.warn('Stream ID:', stream.id);
      // Still display it but it will be muted by displayRemoteVideo
    }

    // Detailed audio analysis
    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();

    this.debug.log(`Stream from ${peerId.substring(0, 8)}: ${audioTracks.length} audio, ${videoTracks.length} video tracks`);

    audioTracks.forEach((track, i) => {
      this.debug.log(`🎵 Audio track ${i}:`, {
        id: track.id,
        kind: track.kind,
        enabled: track.enabled,
        readyState: track.readyState,
        muted: track.muted,
        label: track.label
      });

      // Add track event listeners for state monitoring
      track.addEventListener('ended', () => {
        this.debug.log(`🎵 Audio track ${i} from peer ${peerId.substring(0, 8)} ENDED`);
      });

      track.addEventListener('mute', () => {
        this.debug.log(`🎵 Audio track ${i} from peer ${peerId.substring(0, 8)} MUTED`);
      });

      track.addEventListener('unmute', () => {
        this.debug.log(`🎵 Audio track ${i} from peer ${peerId.substring(0, 8)} UNMUTED`);
      });
    });

    this.displayRemoteVideo(peerId, stream);

    // Audio data summary
    const audioSummary = {
      peerIdShort: peerId.substring(0, 8),
      audioTrackCount: audioTracks.length,
      videoTrackCount: videoTracks.length,
      audioTracksEnabled: audioTracks.filter(t => t.enabled).length,
      streamActive: stream.active,
      streamId: stream.id
    };

    this.debug.log(`🎵 AUDIO DATA EXPECTATION for peer ${audioSummary.peerIdShort}:`, audioSummary);

    if (audioTracks.length > 0) {
      this.debug.log(`✅ EXPECTING AUDIO DATA from peer ${audioSummary.peerIdShort} - ${audioSummary.audioTracksEnabled}/${audioSummary.audioTrackCount} tracks enabled`);
    } else {
      this.debug.log(`❌ NO AUDIO TRACKS from peer ${audioSummary.peerIdShort} - video only`);
    }

    this.addMessage('System', `🎵 Remote stream received from ${peerId.substring(0, 8)}... (${audioTracks.length} audio, ${videoTracks.length} video)`);
  }

  displayRemoteVideo(peerId, stream) {
    this.debug.log(`Displaying remote video for ${peerId}:`, stream);
    this.debug.log('Stream tracks:', stream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })));

    // CRITICAL: Prevent audio loopback - check if this is our own stream
    const isOwnStream = peerId === this.mesh.peerId;
    if (isOwnStream) {
      this.debug.warn('🚨 LOOPBACK DETECTED: Received our own stream! Muting audio to prevent feedback.');
    }

    const remoteVideosContainer = document.getElementById('remote-videos-container');
    if (!remoteVideosContainer) return;

    let remoteVideoItem = remoteVideosContainer.querySelector(`[data-peer-id="${peerId}"]`);

    if (!remoteVideoItem) {
      remoteVideoItem = document.createElement('div');
      remoteVideoItem.className = 'remote-video-item';
      remoteVideoItem.setAttribute('data-peer-id', peerId);

      const title = document.createElement('div');
      title.className = 'video-title';
      title.textContent = `Peer ${peerId.substring(0, 8)}...`;

      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.controls = true;
      // CRITICAL: Mute if this is our own stream to prevent audio feedback
      video.muted = isOwnStream; // Mute our own audio, unmute others
      video.style.width = '100%';
      video.style.borderRadius = '8px';

      // Enhanced audio debugging
      video.addEventListener('loadedmetadata', () => {
        this.debug.log('Video element loaded metadata:', {
          duration: video.duration,
          audioTracks: video.audioTracks?.length || 'N/A',
          volume: video.volume,
          muted: video.muted
        });

        video.play().then(() => {
          this.debug.log('Video/audio playback started successfully');
          // Check audio context state
          if (window.AudioContext || window.webkitAudioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContext();
            this.debug.log('Audio context state:', audioContext.state);
            if (audioContext.state === 'suspended') {
              this.debug.log('Audio context is suspended - may need user interaction');
            }
          }
          // Hide any play button if playback started
          const playButton = remoteVideoItem.querySelector('.manual-play-button');
          if (playButton) {
            playButton.style.display = 'none';
          }
        }).catch(error => {
          this.debug.log('Autoplay failed, user interaction required:', error);
          // Show a manual play button
          const playButton = document.createElement('button');
          playButton.className = 'manual-play-button';
          playButton.textContent = '▶ Click to Play Audio';
          playButton.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10; padding: 10px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;';

          playButton.addEventListener('click', async () => {
            try {
              await video.play();
              playButton.style.display = 'none';
              this.debug.log('Manual play successful');
            } catch (e) {
              this.debug.error('Manual play failed:', e);
            }
          });

          remoteVideoItem.style.position = 'relative';
          remoteVideoItem.appendChild(playButton);
        });
      });

      // Add event listeners for audio debugging
      video.addEventListener('play', () => {
        this.debug.log('Video element started playing');
      });

      video.addEventListener('pause', () => {
        this.debug.log('Video element paused');
      });

      video.addEventListener('volumechange', () => {
        this.debug.log('Volume changed:', video.volume, 'Muted:', video.muted);
      });

      const status = document.createElement('div');
      status.className = 'video-status';

      remoteVideoItem.appendChild(title);
      remoteVideoItem.appendChild(video);
      remoteVideoItem.appendChild(status);

      remoteVideosContainer.appendChild(remoteVideoItem);
    }

    const video = remoteVideoItem.querySelector('video');
    const status = remoteVideoItem.querySelector('.video-status');

    video.srcObject = stream;

    // EXPLICIT AUDIO DEBUGGING
    this.debug.log('🎵 Setting srcObject for video element:', {
      stream,
      streamId: stream.id,
      streamActive: stream.active,
      videoElement: video,
      videoMuted: video.muted,
      videoVolume: video.volume,
      isOwnStream
    });

    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();

    this.debug.log('🎵 Stream tracks assigned:', {
      audioTracks: audioTracks.map(t => ({
        id: t.id,
        enabled: t.enabled,
        readyState: t.readyState,
        muted: t.muted
      })),
      videoTracks: videoTracks.map(t => ({
        id: t.id,
        enabled: t.enabled,
        readyState: t.readyState,
        muted: t.muted
      }))
    });

    // CRITICAL: Set audio state based on whether this is our own stream
    if (isOwnStream) {
      this.debug.warn('🚨 Muting our own stream to prevent audio feedback');
      video.muted = true;
      video.volume = 0;
    } else {
      // Only unmute if this is NOT our own stream
      video.muted = false;
      video.volume = 1.0;

      // Setup audio playback monitoring for remote streams
      this.setupAudioPlaybackMonitoring(video, peerId, audioTracks);
    }

    // Update status based on stream tracks
    this.debug.log(`Video tracks: ${videoTracks.length}, Audio tracks: ${audioTracks.length}`);
    audioTracks.forEach((track, i) => {
      this.debug.log(`Audio track ${i}:`, { enabled: track.enabled, muted: track.muted, label: track.label });
    });

    // For audio-only streams, ensure the video element is properly configured
    if (audioTracks.length > 0 && videoTracks.length === 0) {
      this.debug.log('Audio-only stream detected - configuring for audio playback');
      video.style.height = '60px'; // Smaller height for audio-only
      video.style.backgroundColor = '#f0f0f0';

      // Force audio to play by trying to resume audio context
      if (window.AudioContext || window.webkitAudioContext) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        try {
          const audioContext = new AudioContext();
          if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
              this.debug.log('Audio context resumed for remote stream');
            });
          }

          // Test audio by creating a brief analysis
          try {
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const checkAudio = () => {
              analyser.getByteFrequencyData(dataArray);
              const sum = dataArray.reduce((a, b) => a + b, 0);
              if (sum > 0) {
                this.debug.log('Remote audio data detected! Sum:', sum);
              }
            };

            // Check audio data periodically
            const audioChecker = setInterval(checkAudio, 1000);
            setTimeout(() => clearInterval(audioChecker), 10000); // Stop after 10 seconds
          } catch (audioAnalysisError) {
            this.debug.log('Could not analyze remote audio:', audioAnalysisError);
          }
        } catch (e) {
          this.debug.log('Could not create/resume audio context:', e);
        }
      }
    }

    const statusText = [];
    if (videoTracks.length > 0) statusText.push('Video');
    if (audioTracks.length > 0) statusText.push('Audio');

    status.textContent = statusText.length > 0 ? statusText.join(' + ') : 'Audio only';
    status.style.color = '#28a745';

    this.addMessage('System', `Receiving ${statusText.join(' + ')} from ${peerId.substring(0, 8)}...`);
  }

  /**
     * Setup audio playback monitoring for video elements playing remote streams
     */
  setupAudioPlaybackMonitoring(videoElement, peerId, audioTracks) {
    const peerIdShort = peerId.substring(0, 8);
    this.debug.log(`🎵 Setting up audio playback monitoring for peer ${peerIdShort}`);

    if (audioTracks.length === 0) {
      this.debug.log(`🎵 No audio tracks to monitor for peer ${peerIdShort}`);
      return;
    }

    try {
      // Monitor video element audio events
      videoElement.addEventListener('play', () => {
        this.debug.log(`🎵 Video element started playing for peer ${peerIdShort}`, {
          muted: videoElement.muted,
          volume: videoElement.volume,
          audioTracks: audioTracks.length
        });
      });

      videoElement.addEventListener('pause', () => {
        this.debug.log(`🎵 Video element paused for peer ${peerIdShort}`);
      });

      videoElement.addEventListener('volumechange', () => {
        this.debug.log(`🎵 Volume changed for peer ${peerIdShort}:`, {
          volume: videoElement.volume,
          muted: videoElement.muted
        });
      });

      // Create audio context for monitoring actual audio data playback
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        this.debug.warn('🎵 AudioContext not available - basic monitoring only');
        return;
      }

      // Wait for video to load before setting up audio analysis
      const setupAudioAnalysis = () => {
        try {
          const audioContext = new AudioContext();
          const source = audioContext.createMediaElementSource(videoElement);
          const analyser = audioContext.createAnalyser();
          const gainNode = audioContext.createGain();

          analyser.fftSize = 256;
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          // Connect: source -> analyser -> gain -> destination
          source.connect(analyser);
          analyser.connect(gainNode);
          gainNode.connect(audioContext.destination);

          let lastLogTime = 0;
          let totalSamples = 0;
          let playbackSamples = 0;
          let maxPlaybackLevel = 0;

          const monitorPlayback = () => {
            if (videoElement.paused || videoElement.ended) {
              return; // Stop monitoring if playback stopped
            }

            analyser.getByteFrequencyData(dataArray);

            // Calculate playback audio level
            const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
            const currentTime = Date.now();

            totalSamples++;
            if (average > 3) { // Lower threshold for playback detection
              playbackSamples++;
              maxPlaybackLevel = Math.max(maxPlaybackLevel, average);
            }

            // Log every 3 seconds
            if (currentTime - lastLogTime > 3000) {
              const playbackActivity = totalSamples > 0 ? (playbackSamples / totalSamples * 100) : 0;
              this.debug.log(`🔊 Audio PLAYBACK from peer ${peerIdShort}:`, {
                videoElementMuted: videoElement.muted,
                videoElementVolume: videoElement.volume,
                currentPlaybackLevel: Math.round(average),
                maxPlaybackLevel: Math.round(maxPlaybackLevel),
                playbackActivityPercent: Math.round(playbackActivity),
                samplesAnalyzed: totalSamples,
                audioBeingPlayed: playbackSamples > 0,
                audioContextState: audioContext.state
              });

              lastLogTime = currentTime;
              totalSamples = 0;
              playbackSamples = 0;
              maxPlaybackLevel = 0;
            }

            // Continue monitoring
            if (!videoElement.paused && !videoElement.ended) {
              requestAnimationFrame(monitorPlayback);
            }
          };

          // Start monitoring when video plays
          videoElement.addEventListener('play', () => {
            this.debug.log(`🔊 Starting audio playback monitoring for peer ${peerIdShort}`);
            if (audioContext.state === 'suspended') {
              audioContext.resume().then(() => {
                requestAnimationFrame(monitorPlayback);
              });
            } else {
              requestAnimationFrame(monitorPlayback);
            }
          });

          this.debug.log(`🔊 Audio playback analysis setup complete for peer ${peerIdShort}`);
        } catch (error) {
          this.debug.error(`🔊 Failed to setup audio playback analysis for peer ${peerIdShort}:`, error);
        }
      };

      if (videoElement.readyState >= 1) {
        // Video metadata already loaded
        setupAudioAnalysis();
      } else {
        // Wait for metadata to load
        videoElement.addEventListener('loadedmetadata', setupAudioAnalysis, { once: true });
      }
    } catch (error) {
      this.debug.error(`🎵 Failed to setup audio playback monitoring for peer ${peerIdShort}:`, error);
    }
  }

  /**
     * Diagnostic method to log complete peer connection state
     */
  logPeerDiagnostics() {
    this.debug.log('🔍 PEER DIAGNOSTICS:');
    const allPeers = this.mesh.getPeers();

    this.debug.log(`📊 Total peers in mesh: ${allPeers.length}`);

    allPeers.forEach((peer, index) => {
      const peerConnection = this.mesh.connectionManager.getPeer(peer.peerId);

      this.debug.log(`\n🔍 Peer ${index + 1}: ${peer.peerId.substring(0, 8)}...`);
      this.debug.log(`   Status: ${peer.status}`);

      if (peerConnection) {
        this.debug.log(`   WebRTC Connection State: ${peerConnection.connection?.connectionState || 'none'}`);
        this.debug.log(`   ICE Connection State: ${peerConnection.connection?.iceConnectionState || 'none'}`);
        this.debug.log(`   Data Channel State: ${peerConnection.dataChannel?.readyState || 'none'}`);
        this.debug.log(`   Data Channel Ready: ${peerConnection.dataChannelReady}`);
        this.debug.log(`   Has Local Stream: ${!!peerConnection.localStream}`);
        this.debug.log(`   Has Remote Stream: ${!!peerConnection.remoteStream}`);

        if (peerConnection.localStream) {
          const audioTracks = peerConnection.localStream.getAudioTracks();
          const videoTracks = peerConnection.localStream.getVideoTracks();
          this.debug.log(`   Local Stream Tracks: ${audioTracks.length} audio, ${videoTracks.length} video`);
        }

        if (peerConnection.remoteStream) {
          const audioTracks = peerConnection.remoteStream.getAudioTracks();
          const videoTracks = peerConnection.remoteStream.getVideoTracks();
          this.debug.log(`   Remote Stream Tracks: ${audioTracks.length} audio, ${videoTracks.length} video`);
        }
      } else {
        this.debug.log('   ❌ No PeerConnection object found');
      }
    });

    this.debug.log('\n🔍 END PEER DIAGNOSTICS\n');
  }

  // Existing UI methods (keeping the rest of the original functionality)
  async handleConnect() {
    const url = document.getElementById('signaling-url').value.trim();
    if (!url) {
      this.addMessage('System', 'Please enter a signaling server URL', 'error');
      return;
    }

    try {
      this.updateButtonStates({ connecting: true });
      await this.mesh.connect(url);
    } catch (error) {
      this.debug.error('Connection failed:', error);
      this.addMessage('System', `Connection failed: ${error.message}`, 'error');
      this.updateButtonStates({ connecting: false });
    }
  }

  async handleDisconnect() {
    try {
      this.updateButtonStates({ disconnecting: true });
      await this.mesh.disconnect();
    } catch (error) {
      this.debug.error('Disconnection failed:', error);
      this.addMessage('System', `Disconnection failed: ${error.message}`, 'error');
    } finally {
      this.updateButtonStates({ disconnecting: false });
    }
  }

  async handleCleanup() {
    const now = Date.now();
    const timeSinceLastCleanup = now - this.lastCleanupTime;

    if (timeSinceLastCleanup < 5000) {
      const remaining = Math.ceil((5000 - timeSinceLastCleanup) / 1000);
      this.addMessage('System', `Cleanup on cooldown (${remaining}s remaining)`, 'warning');
      return;
    }

    try {
      this.lastCleanupTime = now;
      await this.mesh.cleanupSignalingData();
      this.addMessage('System', 'Signaling data cleanup initiated');
    } catch (error) {
      this.debug.error('Cleanup failed:', error);
      this.addMessage('System', `Cleanup failed: ${error.message}`, 'error');
    }
  }

  async handleHealthCheck() {
    try {
      const result = await this.mesh.performHealthCheck();
      if (result.healthy) {
        this.addMessage('System', 'Health check passed - all systems nominal', 'info');
      } else {
        this.addMessage('System', `Health check failed: ${result.issues.join(', ')}`, 'warning');
      }
    } catch (error) {
      this.debug.error('Health check failed:', error);
      this.addMessage('System', `Health check error: ${error.message}`, 'error');
    }
  }

  async sendMessage() {
    const messageInput = document.getElementById('message-input');
    const dmTargetInput = document.getElementById('dm-target-input');
    const autoEncryptToggle = document.getElementById('crypto-auto-encrypt');

    if (!messageInput) return;

    const message = messageInput.value.trim();
    const dmTarget = dmTargetInput ? dmTargetInput.value.trim() : '';

    if (!message) return;

    try {
      // Check if auto-encrypt is enabled and crypto is available
      const shouldEncrypt = autoEncryptToggle && autoEncryptToggle.checked && this.mesh.getCryptoStatus().enabled;

      if (dmTarget) {
        // Validate peer ID format for direct messages
        if (!window.PeerPigeonMesh.validatePeerId(dmTarget)) {
          this.addMessage('System', 'Invalid peer ID format. Must be 40-character SHA-1 hash.', 'error');
          return;
        }

        // Send direct message (encrypted or not)
        if (shouldEncrypt) {
          await this.mesh.sendEncryptedMessage(dmTarget, message);
          this.addMessage('You', `🔐 (DM to ${dmTarget.substring(0, 8)}...) ${message}`, 'encrypted');
        } else {
          const success = this.mesh.sendDirectMessage(dmTarget, message);
          if (success) {
            this.addMessage('You', `(DM to ${dmTarget.substring(0, 8)}...) ${message}`, 'own');
          } else {
            this.addMessage('System', `Failed to send direct message to ${dmTarget.substring(0, 8)}...`, 'error');
          }
        }
      } else {
        // Send broadcast message (encrypted or not)
        if (shouldEncrypt) {
          // Get all connected peers for encryption
          const connectedPeers = this.mesh.getPeers();
          if (connectedPeers.length > 0) {
            // Send encrypted message to all connected peers
            for (const peer of connectedPeers) {
              try {
                await this.mesh.sendEncryptedMessage(peer.peerId, message);
              } catch (error) {
                this.debug.warn(`Failed to send encrypted message to ${peer.peerId}:`, error);
              }
            }
            this.addMessage('You', `🔐 ${message}`, 'encrypted');
          } else {
            this.addMessage('System', 'No connected peers to send encrypted message to', 'error');
          }
        } else {
          // Send regular unencrypted message
          this.mesh.sendMessage(message);
          this.addMessage('You', message, 'own');
        }
      }

      messageInput.value = '';
    } catch (error) {
      this.debug.error('Failed to send message:', error);
      this.addMessage('System', `Failed to send message: ${error.message}`, 'error');
    }
  }

  connectToPeer() {
    const targetPeerInput = document.getElementById('target-peer');
    const targetPeerId = targetPeerInput.value.trim();

    if (!targetPeerId) {
      this.addMessage('System', 'Please enter a peer ID', 'error');
      return;
    }

    if (!window.PeerPigeonMesh.validatePeerId(targetPeerId)) {
      this.addMessage('System', 'Invalid peer ID format. Must be 40-character SHA-1 hash.', 'error');
      return;
    }

    if (targetPeerId === this.mesh.peerId) {
      this.addMessage('System', 'Cannot connect to yourself', 'error');
      return;
    }

    try {
      this.mesh.connectToPeer(targetPeerId);
      this.addMessage('System', `Attempting to connect to ${targetPeerId.substring(0, 8)}...`);
      targetPeerInput.value = '';
    } catch (error) {
      this.debug.error('Failed to initiate connection:', error);
      this.addMessage('System', `Failed to connect: ${error.message}`, 'error');
    }
  }

  /**
     * Connect to peer from button click (for onclick handlers)
     */
  connectToPeerFromButton(button) {
    const peerId = button.getAttribute('data-peer-id');
    if (!peerId) {
      this.addMessage('System', 'Invalid peer ID in button', 'error');
      return;
    }

    // Disable button to prevent double-clicks
    button.disabled = true;
    button.textContent = 'Connecting...';

    try {
      this.mesh.connectToPeer(peerId);
      this.addMessage('System', `Attempting to connect to ${peerId.substring(0, 8)}...`);

      // Re-enable button after a delay
      setTimeout(() => {
        button.disabled = false;
        button.textContent = 'Connect';
      }, 3000);
    } catch (error) {
      this.debug.error('Failed to initiate connection:', error);
      this.addMessage('System', `Failed to connect: ${error.message}`, 'error');

      // Re-enable button immediately on error
      button.disabled = false;
      button.textContent = 'Connect';
    }
  }

  updateUI() {
    // Update peer ID display
    const peerIdElement = document.getElementById('peer-id');
    if (peerIdElement && this.mesh.peerId) {
      peerIdElement.textContent = this.mesh.peerId;
    }

    // Update status
    this.updateStatus();

    // Update button states
    this.updateButtonStates();

    // Update peer lists
    this.updateConnectedPeers();
    this.updateDiscoveredPeers();

    // Update settings from mesh state
    this.updateSettings();

    // Update DHT status
    this.updateDHTStatus();

    // Update storage status
    this.updateStorageStatus();
  }

  updateStatus() {
    const statusElement = document.getElementById('status');
    if (!statusElement) return;

    const status = this.mesh.getStatus();
    const connectionStatus = status.connected ? 'connected' : 'disconnected';
    statusElement.textContent = connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1);
    statusElement.className = `status ${connectionStatus.toLowerCase()}`;
  }

  updateButtonStates(options = {}) {
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const cleanupBtn = document.getElementById('cleanup-btn');
    const healthCheckBtn = document.getElementById('health-check-btn');

    const isConnected = this.mesh.connected;
    const isConnecting = options.connecting || false;
    const isDisconnecting = options.disconnecting || false;

    if (connectBtn) {
      connectBtn.disabled = isConnected || isConnecting;
      connectBtn.textContent = isConnecting ? 'Connecting...' : 'Connect';
    }

    if (disconnectBtn) {
      disconnectBtn.disabled = !isConnected || isDisconnecting;
      disconnectBtn.textContent = isDisconnecting ? 'Disconnecting...' : 'Disconnect';
    }

    if (cleanupBtn) {
      cleanupBtn.disabled = !isConnected;
    }

    if (healthCheckBtn) {
      healthCheckBtn.disabled = !isConnected;
    }
  }

  updateConnectedPeers() {
    const peersList = document.getElementById('peers-list');
    const connectedPeersCount = document.getElementById('connected-peers-count');

    if (!peersList || !connectedPeersCount) return;

    const peers = this.mesh.getPeers();
    const connectedPeers = peers.filter(peer => peer.status === 'connected');
    connectedPeersCount.textContent = connectedPeers.length;

    if (peers.length === 0) {
      peersList.innerHTML = '<p class="empty-state">No peers connected</p>';
      return;
    }

    peersList.innerHTML = peers.map(peer => {
      // peer is a plain object: { peerId, status, isInitiator, connectionStartTime }
      const statusClass = peer.status === 'connected' ? 'connected' : 'connecting';
      const connectionTime = ((Date.now() - peer.connectionStartTime) / 1000).toFixed(1);

      return `
                <div class="peer-item">
                    <div class="peer-info">
                        <span class="peer-id">${peer.peerId.substring(0, 16)}...</span>
                        <span class="peer-status ${statusClass}">${peer.status}</span>
                    </div>
                    <div class="peer-details">
                        <small>Connected: ${connectionTime}s ago</small>
                        <small>Role: ${peer.isInitiator ? 'Initiator' : 'Receiver'}</small>
                    </div>
                </div>
            `;
    }).join('');
  }

  updateDiscoveredPeers() {
    const discoveredPeersList = document.getElementById('discovered-peers-list');
    const discoveredPeersCount = document.getElementById('discovered-peers-count');

    if (!discoveredPeersList || !discoveredPeersCount) return;

    const discoveredPeers = this.mesh.getDiscoveredPeers();
    const connectedPeerIds = this.mesh.getPeers().map(p => p.peerId);

    // Filter out already connected peers
    const availablePeers = discoveredPeers.filter(peer =>
      !connectedPeerIds.includes(peer.peerId) && peer.peerId !== this.mesh.peerId
    );

    discoveredPeersCount.textContent = availablePeers.length;

    if (availablePeers.length === 0) {
      discoveredPeersList.innerHTML = '<p class="empty-state">No peers discovered</p>';
      return;
    }

    discoveredPeersList.innerHTML = availablePeers.map(peer => {
      const lastSeen = peer.lastSeen
        ? `${Math.round((Date.now() - peer.lastSeen) / 1000)}s ago`
        : 'Unknown';

      return `
                <div class="peer-item discovered">
                    <div class="peer-info">
                        <span class="peer-id">${peer.peerId.substring(0, 16)}...</span>
                        <button class="btn small" data-peer-id="${peer.peerId}" onclick="window.peerPigeonUI.connectToPeerFromButton(this)">
                            Connect
                        </button>
                    </div>
                    <div class="peer-details">
                        <small>Last seen: ${lastSeen}</small>
                        <small>Distance: ${peer.distance || 'Unknown'}</small>
                    </div>
                </div>
            `;
    }).join('');
  }

  updateSettings() {
    // Update form values to match mesh state
    const minPeersInput = document.getElementById('min-peers');
    const maxPeersInput = document.getElementById('max-peers');
    const autoDiscoveryToggle = document.getElementById('auto-discovery-toggle');
    const evictionStrategyToggle = document.getElementById('eviction-strategy-toggle');
    const xorRoutingToggle = document.getElementById('xor-routing-toggle');
    const webdhtToggle = document.getElementById('webdht-toggle');

    if (minPeersInput) minPeersInput.value = this.mesh.minPeers;
    if (maxPeersInput) maxPeersInput.value = this.mesh.maxPeers;
    if (autoDiscoveryToggle) autoDiscoveryToggle.checked = this.mesh.autoDiscovery;
    if (evictionStrategyToggle) evictionStrategyToggle.checked = this.mesh.evictionStrategy;
    if (xorRoutingToggle) xorRoutingToggle.checked = this.mesh.xorRouting;

    // Update WebDHT status (read-only)
    if (webdhtToggle) {
      const isDHTEnabled = this.mesh && this.mesh.isDHTEnabled && this.mesh.isDHTEnabled();
      webdhtToggle.checked = isDHTEnabled;

      // Update the visual styling based on status
      const parent = webdhtToggle.closest('.auto-discovery-control');
      if (parent) {
        if (isDHTEnabled) {
          parent.style.opacity = '1';
          parent.title = 'WebDHT is enabled and running';
        } else {
          parent.style.opacity = '0.6';
          parent.title = 'WebDHT is disabled (restart required to enable)';
        }
      }
    }
  }

  /**
     * Add a message to the UI message log
     * @param {string} sender - Message sender identifier
     * @param {string} content - Message content
     * @param {string} type - Message type ('info', 'error', 'warning', 'own', 'dm')
     */
  addMessage(sender, content, type = 'info') {
    // System messages go to the system-messages container (below connection buttons)
    // Chat messages go to the messages-log container (at the bottom)
    if (sender === 'System') {
      this.addSystemMessage(content, type);
    } else {
      this.addChatMessage(sender, content, type);
    }
  }

  /**
     * Add a system message to the system messages container below connection buttons
     * @param {string} content - Message content
     * @param {string} type - Message type ('info', 'error', 'warning')
     */
  addSystemMessage(content, type = 'info') {
    const systemMessages = document.getElementById('system-messages');
    if (!systemMessages) return;

    const messageElement = document.createElement('div');
    messageElement.className = `system-message ${type}`;

    const timestamp = new Date().toLocaleTimeString();

    messageElement.innerHTML = `
            <div class="system-message-header">
                <span class="system-message-time">${timestamp}</span>
                <span class="system-message-type">${type.toUpperCase()}</span>
            </div>
            <div class="system-message-content">${content}</div>
        `;

    systemMessages.appendChild(messageElement);
    systemMessages.scrollTop = systemMessages.scrollHeight;

    // Limit message history to prevent memory issues
    const messages = systemMessages.children;
    if (messages.length > 50) {
      systemMessages.removeChild(messages[0]);
    }
  }

  /**
     * Add a chat message to the messages log at the bottom
     * @param {string} sender - Message sender identifier
     * @param {string} content - Message content
     * @param {string} type - Message type ('own', 'dm', 'encrypted')
     */
  addChatMessage(sender, content, type = 'info') {
    const messagesLog = document.getElementById('messages-log');
    if (!messagesLog) return;

    const messageElement = document.createElement('div');
    // Add 'encrypted' class if message type is 'encrypted'
    const classes = `message-item ${type}`;
    messageElement.className = classes;

    const timestamp = new Date().toLocaleTimeString();
    const senderDisplay = sender === 'You' ? 'You' : sender.substring(0, 3);

    messageElement.innerHTML = `
            <div class="avatar">${senderDisplay}</div>
            <div class="message-body">
                <div class="message-header">
                    ${sender} • ${timestamp}
                </div>
                <div class="message-content">${content}</div>
            </div>
        `;

    messagesLog.appendChild(messageElement);
    messagesLog.scrollTop = messagesLog.scrollHeight;

    // Limit message history to prevent memory issues
    const messages = messagesLog.children;
    if (messages.length > 100) {
      messagesLog.removeChild(messages[0]);
    }
  }

  /**
     * Add an entry to the DHT log
     * @param {string} message - The log message
     */
  addDHTLogEntry(message) {
    const dhtLog = document.getElementById('dht-log');
    if (!dhtLog) return;

    const logEntry = document.createElement('div');
    logEntry.className = 'dht-log-entry';

    const timestamp = new Date().toLocaleTimeString();
    logEntry.innerHTML = `
            <span class="dht-log-time">${timestamp}</span>
            <span class="dht-log-message">${message}</span>
        `;

    dhtLog.appendChild(logEntry);
    dhtLog.scrollTop = dhtLog.scrollHeight;

    // Limit log entries to prevent memory issues
    const entries = dhtLog.children;
    if (entries.length > 100) {
      dhtLog.removeChild(entries[0]);
    }
  }

  /**
     * Update the DHT status display
     */
  updateDHTStatus() {
    const dhtStatusElement = document.getElementById('dht-status');
    if (!dhtStatusElement) return;

    const isDHTEnabled = this.mesh && this.mesh.isDHTEnabled && this.mesh.isDHTEnabled();
    dhtStatusElement.textContent = isDHTEnabled ? 'Enabled' : 'Disabled';
    dhtStatusElement.className = `status ${isDHTEnabled ? 'connected' : 'disconnected'}`;
  }

  // Crypto Helper Methods
  // =====================

  /**
     * Update the crypto status display
     */
  updateCryptoStatus() {
    // Update main crypto status
    const statusElement = document.getElementById('crypto-status');
    if (statusElement) {
      const status = this.mesh.getCryptoStatus();
      statusElement.textContent = status.enabled ? 'Enabled' : 'Disabled';
      statusElement.className = `status ${status.enabled ? 'enabled' : 'disabled'}`;
    }

    // Update public key display
    const publicKeyElement = document.getElementById('crypto-public-key');
    if (publicKeyElement) {
      const status = this.mesh.getCryptoStatus();
      if (status.enabled && status.publicKey) {
        publicKeyElement.textContent = status.publicKey.substring(0, 40) + '...';
        publicKeyElement.title = status.publicKey; // Full key in tooltip
      } else {
        publicKeyElement.textContent = 'None';
        publicKeyElement.title = '';
      }
    }

    // Update peer keys count
    const peerCountElement = document.getElementById('crypto-peer-count');
    if (peerCountElement) {
      const status = this.mesh.getCryptoStatus();
      const count = status.peerKeys ? Object.keys(status.peerKeys).length : 0;
      peerCountElement.textContent = count.toString();
    }

    // Update performance statistics
    this.updateCryptoStats();
  }

  /**
     * Update crypto performance statistics
     */
  updateCryptoStats() {
    const status = this.mesh.getCryptoStatus();
    if (!status.performance) return;

    const stats = status.performance;

    // Update stat elements
    const updateStat = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value.toString();
    };

    updateStat('crypto-stats-encrypted', stats.messagesEncrypted || 0);
    updateStat('crypto-stats-decrypted', stats.messagesDecrypted || 0);
    updateStat('crypto-stats-encrypt-time', `${(stats.avgEncryptTime || 0).toFixed(2)}ms`);
    updateStat('crypto-stats-decrypt-time', `${(stats.avgDecryptTime || 0).toFixed(2)}ms`);
    updateStat('crypto-stats-key-exchanges', stats.keyExchanges || 0);
  }

  /**
     * Add a crypto test result to the test log
     */
  addCryptoTestResult(message, type = 'info') {
    const testLog = document.getElementById('crypto-test-log');
    if (!testLog) return;

    // Remove empty state message
    const emptyState = testLog.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    const logEntry = document.createElement('div');
    logEntry.className = `test-result ${type}`;

    const timestamp = new Date().toLocaleTimeString();
    logEntry.innerHTML = `
            <span class="test-time">${timestamp}</span>
            <span class="test-message">${message}</span>
        `;

    testLog.appendChild(logEntry);
    testLog.scrollTop = testLog.scrollHeight;

    // Limit log entries to prevent memory issues
    const entries = testLog.querySelectorAll('.test-result');
    if (entries.length > 50) {
      entries[0].remove();
    }
  }

  /**
     * Clear all crypto test results
     */
  clearCryptoTestResults() {
    const testLog = document.getElementById('crypto-test-log');
    if (!testLog) return;

    testLog.innerHTML = '<p class="empty-state">No tests run yet</p>';
  }

  /**
     * Update the group select dropdown
     */
  updateGroupSelect() {
    const groupSelect = document.getElementById('crypto-group-select');
    const groupsList = document.getElementById('crypto-groups-list');
    if (!groupSelect || !groupsList) return;

    const status = this.mesh.getCryptoStatus();
    const groups = status.groups || {};

    // Clear existing options (except placeholder)
    const placeholder = groupSelect.querySelector('option[value=""]');
    groupSelect.innerHTML = '';
    if (placeholder) groupSelect.appendChild(placeholder);

    // Add group options
    Object.keys(groups).forEach(groupId => {
      const option = document.createElement('option');
      option.value = groupId;
      option.textContent = groupId;
      groupSelect.appendChild(option);
    });

    // Update groups list display
    const groupCount = Object.keys(groups).length;
    if (groupCount === 0) {
      groupsList.innerHTML = '<h4>Active Groups:</h4><div class="empty-state">No groups created</div>';
    } else {
      let html = '<h4>Active Groups:</h4>';
      Object.entries(groups).forEach(([groupId, groupInfo]) => {
        html += `
                    <div class="group-item">
                        <strong>${groupId}</strong>
                        <small>Created: ${new Date(groupInfo.created).toLocaleString()}</small>
                    </div>
                `;
      });
      groupsList.innerHTML = html;
    }
  }
}
