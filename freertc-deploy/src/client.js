// Backoff config for reconnect
const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 30000
const BACKOFF_FACTOR = 1.5
const DATA_PING_MS = 1000
const DATA_PONG_TIMEOUT_MS = 4000
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

    // Reset the pong clock the moment the tab becomes visible so the
    // throttled-timer gap doesn't look like a timeout.
    function onVisible() {
      if (typeof document === 'undefined' || document.hidden) return
      // Any ping that was sent while the tab was hidden can't have been
      // answered; don't count that gap as a missed pong.
      lastPingSentAt = 0
      lastPongAt = Date.now()
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
      lastPongAt = Date.now()
      _acquireWakeLock()

      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible)
        document.addEventListener('visibilitychange', onVisible)
      }

      const openEntry = mesh.connections.get(remotePeerId)
      if (openEntry?.connection === pc) {
        openEntry.channel = channel
        openEntry.lastSeen = Date.now()
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
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed'
          || pc.connectionState === 'disconnected') {
          // The inverse zombie: the channel still reports 'open' but the
          // connection under it is dead, so every send fails as the same
          // uncatchable async console error. The connection's word beats
          // the channel's; execute this one on the spot too.
          closeBrokenChannel(`connection ${pc.connectionState}`)
          return
        }

        // Browsers throttle timers in hidden tabs — don't falsely time out.
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

        try {
          channel.send(JSON.stringify({ type: 'ping', ts: Date.now() }))
          lastPingSentAt = Date.now()
        } catch {
          closeBrokenChannel('data channel keepalive send failed')
        }
      }, DATA_PING_MS)
    }

    channel.onmessage = (event) => {
      const currentEntry = mesh.connections.get(remotePeerId)
      if (currentEntry?.connection !== pc || currentEntry.channel !== channel) return
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        onDataMessage?.({ peerId: remotePeerId, data: event.data })
        return
      }

      if (msg?.type === 'ping') {
        try {
          channel.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
        } catch {
          closeBrokenChannel('data channel pong send failed')
        }
        return
      }

      if (msg?.type === 'pong') {
        lastPongAt = Date.now()
        lastPingSentAt = 0
        return
      }

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
      // A channel can keep reporting 'open' after its connection has died —
      // WebKit then fails the send with an async console error no catch can
      // see, so a readyState guard alone still sends into corpses. A send is
      // only attempted over a live connection; a dead one throws, which is
      // the synchronous signal callers use to release the peer.
      const channelIsLive = (entry) => {
        if (entry?.channel?.readyState !== 'open') return false
        const state = entry.connection?.connectionState
        return state !== 'failed' && state !== 'closed' && state !== 'disconnected'
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
      if (!channelIsLive(target)) {
        throw new Error(`WebRTC connection is ${target.connection?.connectionState}`)
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
