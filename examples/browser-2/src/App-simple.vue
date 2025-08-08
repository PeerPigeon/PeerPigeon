<template>
  <div id="app">
    <h1>PeerPigeon Vue 3 Test</h1>
    <p>If you can see this, Vue is working!</p>
    <button @click="counter++">Count: {{ counter }}</button>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const counter = ref(0)
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  text-align: center;
  margin-top: 60px;
}
</style>
