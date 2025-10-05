#!/usr/bin/env node
import { PeerPigeonServer } from './index.js';

/**
 * Standalone PeerPigeon WebSocket Server
 * 
 * Environment variables:
 * - PORT: Server port (default: 3000)
 * - HOST: Server host (default: localhost)
 * - MAX_CONNECTIONS: Maximum connections (default: 1000)
 * - CORS_ORIGIN: CORS origin (default: *)
 */

const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || 'localhost';
const maxConnections = parseInt(process.env.MAX_CONNECTIONS || '1000', 10);
const corsOrigin = process.env.CORS_ORIGIN || '*';

const server = new PeerPigeonServer({
    port,
    host,
    maxConnections,
    corsOrigin,
    isHub: false // Regular signaling server by default
});

// Handle errors
server.on('error', (error) => {
    console.error('❌ Server error:', error);
});

// Handle shutdown gracefully
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await server.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await server.stop();
    process.exit(0);
});

// Start the server
server.start().catch((error) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
});
