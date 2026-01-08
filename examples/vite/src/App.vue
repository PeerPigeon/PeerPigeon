<template>
  <div class="container">
    <header class="header">
      <img src="/logo.svg" alt="PeerPigeon" class="logo" />
      <div class="title">PeerPigeon Vue 3 Demo</div>
      <span class="status" :class="connected ? 'connected' : 'disconnected'">
        {{ connected ? 'Connected' : 'Disconnected' }}
      </span>
    </header>

    <nav class="nav">
      <RouterLink to="/network">🌐 Network</RouterLink>
      <RouterLink to="/messaging">💬 Messaging</RouterLink>
      <RouterLink to="/media">🎥 Media</RouterLink>
      <RouterLink to="/dht">🗄️ DHT</RouterLink>
      <RouterLink to="/storage">📦 Storage</RouterLink>
      <RouterLink to="/crypto">🔐 Crypto</RouterLink>
      <RouterLink to="/debug">🐛 Debug</RouterLink>
      <RouterLink to="/testing">🧪 Testing</RouterLink>
    </nav>

    <RouterView />
  </div>
</template>

<script setup>
import { connected } from './dhtStore.js';
</script>
