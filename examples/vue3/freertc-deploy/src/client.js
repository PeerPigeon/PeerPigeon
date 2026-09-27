// Backoff config for reconnect
const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 30000
const BACKOFF_FACTOR = 1.5
const DATA_PING_MS = 1000
const DATA_PONG_TIMEOUT_MS = 4000
// A pong is proof of a working outbound direction — but only a RECENT one.
// After a machine suspends and resumes, every frozen channel still holds its
// pre-suspend pong and every state field still claims health, so an
// expiry on the proof is what stops the resume-time send burst.
const DATA_PROOF_FRESH_MS = DATA_PING_MS + DATA_PONG_TIMEOUT_MS + 5000
// SCTP max-message-size is negotiated and small in WebKit: Safari advertises
// 64 KiB where Chromium advertises 256 KiB, and a send over the remote's
// limit fails — in Safari silently, as an uncatchable console error, on a
// perfectly healthy channel. Gossip anti-entropy digests measured 205 KiB in
// production. Every string payload above the threshold therefore travels as
// ordered chunk frames and is reassembled on receive; 8 KiB raw slices keep
// each JSON-escaped frame safely under the proven 16 KiB interop ceiling.
const DATA_CHUNK_SLICE = 8192
const DATA_CHUNK_THRESHOLD = 15000
const DATA_CHUNK_FRAME = '~fc'
const DATA_CHUNK_MAX_FRAMES = 4096
const DATA_CHUNK_STALE_MS = 30000
// A hidden tab cannot answer pings promptly — Safari throttles its JS — so
// the 4s pong verdict executed every edge to a napping tab, and each thaw
// redialed and burst into the corpses. A tab that is about to nap says so;
// peers PARK that edge: no sends, no pings, no execution, until a wake frame
// or any traffic revives it. A park older than the cap falls back to normal
// verdicts so a tab that never returns still gets cleaned up.
const DATA_DORMANT_FRAME = '~dormant'
const DATA_DORMANT_MAX_MS = 30 * 60000
// A send into a transport that is not positively connected does not throw in
// WebKit — it logs an uncatchable 'Error sending string through
// RTCDataChannel' console error per attempt. EVERY channel send must pass
// this gate; the transient state either recovers (sends resume) or the
// stalled-negotiation machinery executes the peer.
const transportReady = (pc) => pc?.connectionState === undefined || pc.connectionState === 'connected'
let dataChunkCounter = 0
const SIGNAL_PING_MS = 1000
const SIGNAL_PONG_TIMEOUT_MS = 4000
// A relay-backed offer normally reaches the destination on its next one-second
// signaling heartbeat. Five total sends over 2.85s cover that delivery window
// without pinning an isolated peer to one unreachable candidate for 31.85s.
const OFFER_RETRY_DELAYS_MS = [100, 250, 500, 1000]
const ANSWER_BURST_COOLDOWN_MS = 3000
const ANSWER_BURST_DELAYS_MS = [200, 800, 2000]
const SDP_DEDUP_WINDOW_MS = 15000

/**
 * Remove a previously owned signaling identity without announcing it again.
 * This is intended for reload recovery when the departing document's unload
 * handlers did not get enough time to send their normal withdrawal.
 */
export function withdrawSignalingIdentity(options = {}) {
  const {
    peerId,
    networkId,
    roomId: configuredRoomId,
    sessionId: legacyRoomId,
    signalUrl,
    reason = 'previous_identity_cleanup',
  } = options
  const roomId = configuredRoomId || legacyRoomId || networkId

  if (!peerId || !networkId || !roomId || !signalUrl) {
    throw new Error('peerId, networkId, roomId, and signalUrl are required')
  }

  let socket = null
  let timeoutTimer = null
  let finished = false

  const finish = () => {
    if (finished) return
    finished = true
    clearTimeout(timeoutTimer)
    timeoutTimer = null
    if (!socket) return
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    try {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, 'identity_withdrawn')
      }
    } catch { /* best effort */ }
  }

  try {
    const wsUrl = new URL(signalUrl, typeof location !== 'undefined' ? location.href : undefined)
    if (!wsUrl.searchParams.get('networkId')) wsUrl.searchParams.set('networkId', networkId)
    if (!wsUrl.searchParams.get('room')) wsUrl.searchParams.set('room', roomId)

    socket = new WebSocket(wsUrl.toString())
    socket.onopen = () => {
      try {
        const bytes = new Uint8Array(8)
        const webCrypto = globalThis.window?.crypto ?? globalThis.crypto
        webCrypto.getRandomValues(bytes)
        socket.send(JSON.stringify({
          psp_version: '1.0',
          type: 'withdraw',
          network: networkId,
          from: peerId,
          to: null,
          session_id: roomId,
          message_id: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
          timestamp: Date.now(),
          ttl_ms: null,
          reply_to: null,
          body: { reason },
        }))
      } catch { /* best effort */ }
      finish()
    }
    socket.onerror = finish
    socket.onclose = finish
    timeoutTimer = setTimeout(finish, 5000)
  } catch {
    finish()
  }

  return { close: finish }
}

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.nextcloud.com:443' },
]

export function createSignalingClient(options = {}) {
  const {
    peerId: initialPeerId,
    networkId,
    roomId: configuredRoomId,
    sessionId: legacyRoomId,
    signalUrl,
    iceServers: configuredIceServers,
    trickleIce = true,
    capabilities = {},
    auth,
    autoConnect = true,
    onLog,
    onRegistered,
    onBootstrap,
    onIncomingRelay,
    onNegotiationFailure,
    onConnectionStateChange,
    onStatusChange,
    onDataMessage,
  } = options

  const roomId = configuredRoomId || legacyRoomId || networkId

  if (!initialPeerId || !networkId || !roomId || !signalUrl) {
    throw new Error('peerId, networkId, roomId, and signalUrl are required')
  }

  const mesh = {
    buckets: {},
    connections: new Map(),
    bootstrapCandidates: [],

    addCandidate(candidate) {
      const existing = mesh.bootstrapCandidates.findIndex((c) => c.peerId === candidate.peerId)
      if (existing >= 0) {
        mesh.bootstrapCandidates[existing] = { ...candidate, localSeenAt: Date.now() }
      } else {
        mesh.bootstrapCandidates.push({ ...candidate, localSeenAt: Date.now() })
      }
    },

    getFreshCandidates(maxAgeMs = 10 * 60_000) {
      const cutoff = Date.now() - maxAgeMs
      return mesh.bootstrapCandidates.filter((c) => c.localSeenAt > cutoff)
    },

    markLive(peerId) {
      const conn = mesh.connections.get(peerId)
      if (conn) conn.lastSeen = Date.now()
    },

    markDead(peerId) {
      const conn = mesh.connections.get(peerId)
      if (conn) {
        conn.state = 'dead'
      }
    },
  }

  // ── Signaling client state ────────────────────────────────────────────────
  let ws = null
  let peerId = initialPeerId
  let registered = false
  let backoffMs = BACKOFF_BASE_MS
  let reconnectAttempts = 0
  let reconnectTimer = null
  let advertiseHeartbeatTimer = null
  let keepaliveTimer = null
  let lastSignalPongAt = Date.now()
  let lastSignalPingSentAt = 0
  let intentionalClose = false
  let stoppedByUser = false
  let onConnectionStateChangeCb = onConnectionStateChange
  let lastBootstrapCountLogged = null

  // ── Wake Lock ─────────────────────────────────────────────────────────────
  // Acquired while we have active peer connections so the browser doesn't
  // throttle timers or freeze the tab mid-session.
  let _wakeLock = null

  async function _acquireWakeLock() {
    if (_wakeLock) return
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    try {
      _wakeLock = await navigator.wakeLock.request('screen')
      _wakeLock.addEventListener('release', () => {
        _wakeLock = null
        log('[wakelock] screen wake lock released')
      })
      log('[wakelock] screen wake lock acquired')
    } catch {
      // Permission denied or API unavailable — not fatal.
    }
  }

  function _releaseWakeLock() {
    if (!_wakeLock) return
    try { _wakeLock.release() } catch { /* ignore */ }
    _wakeLock = null
  }

  // Re-acquire the wake lock whenever the tab becomes visible again, since
  // the browser automatically releases it on tab hide.
  function _reacquireWakeLockIfNeeded() {
    if (typeof document === 'undefined' || document.hidden) return
    if (!stoppedByUser && registered) _acquireWakeLock()
  }

  // Pending ICE candidate queues — keyed by peerId.
  const pendingCandidates = new Map()
  // Serialize every remote SDP mutation per peer. Browsers may deliver an
  // offer and one or more answers in the same task after a tab resumes; letting
  // those setRemoteDescription calls overlap can leave the peer permanently in
  // "apply in flight".
  const offerProcessingQueues = new Map()
  // Track scheduled answer retransmit bursts per remote peer.
  const answerBurstTimers = new Map()
  // Keep the newest answer if it arrives before local state is ready.
  const pendingAnswers = new Map()
  // Track recent offer/answer SDPs per peer to avoid duplicate processing storms.
  const recentOfferSdp = new Map()
  const recentAnswerSdp = new Map()
  const preferredIceServers = Array.isArray(configuredIceServers) && configuredIceServers.length > 0
    ? configuredIceServers
    : DEFAULT_ICE_SERVERS

  function resolveIceServers(overrideIceServers = null) {
    return Array.isArray(overrideIceServers) && overrideIceServers.length > 0
      ? overrideIceServers
      : preferredIceServers
  }

  function notifyNegotiationFailure(details) {
    try {
      onNegotiationFailure?.({ ...details, ts: Date.now() })
    } catch {}
  }

  function enqueuePeerNegotiation(remotePeerId, operation) {
    const previous = offerProcessingQueues.get(remotePeerId) ?? Promise.resolve()
    const queued = previous
      .catch(() => {})
      .then(operation)
    offerProcessingQueues.set(remotePeerId, queued)
    queued.finally(() => {
      if (offerProcessingQueues.get(remotePeerId) === queued) {
        offerProcessingQueues.delete(remotePeerId)
      }
    }).catch(() => {})
    return queued
  }

  function clearOfferRetryTimer(pc) {
    if (!pc) return
    if (pc.__offerRetryTimer) {
      clearTimeout(pc.__offerRetryTimer)
      pc.__offerRetryTimer = null
    }
  }

  function getOrCreateSessionId() {
    return roomId
  }

  function setSessionId(_remotePeerId, sessionId) {
    return sessionId === roomId
  }

  function rotateSessionId() {
    return roomId
  }

  function clearAnswerBurst(remotePeerId) {
    const timers = answerBurstTimers.get(remotePeerId)
    if (!timers) return
    for (const timerId of timers) {
      clearTimeout(timerId)
    }
    answerBurstTimers.delete(remotePeerId)
  }

  function startAnswerBurst(remotePeerId, pc, sendRelay, answer, force = false) {
    const entry = mesh.connections.get(remotePeerId)
    if (!entry) return

    const now = Date.now()
    if (!force && now - (entry.lastAnswerBurstAt ?? 0) < ANSWER_BURST_COOLDOWN_MS) {
      return
    }

    entry.lastAnswerBurstAt = now
    clearAnswerBurst(remotePeerId)

    if (
      pc.signalingState === 'closed' ||
      pc.connectionState === 'connected' ||
      pc.connectionState === 'closed'
    ) {
      return
    }

    entry.lastAnswerSentAt = Date.now()
    sendRelay('answer', answer)

    const scheduled = []
    for (const delayMs of ANSWER_BURST_DELAYS_MS) {
      const timerId = setTimeout(() => {
        const current = mesh.connections.get(remotePeerId)
        if (!current || current.connection !== pc) return
        if (
          pc.signalingState === 'closed' ||
          pc.connectionState === 'connected' ||
          pc.connectionState === 'closed'
        ) {
          return
        }
        current.lastAnswerSentAt = Date.now()
        sendRelay('answer', answer)
      }, delayMs)
      scheduled.push(timerId)
    }

    answerBurstTimers.set(remotePeerId, scheduled)
  }

  function log(msg) {
    onLog?.(msg)
  }

  function setStatus(status) {
    onStatusChange?.(status)
    log(`[signal] status: ${status}`)
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj))
    }
  }

  function generateMessageId() {
    const bytes = new Uint8Array(8)
    const webCrypto = globalThis.window?.crypto ?? globalThis.crypto
    webCrypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  async function waitForIceGatheringComplete(pc, timeoutMs = 4000) {
    if (!pc || pc.iceGatheringState === 'complete') return
    await new Promise((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { pc.removeEventListener('icegatheringstatechange', onChange) } catch {}
        resolve()
      }
      const onChange = () => {
        if (pc.iceGatheringState === 'complete') done()
      }
      const timer = setTimeout(done, timeoutMs)
      try { pc.addEventListener('icegatheringstatechange', onChange) } catch { done() }
      onChange()
    })
  }

  function pspEnvelope(type, opts = {}) {
    return {
      psp_version: '1.0',
      type,
      network:    networkId,
      from:       peerId,
      to:         opts.to         ?? null,
      session_id: opts.session_id ?? roomId,
      message_id: generateMessageId(),
      timestamp:  Date.now(),
      ttl_ms:     opts.ttl_ms    ?? null,
      reply_to:   opts.reply_to  ?? null,
      body:       opts.body      ?? {},
    }
  }

  async function relaySignal(toPeerId, type, body) {
    if (!registered) {
      log('[signal] not registered yet')
      return
    }
    if (type === 'offer' || type === 'answer' || type === 'renegotiate') {
      log(`[signal] sending ${type} to ${toPeerId}`)
    }

    send(pspEnvelope(type, {
      to:         toPeerId,
      session_id: getOrCreateSessionId(toPeerId),
      body,
    }))
  }

  function stopAdvertiseHeartbeat() {
    clearInterval(advertiseHeartbeatTimer)
    advertiseHeartbeatTimer = null
  }

  function stopKeepalive() {
    clearInterval(keepaliveTimer)
    keepaliveTimer = null
    lastSignalPingSentAt = 0
    lastSignalPongAt = Date.now()
  }

  function startAdvertiseHeartbeat() {
    stopAdvertiseHeartbeat()
    advertiseHeartbeatTimer = setInterval(() => {
      if (!registered) return
      // Re-announce to refresh TTL in the server's peer registry.
      send(pspEnvelope('announce', {
        ttl_ms: 30000,
        body: { instance_id: networkId, capabilities, hints: { wants_peers: true } },
      }))
    }, 12000)
  }

  function startKeepalive() {
    stopKeepalive()
    keepaliveTimer = setInterval(() => {
      if (!registered) return
      if (typeof document !== 'undefined' && document.hidden) {
        lastSignalPingSentAt = 0
        lastSignalPongAt = Date.now()
        return
      }
      const pingInFlight = lastSignalPingSentAt > lastSignalPongAt
      if (pingInFlight) {
        if (Date.now() - lastSignalPingSentAt >= SIGNAL_PONG_TIMEOUT_MS) {
          log('[signal] keepalive timed out; reconnecting immediately')
          try { ws?.close(4000, 'keepalive_timeout') } catch {}
        }
        return
      }
      send(pspEnvelope('ping', { body: { nonce: generateMessageId() } }))
      lastSignalPingSentAt = Date.now()
    }, SIGNAL_PING_MS)
  }

  function scheduleReconnect(openSocket, closeCode) {
    if (closeCode === 1000 || stoppedByUser) return
    const delayMs = reconnectAttempts === 0 ? 0 : backoffMs
    log(delayMs === 0 ? '[signal] reconnecting immediately' : `[signal] reconnecting in ${delayMs}ms`)
    reconnectTimer = setTimeout(() => {
      openSocket()
    }, delayMs)
    reconnectAttempts += 1
    if (delayMs > 0) backoffMs = Math.min(backoffMs * BACKOFF_FACTOR, BACKOFF_MAX_MS)
  }

  function closeAllPeerConnections() {
    for (const [remotePeerId, entry] of mesh.connections.entries()) {
      try {
        entry.connection?.close()
      } catch {}
      clearAnswerBurst(remotePeerId)
      offerProcessingQueues.delete(remotePeerId)
      pendingAnswers.delete(remotePeerId)
      onConnectionStateChangeCb?.({ peerId: remotePeerId, state: 'closed', ts: Date.now() })
    }
  }

  function attachDataChannelHandlers(channel, remotePeerId, pc) {
    let keepaliveTimerId = null
    let lastPongAt    = Date.now()
    let lastPingSentAt = 0   // 0 = no ping in flight

    // The moment the tab becomes visible, PROBE the channel instead of
    // assuming it survived: faking a fresh pong here stamped every
    // suspend-killed channel as healthy, so the resume-time gossip burst
    // sent straight into corpses. A real ping gives a healthy channel a
    // fresh pong within one round trip and starts the execution clock on
    // a dead one.
    function onVisible() {
      if (typeof document === 'undefined') return
      if (document.hidden) {
        // Going dormant: tell the peer BEFORE the freeze lands so it parks
        // this edge instead of executing it at the pong timeout.
        try {
          if (channel.readyState === 'open' && transportReady(pc)) {
            channel.send(JSON.stringify({ type: DATA_DORMANT_FRAME }))
          }
        } catch { /* the peer's timeout still covers a lost announcement */ }
        return
      }
      lastPongAt = 0
      const visibleEntry = mesh.connections.get(remotePeerId)
      const owned = visibleEntry?.connection === pc && visibleEntry.channel === channel
      try {
        if (channel.readyState === 'open' && transportReady(pc)) {
          channel.send(JSON.stringify({ type: 'ping', ts: Date.now() }))
          lastPingSentAt = Date.now()
          if (owned) {
            visibleEntry.lastPongAt = 0
            visibleEntry.lastPingSentAt = lastPingSentAt
          }
        }
      } catch {
        closeBrokenChannel('data channel resume probe failed')
      }
    }

    function closeBrokenChannel(reason) {
      const currentEntry = mesh.connections.get(remotePeerId)
      const ownsCurrentEntry = currentEntry?.connection === pc && currentEntry.channel === channel
      log(`[webrtc] ${reason} to ${remotePeerId}; closing peer connection`)
      clearInterval(keepaliveTimerId)
      keepaliveTimerId = null
      try { channel.close() } catch {}
      try { pc.close() } catch {}
      if (ownsCurrentEntry) mesh.markDead(remotePeerId)
    }

    const entry = mesh.connections.get(remotePeerId)
    if (entry?.connection === pc) entry.channel = channel

    channel.onopen = () => {
      const currentEntry = mesh.connections.get(remotePeerId)
      if (currentEntry?.connection !== pc || currentEntry.channel !== channel) {
        try { channel.close() } catch {}
        return
      }
      log(`[webrtc] data channel open to ${remotePeerId}`)
      // 0, not now: the channel is unproven until its first pong, and the
      // keepalive's ping-in-flight timeout must be armed from the start so
      // a channel that never answers dies at the timeout, not never.
      lastPongAt = 0
      _acquireWakeLock()

      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible)
        document.addEventListener('visibilitychange', onVisible)
      }

      const openEntry = mesh.connections.get(remotePeerId)
      if (openEntry?.connection === pc) {
        openEntry.channel = channel
        openEntry.lastSeen = Date.now()
        // Round-trip bookkeeping, mirrored onto the entry so sendData can
        // refuse a channel whose outbound direction is unproven. SCTP can
        // die one-way: messages keep ARRIVING while every send fails as
        // WebKit's async console error — readyState and connectionState
        // both keep lying, and in Safari the failed send does not even
        // throw. A returned pong is the only send-side truth, so an
        // 'open' channel starts UNPROVEN (lastPongAt 0): app sends are
        // refused until the first pong lands, and a channel whose opening
        // ping stays unanswered dies by the normal timeout instead of
        // enjoying a grace window it never earned.
        openEntry.lastPongAt = 0
        try {
          if (transportReady(pc)) {
            channel.send(JSON.stringify({ type: 'ping', ts: Date.now() }))
          }
          openEntry.lastPingSentAt = Date.now()
          lastPingSentAt = openEntry.lastPingSentAt
        } catch {
          openEntry.lastPingSentAt = Date.now()
        }
      }
      // RTCPeerConnection "connected" may precede data-channel readiness.
      // Emit again at the exact usable boundary so callers can send immediately.
      onConnectionStateChangeCb?.({ peerId: remotePeerId, state: 'connected', ts: Date.now() })

      clearInterval(keepaliveTimerId)
      keepaliveTimerId = setInterval(() => {
        const currentEntry = mesh.connections.get(remotePeerId)
        if (currentEntry?.connection !== pc || currentEntry.channel !== channel) {
          clearInterval(keepaliveTimerId)
          keepaliveTimerId = null
          return
        }
        if (channel.readyState !== 'open') {
          // WebKit can move a channel to 'closing' without ever firing
          // onclose — a zombie that skipping here kept alive forever: no
          // ping, no timeout, never marked dead, while every send into it
          // spammed 'Error sending string through RTCDataChannel'. A
          // channel that is not open IS broken; execute it on the spot.
          closeBrokenChannel(`data channel ${channel.readyState}`)
          return
        }
        if (currentEntry.dormantAt) {
          if (Date.now() - currentEntry.dormantAt < DATA_DORMANT_MAX_MS) {
            // Parked: the peer announced a nap. No pings, no verdicts —
            // pacify the in-flight bookkeeping so nothing ages while parked.
            lastPingSentAt = 0
            lastPongAt = Date.now()
            return
          }
          currentEntry.dormantAt = 0
        }
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          // The inverse zombie: the channel still reports 'open' but the
          // connection under it is dead, so every send fails as the same
          // uncatchable async console error. Only TERMINAL states execute
          // here — 'disconnected' is usually a transient ICE blip that
          // recovers on its own, and executing it turned every blip into a
          // teardown-and-redial flap; a blip that persists still dies
          // through the ping timeout below.
          closeBrokenChannel(`connection ${pc.connectionState}`)
          return
        }

        // Browsers throttle timers in hidden tabs — don't falsely time out.
        // The fake pong here only pacifies THIS timer; the entry mirrors are
        // left honest so ping-on-receive still proves outbound in hidden
        // tabs, where a one-way-dead channel used to live forever while
        // every reactive gossip reply failed.
        if (typeof document !== 'undefined' && document.hidden) {
          lastPingSentAt = 0
          lastPongAt = Date.now()
          return
        }

        // Only consider a timeout if we sent a ping that hasn't been answered.
        const pingInFlight = lastPingSentAt > lastPongAt
        if (pingInFlight && Date.now() - lastPingSentAt >= DATA_PONG_TIMEOUT_MS) {
          closeBrokenChannel('data channel timeout')
          return
        }

        // Keep one outstanding ping. Replacing its timestamp on every tick
        // made a silent channel impossible to time out.
        if (pingInFlight) return

        // A transient connection state (connecting, disconnected) refuses
        // application sends already; a ping into it fails the same way —
        // WebKit logs an uncatchable async console error per attempt, one
        // every tick through a whole renegotiation window. Skip the ping:
        // recovery either restores 'connected' (pings resume) or the stalled
        // negotiation machinery executes the peer.
        if (pc.connectionState !== undefined && pc.connectionState !== 'connected') return

        try {
          channel.send(JSON.stringify({ type: 'ping', ts: Date.now() }))
          lastPingSentAt = Date.now()
          if (currentEntry.lastPingSentAt <= currentEntry.lastPongAt) {
            currentEntry.lastPingSentAt = lastPingSentAt
          }
        } catch {
          closeBrokenChannel('data channel keepalive send failed')
        }
      }, DATA_PING_MS)
    }

    // Outbound proof, driven by INCOMING traffic so it works even in hidden
    // tabs where interval timers are throttled into uselessness: a message
    // arriving on a channel whose outbound is not recently pong-proven
    // sends a ping; a ping that stays unanswered past the pong timeout
    // while messages keep arriving is a one-way-dead channel — execute it.
    const proveOutbound = () => {
      const currentEntry = mesh.connections.get(remotePeerId)
      if (currentEntry?.connection !== pc || currentEntry.channel !== channel) return
      if (currentEntry.dormantAt) return
      const now = Date.now()
      const pingOutstanding = currentEntry.lastPingSentAt > currentEntry.lastPongAt
      if (pingOutstanding && now - currentEntry.lastPingSentAt >= DATA_PONG_TIMEOUT_MS) {
        closeBrokenChannel('data channel outbound timeout')
        return
      }
      // Same transient-state gate as the timer ping: WebKit turns every send
      // into a not-connected transport into an uncatchable console error.
      if (pc.connectionState !== undefined && pc.connectionState !== 'connected') return
      if (!pingOutstanding && now - currentEntry.lastPongAt > DATA_PING_MS) {
        try {
          channel.send(JSON.stringify({ type: 'ping', ts: now }))
          currentEntry.lastPingSentAt = now
        } catch {
          closeBrokenChannel('data channel keepalive send failed')
        }
      }
    }

    // Reassembly state for chunked payloads on this channel. Bounded: a
    // stale or oversized transfer is dropped, never grown forever.
    const chunkTransfers = new Map()
    const reassembleChunk = (msg) => {
      const total = Number(msg.n)
      const seq = Number(msg.s)
      const id = String(msg.i ?? '')
      if (!id || !Number.isInteger(total) || !Number.isInteger(seq)
        || total < 1 || total > DATA_CHUNK_MAX_FRAMES || seq < 0 || seq >= total) return null
      const now = Date.now()
      for (const [key, transfer] of chunkTransfers) {
        if (now - transfer.startedAt > DATA_CHUNK_STALE_MS) chunkTransfers.delete(key)
      }
      let transfer = chunkTransfers.get(id)
      if (!transfer) {
        transfer = { startedAt: now, total, received: 0, parts: new Array(total) }
        chunkTransfers.set(id, transfer)
      }
      if (transfer.total !== total || transfer.parts[seq] !== undefined) return null
      transfer.parts[seq] = String(msg.d ?? '')
      transfer.received++
      if (transfer.received < transfer.total) return null
      chunkTransfers.delete(id)
      return transfer.parts.join('')
    }

    channel.onmessage = (event) => {
      const currentEntry = mesh.connections.get(remotePeerId)
      const ownsCurrentEntry = currentEntry?.connection === pc && currentEntry.channel === channel
      if (ownsCurrentEntry && currentEntry.dormantAt && String(event.data).indexOf(DATA_DORMANT_FRAME) === -1) {
        currentEntry.dormantAt = 0
      }
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        if (!ownsCurrentEntry) return
        proveOutbound()
        onDataMessage?.({ peerId: remotePeerId, data: event.data })
        return
      }

      if (msg?.type === DATA_DORMANT_FRAME) {
        const dormantEntry = mesh.connections.get(remotePeerId)
        if (dormantEntry?.connection === pc && dormantEntry.channel === channel) {
          dormantEntry.dormantAt = Date.now()
        }
        return
      }

      if (msg?.t === DATA_CHUNK_FRAME) {
        if (!ownsCurrentEntry) return
        const full = reassembleChunk(msg)
        if (full !== null) {
          proveOutbound()
          onDataMessage?.({ peerId: remotePeerId, data: full })
        }
        return
      }

      // Keepalives must be answered on the channel they arrived on, even when
      // simultaneous negotiation left two channels on one peer connection and
      // this one lost the `entry.channel` slot. The remote pings whichever
      // channel IT owns; refusing to pong a non-owning channel made the remote
      // time out a perfectly healthy transport within four seconds — an
      // open/close/redial flap.
      if (msg?.type === 'ping') {
        // Inbound can outlive outbound: WebKit delivers queued pings on a
        // transport whose sending side is already dead, and the reply was
        // the last remaining source of the uncatchable send error. A skipped
        // pong on a transient state is safe — the remote holds its own pings
        // during transient states too, and a state that never returns to
        // 'connected' is executed by the stall machinery on both ends.
        if (!transportReady(pc)) return
        try {
          channel.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
        } catch {
          if (ownsCurrentEntry) {
            closeBrokenChannel('data channel pong send failed')
          } else {
            try { channel.close() } catch { /* already closing */ }
          }
        }
        return
      }

      if (msg?.type === 'pong') {
        lastPongAt = Date.now()
        lastPingSentAt = 0
        const pongEntry = mesh.connections.get(remotePeerId)
        if (pongEntry?.connection === pc && pongEntry.channel === channel) {
          pongEntry.lastPongAt = lastPongAt
          pongEntry.lastPingSentAt = 0
        }
        return
      }

      if (!ownsCurrentEntry) return
      proveOutbound()

      onDataMessage?.({ peerId: remotePeerId, data: event.data })
    }

    channel.onclose = () => {
      log(`[webrtc] data channel closed to ${remotePeerId}`)
      clearInterval(keepaliveTimerId)
      keepaliveTimerId = null
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible)
      }
      const closedEntry = mesh.connections.get(remotePeerId)
      if (closedEntry?.connection === pc && closedEntry.channel === channel) {
        closedEntry.channel = null
        onConnectionStateChangeCb?.({ peerId: remotePeerId, state: 'closed', ts: Date.now() })
      }
      // Release the wake lock if no more open data channels remain.
      const anyOpen = [...mesh.connections.values()].some(
        (e) => e.channel?.readyState === 'open'
      )
      if (!anyOpen) _releaseWakeLock()
    }

    channel.onerror = (evt) => {
      const currentEntry = mesh.connections.get(remotePeerId)
      if (currentEntry?.connection !== pc || currentEntry.channel !== channel) return
      const msg = evt?.error?.message ?? evt?.error ?? evt?.message ?? String(evt)
      // Closing an RTCDataChannel deliberately causes Safari/WebKit to emit an
      // error event whose text says the close was user-initiated. It is teardown
      // confirmation, not a transport failure, and must not feed recovery again.
      if (/user-initiated abort|close called/i.test(String(msg))) return
      log(`[webrtc] data channel error to ${remotePeerId}: ${msg}`)
      onConnectionStateChangeCb?.({ peerId: remotePeerId, state: 'failed', ts: Date.now() })
    }
  }

  function createPeerConnection(remotePeerId, iceServers, sendRelay) {
    const pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 4,
    })

    mesh.connections.set(remotePeerId, {
      connection: pc,
      channel: null,
      state: 'connecting',
      lastSeen: Date.now(),
      lastRemoteOfferSdp: null,
      lastLocalAnswer: null,
      lastAppliedAnswerSdp: null,
      lastAnswerSentAt: 0,
      lastAnswerBurstAt: 0,
      localCandidateCount: 0,
      iceServers,
    })

    onConnectionStateChangeCb?.({ peerId: remotePeerId, state: 'connecting', ts: Date.now() })

    pc.onicecandidate = (event) => {
      const current = mesh.connections.get(remotePeerId)
      if (current?.connection !== pc) return
      if (event.candidate) {
        current.localCandidateCount = (current.localCandidateCount ?? 0) + 1
        log(`[webrtc] local candidate to ${remotePeerId}`)
        sendRelay('ice_candidate', {
          candidate: {
            candidate:     event.candidate.candidate,
            sdpMid:        event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        })
      } else {
        sendRelay('ice_end', {})
      }
    }

    pc.onicecandidateerror = (event) => {
      const current = mesh.connections.get(remotePeerId)
      if (current?.connection !== pc) return
      const code = event?.errorCode ?? 'unknown'
      const text = event?.errorText ?? 'unknown'
      const url = event?.url ?? 'n/a'
      const numericCode = Number(code)
      if (Number.isInteger(numericCode) && numericCode >= 700 && numericCode < 800) {
        // Browsers emit 7xx candidate diagnostics for individual URL/interface
        // combinations even while other candidates from the same ICE server
        // remain usable. They must never mutate ICE configuration or transport
        // state; the browser's ICE agent remains the sole authority here.
        log(`[webrtc] non-fatal ICE candidate diagnostic to ${remotePeerId}: code=${code} text=${text} url=${url}`)
        return
      }
      log(`[webrtc] ice candidate error to ${remotePeerId}: code=${code} text=${text} url=${url}`)
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'closed') clearOfferRetryTimer(pc)
      const entry = mesh.connections.get(remotePeerId)
      if (entry?.connection !== pc) return
      log(`[webrtc] connection to ${remotePeerId}: ${pc.connectionState}`)
      entry.state = pc.connectionState
      entry.lastSeen = Date.now()
      onConnectionStateChangeCb?.({ peerId: remotePeerId, state: pc.connectionState, ts: Date.now() })

      if (pc.connectionState === 'connected') {
        mesh.markLive(remotePeerId)
        clearAnswerBurst(remotePeerId)
      } else if (pc.connectionState === 'disconnected') {
        entry.state = 'recovering'
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        mesh.markDead(remotePeerId)
      }
    }

    pc.oniceconnectionstatechange = () => {
      const entry = mesh.connections.get(remotePeerId)
      if (entry?.connection !== pc) return
      log(`[webrtc] ice to ${remotePeerId}: ${pc.iceConnectionState}`)
      entry.lastSeen = Date.now()
      if (pc.iceConnectionState === 'failed') {
        mesh.markDead(remotePeerId)
        onConnectionStateChangeCb?.({ peerId: remotePeerId, state: 'failed', ts: Date.now() })
      } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
        entry.state = pc.iceConnectionState
        onConnectionStateChangeCb?.({ peerId: remotePeerId, state: pc.iceConnectionState, ts: Date.now() })
      }
    }

    pc.onicegatheringstatechange = () => {
      if (mesh.connections.get(remotePeerId)?.connection !== pc) return
      log(`[webrtc] ice gathering to ${remotePeerId}: ${pc.iceGatheringState}`)
    }

    pc.onsignalingstatechange = () => {
      const current = mesh.connections.get(remotePeerId)
      if (current?.connection !== pc || pc.signalingState !== 'have-local-offer') return
      const pending = pendingAnswers.get(remotePeerId)
      if (!pending?.sdp || (pending.connection && pending.connection !== pc)) return
      Promise.resolve().then(() => {
        const latest = pendingAnswers.get(remotePeerId)
        if (!latest?.sdp || (latest.connection && latest.connection !== pc)) return
        handleIncomingAnswer(remotePeerId, latest.sdp, latest.sessionId)
      }).catch(() => {})
    }

    pc.ondatachannel = (event) => {
      if (mesh.connections.get(remotePeerId)?.connection !== pc) {
        try { event.channel?.close?.() } catch {}
        return
      }
      attachDataChannelHandlers(event.channel, remotePeerId, pc)
    }

    return pc
  }

  async function initiateWebRTCConnection(toPeerId, iceServers = null) {
    return enqueuePeerNegotiation(
      toPeerId,
      () => initiateWebRTCConnectionLocked(toPeerId, iceServers),
    )
  }

  async function initiateWebRTCConnectionLocked(toPeerId, iceServers = null) {
    const priorEntry = mesh.connections.get(toPeerId)
    const prior = priorEntry?.connection

    // Don't dial if the data channel is already open.
    if (priorEntry?.channel?.readyState === 'open') {
      return prior
    }

    if (prior && prior.signalingState !== 'closed') {
      try {
        prior.close()
      } catch {}
      mesh.connections.delete(toPeerId)
    }

    const effectiveIceServers = resolveIceServers(iceServers)
    const pc = createPeerConnection(toPeerId, effectiveIceServers, (type, body) => {
      relaySignal(toPeerId, type, body)
    })

    const dc = pc.createDataChannel('mesh')
    attachDataChannelHandlers(dc, toPeerId, pc)

    // New dial attempt gets a fresh signaling session.
    const activeSessionId = rotateSessionId(toPeerId)

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    // If an answer arrived before we reached have-local-offer, apply it now.
    const pendingAnswer = pendingAnswers.get(toPeerId)
    if (
      pendingAnswer?.sdp
      && pendingAnswer?.sessionId === activeSessionId
      && (!pendingAnswer.connection || pendingAnswer.connection === pc)
    ) {
      const current = mesh.connections.get(toPeerId)?.connection
      if (current === pc && pc.signalingState === 'have-local-offer') {
        await applyIncomingAnswer(toPeerId, pendingAnswer.sdp, pendingAnswer.sessionId)
      }
    }
    if (!trickleIce) await waitForIceGatheringComplete(pc)

    relaySignal(toPeerId, 'offer', {
      sdp: pc.localDescription?.sdp ?? offer.sdp,
      trickle_ice: Boolean(trickleIce),
    })

    let retryIndex = 0
    const retryOffer = () => {
      pc.__offerRetryTimer = null
      if (mesh.connections.get(toPeerId)?.connection !== pc) return
      if (pc.signalingState === 'closed' || pc.remoteDescription) {
        clearOfferRetryTimer(pc)
        return
      }
      if (pc.signalingState !== 'have-local-offer') {
        clearOfferRetryTimer(pc)
        return
      }
      if (retryIndex >= OFFER_RETRY_DELAYS_MS.length) {
        clearOfferRetryTimer(pc)
        log(`[webrtc] offer to ${toPeerId} timed out after ${retryIndex} retries; giving up`)
        notifyNegotiationFailure({
          peerId: toPeerId,
          reason: 'offer_retries_exhausted',
          retryCount: retryIndex,
          signalingState: pc.signalingState,
          connectionState: pc.connectionState,
        })
        try { pc.close() } catch {}
        mesh.markDead(toPeerId)
        return
      }
      retryIndex += 1
      relaySignal(toPeerId, 'offer', {
        sdp: pc.localDescription?.sdp ?? offer.sdp,
        trickle_ice: Boolean(trickleIce),
      })
      const nextDelayMs = OFFER_RETRY_DELAYS_MS[Math.min(
        retryIndex,
        OFFER_RETRY_DELAYS_MS.length - 1,
      )]
      pc.__offerRetryTimer = setTimeout(retryOffer, nextDelayMs)
    }

    pc.__resetOfferRetryBackoff = () => {
      clearOfferRetryTimer(pc)
      if (mesh.connections.get(toPeerId)?.connection !== pc) return
      if (
        pc.signalingState !== 'have-local-offer'
        || pc.remoteDescription
      ) return
      retryIndex = 0
      relaySignal(toPeerId, 'offer', {
        sdp: pc.localDescription?.sdp ?? offer.sdp,
        trickle_ice: Boolean(trickleIce),
      })
      pc.__offerRetryTimer = setTimeout(retryOffer, OFFER_RETRY_DELAYS_MS[0])
    }

    pc.__offerRetryTimer = setTimeout(retryOffer, OFFER_RETRY_DELAYS_MS[retryIndex])
    return pc
  }

  async function handleIncomingOffer(fromPeerId, offer) {
    return enqueuePeerNegotiation(fromPeerId, async () => {
        const sendRelay = (type, body) => {
          relaySignal(fromPeerId, type, body)
        }

        const existingEntry = mesh.connections.get(fromPeerId)

        // Already connected — just re-send our cached answer so the remote
        // peer's retry timer can stop; do NOT tear down the live connection.
        if (existingEntry?.channel?.readyState === 'open') {
          if (existingEntry.lastLocalAnswer) {
            sendRelay('answer', existingEntry.lastLocalAnswer)
          }
          return
        }

        // If the existing connection is dead/failed (but signalingState not yet
        // 'closed' because we never called pc.close() on failure), close it now
        // and start a fresh RTCPeerConnection. Reusing a failed pc causes ICE
        // re-gathering to run on a broken transport, which never recovers.
        const existing = existingEntry?.connection
        if (
          existing &&
          existing.signalingState !== 'closed' &&
          (existing.connectionState === 'failed' ||
            existing.connectionState === 'closed' ||
            existingEntry?.state === 'dead')
        ) {
          try { existing.close() } catch {}
          mesh.connections.delete(fromPeerId)
          clearAnswerBurst(fromPeerId)
          pendingCandidates.delete(fromPeerId)
        }

        const freshEntry = mesh.connections.get(fromPeerId)
        let pc =
          freshEntry?.connection && freshEntry.connection.signalingState !== 'closed'
            ? freshEntry.connection
            : createPeerConnection(fromPeerId, resolveIceServers(freshEntry?.iceServers), sendRelay)

        let entry = mesh.connections.get(fromPeerId)
        const incomingOfferSdp = offer?.sdp ?? null
        const cachedAnswer = entry?.lastLocalAnswer ?? null
        const currentRemoteOfferSdp = entry?.lastRemoteOfferSdp ?? pc.remoteDescription?.sdp ?? null
        const now = Date.now()
        const recent = recentOfferSdp.get(fromPeerId)

        if (
          incomingOfferSdp &&
          recent?.sdp === incomingOfferSdp &&
          now - recent.ts < SDP_DEDUP_WINDOW_MS
        ) {
          if (cachedAnswer) {
            startAnswerBurst(fromPeerId, pc, sendRelay, cachedAnswer)
          }
          return
        }

        if (
          incomingOfferSdp &&
          cachedAnswer &&
          currentRemoteOfferSdp === incomingOfferSdp
        ) {
          // Duplicate offer for same SDP: do not renegotiate repeatedly.
          // Re-send cached answer at most once per cooldown window.
          const shouldResend = Date.now() - (entry?.lastAnswerSentAt ?? 0) > ANSWER_BURST_COOLDOWN_MS
          if (shouldResend) {
            entry.lastAnswerSentAt = Date.now()
            sendRelay('answer', cachedAnswer)
          }
          return
        }

        if (
          incomingOfferSdp &&
          pc.remoteDescription &&
          currentRemoteOfferSdp &&
          currentRemoteOfferSdp !== incomingOfferSdp
        ) {
          // A new SDP is not proof that the current transport is stale. The
          // other peer may have retried before this side's data-channel `open`
          // event, or may be performing a normal ICE renegotiation. Closing a
          // connected/connecting RTCPeerConnection here made both peers start
          // over repeatedly. Apply the offer to the stable existing connection;
          // explicit failed/closed states were already replaced above, and the
          // RTP-extension error path below still performs a fresh retry when a
          // browser genuinely cannot reuse this connection.
          log(`[webrtc] applying renewed offer from ${fromPeerId} to existing connection`)
        }

        if (pc.signalingState === 'closed') return

        const offerCollision = pc.signalingState !== 'stable'
        if (offerCollision) {
          // Both peers derive opposite roles from the stable peer IDs. The
          // lexically later peer is polite and rolls back; the earlier peer
          // keeps its local offer. Exactly one offer therefore wins glare.
          const polite = String(peerId) > String(fromPeerId)
          if (!polite) {
            log(`[webrtc] ignoring colliding offer from ${fromPeerId} (impolite peer)`)
            return
          }
          if (pc.signalingState !== 'have-local-offer') {
            log(`[webrtc] ignoring colliding offer from ${fromPeerId} (state=${pc.signalingState})`)
            return
          }
          clearOfferRetryTimer(pc)
          pendingAnswers.delete(fromPeerId)
          await pc.setLocalDescription({ type: 'rollback' })
          log(`[webrtc] rolled back local offer for ${fromPeerId} (polite peer)`)
        }

        try {
          await pc.setRemoteDescription(offer)
        } catch (error) {
          const message = String(error?.message || error || '')
          const isRtpExtensionRemap = error?.name === 'InvalidAccessError'
            && /remap RTP extension id/i.test(message)
          if (!isRtpExtensionRemap) throw error

          const replacementIceServers = resolveIceServers(entry?.iceServers)
          clearOfferRetryTimer(pc)
          try { pc.close() } catch {}
          if (mesh.connections.get(fromPeerId)?.connection === pc) {
            mesh.connections.delete(fromPeerId)
          }
          clearAnswerBurst(fromPeerId)
          pc = createPeerConnection(fromPeerId, replacementIceServers, sendRelay)
          entry = mesh.connections.get(fromPeerId)
          log(`[webrtc] retrying offer from ${fromPeerId} on fresh connection after RTP extension remap`)
          await pc.setRemoteDescription(offer)
        }

        if (entry) {
          entry.lastRemoteOfferSdp = incomingOfferSdp
        }

        const queued = pendingCandidates.get(fromPeerId) ?? []
        pendingCandidates.delete(fromPeerId)
        for (const candidate of queued) {
          await pc.addIceCandidate(candidate).catch(() => {})
        }

        const answer = await pc.createAnswer()
        if (pc.signalingState === 'closed') return
        await pc.setLocalDescription(answer)
        if (!trickleIce) await waitForIceGatheringComplete(pc)
        const finalAnswerSdp = pc.localDescription?.sdp ?? answer.sdp
        if (entry) {
          entry.lastLocalAnswer = {
            sdp: finalAnswerSdp,
            trickle_ice: Boolean(trickleIce),
          }
        }
        if (incomingOfferSdp) {
          recentOfferSdp.set(fromPeerId, { sdp: incomingOfferSdp, ts: Date.now() })
        }
        startAnswerBurst(fromPeerId, pc, sendRelay, {
          sdp: finalAnswerSdp,
          trickle_ice: Boolean(trickleIce),
        }, true)
      }).catch((err) => {
        log(`[webrtc] handleIncomingOffer failed: ${err}`)
      })
  }

  async function applyIncomingAnswer(fromPeerId, incomingAnswerSdp, sessionId) {
    const expectedSessionId = roomId
    if (expectedSessionId && sessionId && sessionId !== expectedSessionId) {
      log(`[webrtc] ignoring answer from ${fromPeerId} (stale session)`)
      return
    }

    const conn = mesh.connections.get(fromPeerId)
    if (!conn?.connection) {
      pendingAnswers.set(fromPeerId, {
        sdp: incomingAnswerSdp,
        sessionId,
        ts: Date.now(),
        connection: null,
      })
      log(`[webrtc] queued answer from ${fromPeerId} (no connection yet)`)
      return
    }

    const now = Date.now()
    const recent = recentAnswerSdp.get(fromPeerId)
    if (recent?.sdp === incomingAnswerSdp && now - recent.ts < SDP_DEDUP_WINDOW_MS) {
      log(`[webrtc] duplicate answer from ${fromPeerId} already applied (dedup window)`)
      return
    }
    if (conn.lastAppliedAnswerSdp === incomingAnswerSdp) {
      log(`[webrtc] duplicate answer from ${fromPeerId} already applied`)
      return
    }

    const pc = conn.connection
    if (pc.signalingState !== 'have-local-offer') {
      const peerIsIsolated = conn.channel?.readyState !== 'open'
      if (peerIsIsolated) {
        pendingAnswers.set(fromPeerId, {
          sdp: incomingAnswerSdp,
          sessionId,
          ts: Date.now(),
          connection: pc,
        })
        log(`[webrtc] queued answer from ${fromPeerId} (state=${pc.signalingState}; peer isolated)`)
        return
      }
      log(`[webrtc] ignoring stale answer from connected peer ${fromPeerId} (state=${pc.signalingState})`)
      return
    }

    await pc.setRemoteDescription({ type: 'answer', sdp: incomingAnswerSdp })
    log(`[webrtc] applied answer from ${fromPeerId}`)
    conn.lastAppliedAnswerSdp = incomingAnswerSdp
    recentAnswerSdp.set(fromPeerId, { sdp: incomingAnswerSdp, ts: Date.now() })
    pendingAnswers.delete(fromPeerId)
    clearOfferRetryTimer(pc)

    const queued = pendingCandidates.get(fromPeerId) ?? []
    pendingCandidates.delete(fromPeerId)
    for (const candidate of queued) {
      await pc.addIceCandidate(candidate).catch(() => {})
    }
  }

  async function handleIncomingAnswer(fromPeerId, incomingAnswerSdp, sessionId) {
    return enqueuePeerNegotiation(
      fromPeerId,
      () => applyIncomingAnswer(fromPeerId, incomingAnswerSdp, sessionId),
    ).catch((err) => {
      log(`[webrtc] setRemoteDescription(answer) failed: ${err}`)
    })
  }

  function closePeerConnection(remotePeerId, reason = 'local_close', notifyRemote = true) {
    const id = String(remotePeerId || '').trim()
    if (!id) return false
    const entry = mesh.connections.get(id)

    // Tell the other owner first so it cancels offer retries and cannot revive
    // an edge that this side intentionally shed for capacity/topology reasons.
    if (notifyRemote && registered) {
      relaySignal(id, 'bye', { reason })
    }

    if (!entry) return false
    mesh.connections.delete(id)
    clearOfferRetryTimer(entry.connection)
    clearAnswerBurst(id)
    pendingCandidates.delete(id)
    pendingAnswers.delete(id)
    offerProcessingQueues.delete(id)
    try { entry.channel?.close?.() } catch {}
    try { entry.connection?.close?.() } catch {}
    return true
  }

  async function handleSignalingMessage(rawMsg) {
    const fromPeerId = rawMsg.from
    log(`[signal] incoming ${rawMsg.type} from ${fromPeerId}`)

    try { onIncomingRelay?.(rawMsg) } catch { /* never let app callback abort signaling */ }

    const msg = rawMsg

    if (msg.session_id !== roomId) {
      log(`[signal] ignoring ${msg.type} from ${fromPeerId} (different room)`)
      return
    }

    const conn = mesh.connections.get(fromPeerId)
    if (
      !conn &&
      (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice_candidate' || msg.type === 'renegotiate')
    ) {
      onConnectionStateChangeCb?.({ peerId: fromPeerId, state: 'connecting', ts: Date.now() })
    }
    if (conn) {
      conn.lastSeen = Date.now()
      if (conn.state !== 'connected') conn.state = 'connecting'
    }

    switch (msg.type) {
      case 'offer':
        setSessionId(fromPeerId, msg.session_id)
        handleIncomingOffer(fromPeerId, { type: 'offer', sdp: msg.body.sdp }).catch((err) => {
          log(`[webrtc] handleIncomingOffer failed: ${err}`)
        })
        break

      case 'answer':
        if (msg.body?.sdp) {
          handleIncomingAnswer(fromPeerId, msg.body.sdp, msg.session_id ?? null)
        }
        break

      case 'ice_candidate': {
        const c = msg.body?.candidate
        if (!c) break
        const expectedSessionId = roomId
        if (expectedSessionId && msg.session_id && msg.session_id !== expectedSessionId) {
          log(`[webrtc] ignoring candidate from ${fromPeerId} (stale session)`)
          break
        }
        log(`[webrtc] remote candidate from ${fromPeerId}`)
        if (conn?.connection) {
          if (conn.connection.signalingState === 'closed') break
          if (conn.connection.remoteDescription) {
            conn.connection.addIceCandidate(c).catch((err) => {
              log(`[webrtc] addIceCandidate failed: ${err}`)
            })
          } else {
            if (!pendingCandidates.has(fromPeerId)) pendingCandidates.set(fromPeerId, [])
            pendingCandidates.get(fromPeerId).push(c)
          }
        } else {
          if (!pendingCandidates.has(fromPeerId)) pendingCandidates.set(fromPeerId, [])
          pendingCandidates.get(fromPeerId).push(c)
        }
        break
      }

      case 'ice_end':
        // Remote ICE gathering complete; no further candidates will arrive.
        break

      case 'bye':
        closePeerConnection(fromPeerId, msg.body?.reason || 'remote_close', false)
        onConnectionStateChangeCb?.({
          peerId: fromPeerId,
          state: 'closed',
          reason: msg.body?.reason || 'remote_close',
          ts: Date.now(),
        })
        break

      case 'renegotiate': {
        if (msg.body?.sdp) {
          handleIncomingOffer(fromPeerId, { type: 'offer', sdp: msg.body.sdp }).catch((err) => {
            log(`[webrtc] renegotiate failed: ${err}`)
          })
        }
        break
      }
    }
  }

  function handleMessage(msg) {
    const completeRegistration = (registrationMessage, source = 'ack') => {
      if (registered) return
      registered = true
      setStatus('registered')
      log(`[signal] registered as ${peerId} on network ${networkId} (${source})`)
      startAdvertiseHeartbeat()
      onRegistered?.(registrationMessage)
    }

    switch (msg.type) {
      case 'ack':
        if (msg.body?.status === 'ok') completeRegistration(msg)
        break

      case 'peer_list': {
        // Older FreeRTC relays broadcast a scoped peer_list after accepting an
        // announcement but did not send the explicit ACK. Receiving that list
        // proves registration and keeps new clients compatible with them.
        completeRegistration(msg, 'peer_list')
        const rawPeers = msg.body?.peers ?? []
        if (rawPeers.length !== lastBootstrapCountLogged) {
          lastBootstrapCountLogged = rawPeers.length
          log(`[signal] received ${rawPeers.length} peer_list candidates`)
        }
        const candidates = rawPeers.map((p) => ({
          peerId:       p.peer_id,
          networkId:    p.network ?? networkId,
          capabilities: p.hints ?? {},
          advertisedAt: p.last_seen ?? p.timestamp ?? Date.now(),
          advisory:     true,
          localSeenAt:  Date.now(),
        }))
        candidates.forEach((c) => mesh.addCandidate(c))
        onBootstrap?.(candidates)
        break
      }

      case 'offer':
      case 'answer':
      case 'ice_candidate':
      case 'ice_end':
      case 'bye':
      case 'renegotiate':
        handleSignalingMessage(msg).catch((err) => log(`[signal] handleSignalingMessage error: ${err}`))
        break

      case 'pong':
        lastSignalPongAt = Date.now()
        lastSignalPingSentAt = 0
        break

      case 'error':
        log(`[signal] error: ${msg.body?.code} — ${msg.body?.reason}`)
        if (msg.body?.code === 'target_not_connected') {
          log('[signal] target unavailable for relay (offline/disconnected/or other isolate)')
        }
        break

      default:
        log(`[signal] unknown message type: ${msg.type}`)
    }
  }

  function openSocket() {
    if (stoppedByUser) return
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    const wsUrl = new URL(signalUrl, typeof location !== 'undefined' ? location.href : undefined)
    if (!wsUrl.searchParams.get('networkId')) {
      wsUrl.searchParams.set('networkId', networkId)
    }
    if (!wsUrl.searchParams.get('room')) {
      wsUrl.searchParams.set('room', roomId)
    }

    setStatus('connecting')
    ws = new WebSocket(wsUrl.toString())

    ws.onopen = () => {
      if (stoppedByUser) {
        try {
          ws?.close(1000, 'stopped')
        } catch {}
        return
      }
      intentionalClose = false
      setStatus('connected')
      backoffMs = BACKOFF_BASE_MS
      reconnectAttempts = 0
      lastSignalPongAt = Date.now()
      lastSignalPingSentAt = 0

      send(pspEnvelope('announce', {
        ttl_ms: 30000,
        body: {
          instance_id: networkId,
          capabilities,
          hints: { wants_peers: true },
          ...(auth ? { auth } : {}),
        },
      }))
      startKeepalive()
    }

    ws.onmessage = (event) => {
      if (stoppedByUser) return
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        log('[signal] received non-JSON message')
        return
      }
      // Any valid relay message proves that the socket is alive, even if a
      // particular relay version does not emit explicit pong frames.
      lastSignalPongAt = Date.now()
      lastSignalPingSentAt = 0
      handleMessage(msg)
    }

    ws.onclose = (event) => {
      registered = false
      stopAdvertiseHeartbeat()
      stopKeepalive()
      setStatus(`disconnected (${event.code})`)
      const shouldReconnect = !stoppedByUser && !(intentionalClose && event.code === 1000)
      if (shouldReconnect) {
        scheduleReconnect(openSocket, event.code)
      }
    }

    ws.onerror = () => {
      setStatus('error')
    }
  }

  function relay(toPeerId, relayType, payload) {
    if (!registered) {
      log('[signal] not registered yet')
      return
    }

    if (relayType === 'offer' || relayType === 'answer' || relayType === 'renegotiate') {
      log(`[signal] sending ${relayType} to ${toPeerId}`)
    }

    send({
      type: 'relay',
      toPeerId,
      relayType,
      payload,
      fromPeerId: peerId,
      messageId: generateMessageId(),
      timestamp: Date.now(),
    })
  }

  const unloadHandler = () => {
    client.disconnect()
  }

  const pageHideHandler = (event) => {
    // A persisted pagehide is entering the back/forward cache rather than
    // being destroyed. Keep the identity announced and let pageshow rebuild
    // the transport if the browser closes it while the document is cached.
    if (event?.persisted) {
      handleFreeze()
      return
    }
    client.disconnect()
  }

  function handleFreeze() {
    // A frozen page is suspended, not departed. Withdrawing here made relay
    // membership oscillate whenever Safari or a mobile browser throttled a
    // background tab. Actual teardown still withdraws through pagehide,
    // beforeunload, unload, and disconnect.
    // Mark all connected peers as recovering so they are re-verified on resume.
    for (const entry of mesh.connections.values()) {
      if (entry.state === 'connected') entry.state = 'recovering'
    }
    _releaseWakeLock()
  }

  function handlePageShow(event) {
    // bfcache restore: the page is shown from the browser's back/forward cache.
    // The WebSocket is dead at this point — reconnect exactly as on freeze→resume.
    if (event.persisted) handleSuspendRestore()
  }

  function resetReconnectBackoff() {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
    backoffMs = BACKOFF_BASE_MS
    reconnectAttempts = 0
  }

  function handleSuspendRestore() {
    if (stoppedByUser) return

    log('[signal] browser resumed — reconnecting immediately')
    resetReconnectBackoff()

    // A socket can remain OPEN/CONNECTING briefly after the browser thaws even
    // though its underlying connection was lost. Retire it without letting its
    // eventual close schedule another retry, then establish a fresh socket now.
    const staleSocket = ws
    ws = null
    if (staleSocket) {
      staleSocket.onopen = null
      staleSocket.onmessage = null
      staleSocket.onerror = null
      staleSocket.onclose = null
      try {
        staleSocket.close(1000, 'browser_resume')
      } catch { /* ignore */ }
    }

    registered = false
    stopAdvertiseHeartbeat()
    stopKeepalive()
    closeAllPeerConnections()
    mesh.connections.clear()
    intentionalClose = false
    openSocket()
  }

  function reconnectSignalingPreservingPeers(reason = 'signaling_refresh') {
    if (stoppedByUser) return false

    log(`[signal] ${reason} — reconnecting signaling while preserving open peer channels`)
    resetReconnectBackoff()

    // WebRTC data channels do not depend on the signaling WebSocket after
    // negotiation completes. Retire only the socket; disconnect() is a full
    // client teardown and must never be used as a signaling health probe.
    const staleSocket = ws
    ws = null
    if (staleSocket) {
      staleSocket.onopen = null
      staleSocket.onmessage = null
      staleSocket.onerror = null
      staleSocket.onclose = null
      try {
        staleSocket.close(4002, 'signaling_refresh')
      } catch { /* ignore */ }
    }

    registered = false
    stopAdvertiseHeartbeat()
    stopKeepalive()
    intentionalClose = false
    openSocket()
    return true
  }

  function handleVisibilityChange() {
    if (typeof document === 'undefined' || document.hidden) return
    // Tab became visible (or resumed from freeze) — check if WebSocket dropped
    // while the tab was inactive.
    _reacquireWakeLockIfNeeded()
    if (!stoppedByUser) {
      if (!ws || (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING)) {
        log('[signal] tab visible — WebSocket dropped while hidden, reconnecting')
        // Close and purge all stale WebRTC connections so shouldDialCandidate
        // doesn't think they are alive and block re-dialing after reconnect.
        closeAllPeerConnections()
        mesh.connections.clear()
        resetReconnectBackoff()
        openSocket()
      } else if (registered) {
        // WS still open — close any dead WebRTC connections then refresh peers.
        for (const [rPeerId, entry] of mesh.connections.entries()) {
          if (entry.state === 'dead' || entry.state === 'failed') {
            try { entry.connection?.close() } catch {}
            mesh.connections.delete(rPeerId)
            onConnectionStateChangeCb?.({ peerId: rPeerId, state: 'closed', ts: Date.now() })
          }
        }
        client.requestBootstrap([peerId])
      }
    }
  }

  const client = {
    connect() {
      stoppedByUser = false
      intentionalClose = false
      openSocket()
    },

    requestBootstrap(excludePeerIds = [peerId]) {
      if (!registered) {
        log('[signal] not registered yet')
        return
      }
      send(pspEnvelope('discover', {
        body: { exclude_peers: excludePeerIds, limit: 10 },
      }))
    },

    relay: relaySignal,

    advertise(nextCapabilities) {
      if (!registered) return
      send(pspEnvelope('announce', {
        ttl_ms: 30000,
        body: { instance_id: networkId, capabilities: nextCapabilities, hints: { wants_peers: true } },
      }))
    },

    resetRecoveryBackoffs() {
      resetReconnectBackoff()
      recentOfferSdp.clear()
      recentAnswerSdp.clear()
      for (const [remotePeerId, entry] of mesh.connections.entries()) {
        clearAnswerBurst(remotePeerId)
        entry.lastAnswerBurstAt = 0
        entry.lastAnswerSentAt = 0
        entry.connection?.__resetOfferRetryBackoff?.()
      }
      log('[signal] recovery backoffs cleared')
    },

    reconnectSignaling(reason = 'signaling_refresh') {
      return reconnectSignalingPreservingPeers(reason)
    },

    closePeerConnection(remotePeerId, reason = 'local_close') {
      return closePeerConnection(remotePeerId, reason, true)
    },

    disconnect() {
      stoppedByUser = true
      clearTimeout(reconnectTimer)
      reconnectTimer = null
      stopAdvertiseHeartbeat()
      stopKeepalive()
      intentionalClose = true
      closeAllPeerConnections()
      mesh.connections.clear()
      mesh.bootstrapCandidates = []
      pendingCandidates.clear()
      offerProcessingQueues.clear()
      for (const remotePeerId of answerBurstTimers.keys()) {
        clearAnswerBurst(remotePeerId)
      }
      pendingAnswers.clear()
      registered = false
      _releaseWakeLock()

      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', unloadHandler)
        window.removeEventListener('pagehide', pageHideHandler)
        window.removeEventListener('unload', unloadHandler)
        window.removeEventListener('pageshow', handlePageShow)
      }

      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        document.removeEventListener('resume', handleSuspendRestore)
        document.removeEventListener('freeze', handleFreeze)
      }

      if (ws) {
        send(pspEnvelope('withdraw', { body: { reason: 'user_disconnect' } }))
        ws.onmessage = null
        ws.onerror = null
        ws.close(1000, 'user_disconnect')
        ws = null
      }
    },

    async initiateConnection(toPeerId, iceServers = []) {
      return initiateWebRTCConnection(toPeerId, iceServers)
    },

    sendData(data, preferredPeerId) {
      // A channel can keep reporting 'open' while its connection is anything
      // but 'connected' — connecting during renegotiation, disconnected on an
      // ICE blip, failed after one. WebKit fails every such send with an
      // async console error no catch can see, so the gate must be POSITIVE:
      // send only over a connection that says 'connected' (or one whose
      // implementation has no connectionState at all). Transient states
      // throw an error marked transient so callers retry without executing
      // the peer; terminal states throw plain so callers release it.
      const channelIsLive = (entry) => {
        if (entry?.channel?.readyState !== 'open') return false
        if (entry.dormantAt && Date.now() - entry.dormantAt < DATA_DORMANT_MAX_MS) return false
        if (!entry.connection) return false
        const state = entry.connection.connectionState
        if (state !== undefined && state !== 'connected') return false
        // SCTP dies one-way: readyState and connectionState both keep
        // claiming health while every send fails — and in Safari the
        // failure does not even throw, so no error path ever fires. The
        // only trusted signal is the pong round trip: a channel is live
        // once its first pong has landed, and stops being live when a
        // ping goes unanswered past the pong timeout.
        const now = Date.now()
        if (!(entry.lastPongAt > 0) || now - entry.lastPongAt >= DATA_PROOF_FRESH_MS) return false
        return !(entry.lastPingSentAt > entry.lastPongAt
          && now - entry.lastPingSentAt >= DATA_PONG_TIMEOUT_MS)
      }

      let target = null

      if (preferredPeerId) {
        target = mesh.connections.get(preferredPeerId) ?? null
      } else {
        for (const entry of mesh.connections.values()) {
          if (channelIsLive(entry)) {
            target = entry
            break
          }
        }
      }

      if (!target?.channel || target.channel.readyState !== 'open') {
        throw new Error('WebRTC not yet connected')
      }
      if (target.dormantAt && Date.now() - target.dormantAt < DATA_DORMANT_MAX_MS) {
        const error = new Error('Peer is dormant (hidden tab)')
        error.transient = true
        throw error
      }
      if (!channelIsLive(target)) {
        const now = Date.now()
        const state = target.connection?.connectionState
        const unproven = !(target.lastPongAt > 0) || now - target.lastPongAt >= DATA_PROOF_FRESH_MS
        const pingOutstanding = target.lastPingSentAt > (target.lastPongAt ?? 0)
        const outboundDead = pingOutstanding && now - target.lastPingSentAt >= DATA_PONG_TIMEOUT_MS
        // A refusal for a stale proof arms its own re-proof: a healthy
        // channel pongs within one round trip and the next send passes; a
        // dead one lets this ping age into the execution verdict. Without
        // this, a quiet channel could stay refused forever.
        if (unproven && !pingOutstanding && target.channel?.readyState === 'open'
          && (target.connection?.connectionState === undefined || target.connection.connectionState === 'connected')) {
          try {
            target.channel.send(JSON.stringify({ type: 'ping', ts: now }))
            target.lastPingSentAt = now
          } catch { /* the keepalive verdict handles it */ }
        }
        const error = new Error(outboundDead
          ? 'WebRTC channel failed its pong proof'
          : unproven
            ? 'WebRTC channel is awaiting a fresh pong'
            : `WebRTC connection is ${state}`)
        // Awaiting-a-pong resolves within one round trip — retry. A failed
        // proof or a bad connection state is the edge telling the truth
        // about being gone.
        error.transient = !outboundDead
          && (unproven || state === 'connecting' || state === 'disconnected' || state === 'new')
        throw error
      }

      if (typeof data === 'string' && data.length > DATA_CHUNK_THRESHOLD) {
        const id = `${Date.now().toString(36)}-${(dataChunkCounter++).toString(36)}`
        const total = Math.ceil(data.length / DATA_CHUNK_SLICE)
        for (let seq = 0; seq < total; seq++) {
          target.channel.send(JSON.stringify({
            t: DATA_CHUNK_FRAME,
            i: id,
            s: seq,
            n: total,
            d: data.slice(seq * DATA_CHUNK_SLICE, (seq + 1) * DATA_CHUNK_SLICE),
          }))
        }
        return target
      }

      target.channel.send(data)
      return target
    },

    get mesh() {
      return mesh
    },
    get peerId() {
      return peerId
    },
    get isRegistered() {
      return registered
    },
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', unloadHandler, { once: true })
    // pagehide is the reliable teardown event in Safari and on mobile.
    window.addEventListener('pagehide', pageHideHandler)
    window.addEventListener('unload', unloadHandler, { once: true })
    // bfcache: restore from back/forward cache.
    window.addEventListener('pageshow', handlePageShow)
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange)
    // Page Lifecycle API: fires when a frozen tab is thawed back to active.
    // This is distinct from visibilitychange and fires first on resume.
    document.addEventListener('resume', handleSuspendRestore)
    // Page Lifecycle API: fires just before the tab CPU is suspended.
    document.addEventListener('freeze', handleFreeze)
  }

  if (autoConnect) client.connect()

  return client
}
