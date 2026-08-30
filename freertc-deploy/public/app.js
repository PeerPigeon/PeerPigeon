import { createApp, computed, nextTick, onMounted, ref, watch } from "https://unpkg.com/vue@3.5.13/dist/vue.esm-browser.prod.js";

const PSP_VERSION = "1.0";
const PSP_SPEC_URL = "https://github.com/draeder/Peer-Signaling-Protocol-Specification";
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ]
};
const SHARED_IDS_KEY = "freertc.scopes.v2";
const UI_PREFS_KEY = "freertc.ui.prefs.v1";
const DATA_PING_MS = 3000;
const DATA_PONG_TIMEOUT_MS = 12000;

function newId(prefix = "msg") {
  return `${prefix}-${crypto.randomUUID()}`;
}

function now() {
  return Date.now();
}

function activeRtcConfig() {
  return {
    ...RTC_CONFIG,
    iceServers: RTC_CONFIG.iceServers
  };
}

async function waitForIceGatheringComplete(pc, timeoutMs = 4000) {
  if (!pc || pc.iceGatheringState === "complete") {
    return;
  }
  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        pc.removeEventListener("icegatheringstatechange", onChange);
      } catch {
        // no-op
      }
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") {
        done();
      }
    };
    const timer = setTimeout(done, timeoutMs);
    try {
      pc.addEventListener("icegatheringstatechange", onChange);
      onChange();
    } catch {
      done();
    }
  });
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function randomHex(bytes = 32) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
}

function isValidPeerId(value) {
  if (typeof value !== "string") {
    return false;
  }
  const peerId = value.trim();
  if (!peerId || peerId.length > 256) {
    return false;
  }

  // Strict profile: token-safe IDs only (no whitespace) and fingerprint-like length.
  if (!/^[A-Za-z0-9._:/-]+$/.test(peerId)) {
    return false;
  }

  // Accept common fingerprint styles and app IDs that are long enough to avoid weak collisions.
  const isHexFingerprint = /^[a-f0-9]{40,128}$/i.test(peerId);
  const isMultibaseLike = /^[zbu][A-Za-z0-9]{16,}$/i.test(peerId);
  const isOpaqueStrongToken = peerId.length >= 16;
  return isHexFingerprint || isMultibaseLike || isOpaqueStrongToken;
}

function isSpecToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,128}$/.test(value);
}

function normalizePeerId(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function normalizeText(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

createApp({
  setup() {
    const host = window.location.host;
    const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";

    const wsUrl = ref(`${wsScheme}://${host}/ws`);
    const status = ref("disconnected");
    const socket = ref(null);

    const network = ref("network:test");

    function normalizedWsUrlValue() {
      const trimmed = normalizeText(wsUrl.value);
      return trimmed || `${wsScheme}://${host}/ws`;
    }

    function normalizedNetworkValue() {
      const trimmed = normalizeText(network.value);
      return trimmed || "network:test";
    }

    function normalizedAppliedNetworkValue() {
      return normalizeText(appliedNetwork.value) || normalizedNetworkValue();
    }

    function normalizedAppliedRoomValue() {
      return normalizeText(appliedSessionId.value) || normalizeText(sessionId.value) || "room:test";
    }

    // Keep peer identity in-memory per tab so duplicate tabs cannot share IDs.
    function getOrAssignPeerId() {
      return randomHex();
    }

    const fromPeer = ref(getOrAssignPeerId());
    const appliedWsUrl = ref(wsUrl.value);
    const appliedNetwork = ref(network.value);
    const appliedFromPeer = ref(fromPeer.value);
    const toPeer = ref("");
    const sessionId = ref("");
    const appliedSessionId = ref("");
    // PSP instance_id is the network scope; keep one canonical value so they
    // can never drift apart in the UI or on the wire.
    const instanceId = computed(() => normalizedAppliedNetworkValue());

    const activeView = ref("webrtc");
    const relayType = ref("announce");
    const relayBody = ref('{\n  "roles": ["peer"]\n}');

    const rtcPhase = ref("idle");
    const rtcState = ref("new");
    const dataState = ref("closed");
    const chatInput = ref("");
    const chatSendMode = ref("broadcast");
    const selectedTargetPeers = ref([]);
    const chatLog = ref([]);
    const chatThreadRef = ref(null);
    const debugExpanded = ref(false);

    const discoveredPeers = ref([]);
    const autoDiscovery = ref(true);
    const autoConnect = ref(true);
    const partialMesh = ref(true);
    const partialMeshMaxPeers = ref(4);
    const meshConnectedCount = ref(0);
    const meshTargetCount = ref(0);
    const specLinkFlash = ref(false);
    const pingFlash = ref(false);
    const discoverFlash = ref(false);
    const announceFlash = ref(false);
    const pingButtonText = ref("ping");

    let discoveryTimer = null;
    let reconnectTimer = null;
    let specLinkFlashTimer = null;
    let pingFlashTimer = null;
    let discoverFlashTimer = null;
    let announceFlashTimer = null;
    let pendingPingStartedAt = 0;
    let lastDiscoverSyncAt = 0;
    let manualDisconnect = false;
    let stoppingRtc = false;
    let reconnectLockedByBye = false;
    let _wakeLock = null;
    const CONNECT_REQUEST_TIMEOUT_MS = 10000; // 10 second timeout
    const DISCOVER_SYNC_INTERVAL_MS = 10000;
    const FAILED_PEER_COOLDOWN_MS = 5000;
    const BYE_COOLDOWN_MS = 30000;
    const LIVE_PEER_MAX_AGE_MS = 25000;
    const LINK_GRACE_MS = 45000;
    const failedPeerCooldowns = new Map();
    const byeCooldowns = new Map();
    const meshLinks = new Map();

    const logs = ref([]);

    const isConnected = computed(() => status.value === "connected");
    const canConnect = computed(() => {
      const ws = socket.value;
      if (!ws) {
        return status.value !== "connecting";
      }
      return ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED;
    });
    const canDisconnect = computed(() => {
      const ws = socket.value;
      if (!ws) {
        return status.value === "connecting" || status.value === "connected";
      }
      return ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN;
    });
    const canRunRtc = computed(() => isConnected.value && (Boolean(toPeer.value) || autoDiscovery.value));
    const chatMessages = computed(() =>
      chatLog.value.filter((entry) => entry.kind === "incoming" || entry.kind === "outgoing")
    );
    const chatEmptyMessage = computed(() => {
      const connectedPeers = meshConnectedCount.value;
      if (!isConnected.value) {
        return "Connect socket to begin.";
      }
      if (connectedPeers > 0 && chatSendMode.value === "broadcast") {
        return `Connected to ${connectedPeers} peer(s). Broadcast is ready.`;
      }
      if (!toPeer.value) {
        return connectedPeers > 0
          ? `Connected to ${connectedPeers} peer(s). Choose a peer for target mode.`
          : "Connected. Waiting for peers...";
      }
      if (dataState.value !== "open") {
        if (connectedPeers > 0) {
          return `Connected to ${connectedPeers} peer(s). Selected peer is still negotiating.`;
        }
        if (["requesting", "waiting-offer", "accepted", "offered", "answering", "answered", "connected-pending"].includes(rtcPhase.value)) {
          return "Connected to peer. Negotiating DataChannel...";
        }
        return "Peer selected. Start Auto Handshake to open the DataChannel.";
      }
      return "DataChannel is open. Send a message to start chatting.";
    });
    const fromPeerDisplay = computed(() => {
      const peer = normalizePeerId(fromPeer.value);
      if (!peer) {
        return "none";
      }
      if (peer.length <= 28) {
        return peer;
      }
      return `${peer.slice(0, 12)}...${peer.slice(-12)}`;
    });
    const targetPeerDisplay = computed(() => {
      const peer = normalizePeerId(toPeer.value);
      if (!peer) {
        return "waiting";
      }
      if (peer.length <= 28) {
        return peer;
      }
      return `${peer.slice(0, 12)}...${peer.slice(-12)}`;
    });
    const relayTargetDisplay = computed(() => {
      if (!toPeer.value) {
        return "broadcast";
      }
      return targetPeerDisplay.value;
    });
    const sendRouteDisplay = computed(() => {
      if (chatSendMode.value === "broadcast") {
        const count = meshConnectedCount.value;
        return count > 0 ? `broadcast (${count} peers)` : "broadcast (0 peers)";
      }
      const selected = selectedTargetPeers.value;
      if (selected.length > 1) {
        return "target (multiple)";
      }
      if (selected.length === 1) {
        return `target (${shortPeer(selected[0])})`;
      }
      return toPeer.value ? `target (${targetPeerDisplay.value})` : "target (none)";
    });
    const sendRouteTooltip = computed(() => {
      if (chatSendMode.value !== "target") {
        return "";
      }
      if (selectedTargetPeers.value.length > 0) {
        return selectedTargetPeers.value.join("\n");
      }
      return toPeer.value || "";
    });
    const specWarnings = computed(() => {
      const warnings = [];
      const ws = normalizeText(wsUrl.value);
      try {
        const parsed = new URL(ws);
        if (!["ws:", "wss:"].includes(parsed.protocol)) {
          warnings.push("Signaling Server URL must use ws:// or wss://");
        }
      } catch {
        warnings.push("Signaling Server URL must be a valid absolute WebSocket URL");
      }

      const networkScope = normalizeText(network.value);
      if (!networkScope) {
        warnings.push("Network is required");
      } else if (!isSpecToken(networkScope)) {
        warnings.push("Network should be 1-128 chars using A-Z, a-z, 0-9, . _ : / -");
      }

      const localPeer = normalizePeerId(fromPeer.value);
      if (!isValidPeerId(localPeer)) {
        warnings.push("Your Peer ID should be a token-safe, fingerprint-like ID (no spaces, typically >=16 chars)");
      }

      const target = normalizePeerId(toPeer.value);
      if (target && !isValidPeerId(target)) {
        warnings.push("To Peer must be empty or a token-safe, fingerprint-like peer ID");
      }

      const roomScope = normalizeText(sessionId.value);
      if (!roomScope) {
        warnings.push("Room is required");
      } else if (!isSpecToken(roomScope)) {
        warnings.push("Room should be 1-128 chars using A-Z, a-z, 0-9, . _ : / -");
      }

      return warnings;
    });
    const specWarningCount = computed(() => specWarnings.value.length);
    const specPillLabel = computed(() => (specLinkFlash.value ? "OK" : "PSP Spec"));
    const pingButtonLabel = computed(() => pingButtonText.value);
    const discoverButtonLabel = computed(() => (discoverFlash.value ? "OK" : "discover"));
    const announceButtonLabel = computed(() => (announceFlash.value ? "OK" : "announce"));
    const meshPeers = computed(() => {
      // Depend on mesh counters so this recomputes when link map state changes.
      void meshTargetCount.value;
      void meshConnectedCount.value;
      const isNegotiatingPhase = (phase) =>
        ["requesting", "waiting-offer", "accepted", "offered", "answering", "answered", "connected-pending", "ready"].includes(phase);

      return getVisiblePeerIds()
        .map((peerId) => {
          const link = getMeshLink(peerId, false);
          const dataStateValue = link?.dc?.readyState ?? link?.dataState ?? "closed";
          const role = fromPeer.value && peerId && fromPeer.value.localeCompare(peerId) < 0 ? "initiator" : "responder";
          const errorState = ["failed", "disconnected"].includes(link?.rtcState) || link?.phase === "rejected";
          const negotiatingState = isNegotiatingPhase(link?.phase);
          const statusTone = dataStateValue === "open" ? "ok" : errorState ? "error" : negotiatingState ? "warn" : "idle";
          const statusLabel = dataStateValue === "open" ? "connected" : errorState ? "error" : negotiatingState ? "negotiating" : "idle";
          return {
            peerId,
            display: shortPeer(peerId),
            selected: selectedTargetPeers.value.includes(peerId),
            phase: link?.phase ?? "idle",
            rtcState: link?.rtcState ?? "new",
            dataState: dataStateValue,
            connected: dataStateValue === "open",
            role,
            statusTone,
            statusLabel
          };
        })
        .sort((left, right) => {
          if (left.selected !== right.selected) {
            return left.selected ? -1 : 1;
          }
          if (left.connected !== right.connected) {
            return left.connected ? -1 : 1;
          }
          return left.peerId.localeCompare(right.peerId);
        });
    });

    const logsText = computed(() => {
      return logs.value
        .map((entry) => {
          const payload =
            typeof entry.payload === "string"
              ? entry.payload
              : JSON.stringify(entry.payload, null, 2);
          return `[${entry.at}] ${entry.label}\n${payload}`;
        })
        .join("\n\n");
    });
    const logCount = computed(() => logs.value.length);
    const logPreviewEntries = computed(() => {
      return logs.value.slice(0, 4).map((entry, index) => {
        let preview = "";
        if (typeof entry.payload === "string") {
          preview = entry.payload;
        } else if (entry.payload && typeof entry.payload === "object") {
          const type = entry.payload.type;
          const from = entry.payload.from ? `from ${shortPeer(entry.payload.from)}` : "";
          const to = entry.payload.to ? `to ${shortPeer(entry.payload.to)}` : "";
          const summary = [type, from, to].filter(Boolean).join(" • ");
          preview = summary || JSON.stringify(entry.payload);
        } else {
          preview = String(entry.payload ?? "");
        }

        preview = preview.replace(/\s+/g, " ").trim();
        if (preview.length > 92) {
          preview = `${preview.slice(0, 89)}...`;
        }

        return {
          id: `${entry.at}-${entry.label}-${index}`,
          at: new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          label: entry.label,
          preview: preview || "(no payload)"
        };
      });
    });
    const logHeadline = computed(() => {
      if (!logPreviewEntries.value.length) {
        return "No events yet";
      }
      const latest = logPreviewEntries.value[0];
      return `${logCount.value} events • latest ${latest.label} @ ${latest.at}`;
    });

    function pushLog(label, payload) {
      const line = {
        at: new Date().toISOString(),
        label,
        payload
      };
      logs.value.unshift(line);
      if (logs.value.length > 200) {
        logs.value.length = 200;
      }
    }

    function handleSpecLinkClick() {
      specLinkFlash.value = true;
      if (specLinkFlashTimer) {
        clearTimeout(specLinkFlashTimer);
      }
      specLinkFlashTimer = setTimeout(() => {
        specLinkFlash.value = false;
        specLinkFlashTimer = null;
      }, 900);
    }

    function flashPingButton() {
      if (pingFlashTimer) {
        clearTimeout(pingFlashTimer);
      }
      pingFlash.value = true;
      pingFlashTimer = setTimeout(() => {
        pingFlash.value = false;
        pingButtonText.value = "ping";
        pingFlashTimer = null;
      }, 1200);
    }

    function flashDiscoverButton() {
      discoverFlash.value = true;
      if (discoverFlashTimer) {
        clearTimeout(discoverFlashTimer);
      }
      discoverFlashTimer = setTimeout(() => {
        discoverFlash.value = false;
        discoverFlashTimer = null;
      }, 700);
    }

    function flashAnnounceButton() {
      announceFlash.value = true;
      if (announceFlashTimer) {
        clearTimeout(announceFlashTimer);
      }
      announceFlashTimer = setTimeout(() => {
        announceFlash.value = false;
        announceFlashTimer = null;
      }, 700);
    }

    function pushChatMessage(text, kind = "system") {
      chatLog.value.push({
        id: newId("chat"),
        text,
        kind,
        at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      });
      if (chatLog.value.length > 120) {
        chatLog.value.shift();
      }
    }

    function scrollChatToLatest() {
      nextTick(() => {
        const el = chatThreadRef.value;
        if (!el) {
          return;
        }
        el.scrollTop = el.scrollHeight;
      });
    }

    watch(
      () => chatMessages.value.map((entry) => entry.id).join(","),
      () => {
        scrollChatToLatest();
      }
    );

    function shortPeer(peerId) {
      const peer = normalizePeerId(peerId);
      if (!peer) {
        return "none";
      }
      if (peer.length <= 22) {
        return peer;
      }
      return `${peer.slice(0, 8)}...${peer.slice(-8)}`;
    }

    function getMeshLink(peerId, create = true) {
      if (!peerId) {
        return null;
      }
      let link = meshLinks.get(peerId);
      if (!link && create) {
        link = {
          pc: null,
          dc: null,
          phase: "idle",
          rtcState: "new",
          dataState: "closed",
          connectRequested: false,
          connectRequestTime: 0,
          offerWaitTime: 0,  // Tracks when responder started waiting for offer
          answerWaitTime: 0,  // Tracks when initiator started waiting for answer
          pendingCandidates: [],
          pendingAnswer: null,
          pendingAnswerPc: null,
          lastSignalAt: now()
        };
        meshLinks.set(peerId, link);
        refreshMeshStats();
      }
      return link || null;
    }

    function isNegotiatingPhase(phase) {
      return ["requesting", "waiting-offer", "accepted", "offering", "offered", "answering", "answered", "connected-pending", "ready"].includes(phase);
    }

    function shouldKeepLinkWithoutAnnouncement(link) {
      if (!link) {
        return false;
      }
      // Guard against stale browser state where DC reports open after PC failed.
      if (["failed", "closed"].includes(link.rtcState) && link.dc?.readyState === "open") {
        return false;
      }
      if (link.dc?.readyState === "open") {
        return true;
      }
      if (isNegotiatingPhase(link.phase)) {
        return true;
      }
      const lastSignalAt = Number(link.lastSignalAt || 0);
      return lastSignalAt > 0 && now() - lastSignalAt <= LINK_GRACE_MS;
    }

    async function flushPendingIceCandidates(peerId, link) {
      const target = link || getMeshLink(peerId, false);
      if (!target?.pc || !target.pc.remoteDescription) {
        return;
      }
      const queued = Array.isArray(target.pendingCandidates) ? target.pendingCandidates : [];
      if (queued.length === 0) {
        return;
      }
      target.pendingCandidates = [];
      for (const candidate of queued) {
        try {
          await target.pc.addIceCandidate(candidate);
        } catch (error) {
          pushLog("rtc:ice-error", error?.message || `failed to apply queued candidate from ${peerId}`);
        }
      }
    }

    function refreshMeshStats() {
      // Count only local WebRTC links with an open DataChannel.
      const openPeerIds = getVisiblePeerIds();
      meshConnectedCount.value = openPeerIds.length;
      meshTargetCount.value = openPeerIds.length;
    }

    function getVisiblePeerIds() {
      const visible = new Set();
      for (const [peerId, link] of meshLinks.entries()) {
        if (!peerId || peerId === fromPeer.value) {
          continue;
        }
        if (
          link?.dc?.readyState === "open" &&
          !["failed", "closed", "disconnected"].includes(link?.rtcState)
        ) {
          visible.add(peerId);
        }
      }

      return Array.from(visible.values());
    }

    function selectedPeerId() {
      // toPeer must point to an announced peer or be empty.
      if (toPeer.value) {
        const isAnnounced = discoveredPeers.value.some((p) => p?.peer_id === toPeer.value);
        if (isAnnounced) {
          return toPeer.value;
        }
        // Stale peer reference; clear it.
        toPeer.value = "";
      }

      // If there is an active open link, prefer it for panel status.
      for (const [peerId, link] of meshLinks.entries()) {
        if (!peerId || peerId === fromPeer.value) {
          continue;
        }
        if (link?.dc?.readyState === "open") {
          return peerId;
        }
      }

      // Otherwise pick the first known non-self mesh link before falling back to peer_list.
      for (const peerId of meshLinks.keys()) {
        if (peerId && peerId !== fromPeer.value) {
          return peerId;
        }
      }

      if (discoveredPeers.value.length > 0) {
        return discoveredPeers.value[0].peer_id;
      }
      return "";
    }

    function refreshSelectedPeerSnapshot() {
      const peerId = selectedPeerId();
      if (!peerId) {
        rtcPhase.value = "idle";
        rtcState.value = "new";
        dataState.value = "closed";
        return;
      }

      const link = getMeshLink(peerId, false);
      if (!link) {
        rtcPhase.value = "idle";
        rtcState.value = "new";
        dataState.value = "closed";
        return;
      }

      rtcPhase.value = link.phase;
      rtcState.value = link.rtcState;
      dataState.value = link.dataState;
    }

    function initSharedIds() {
      const params = new URLSearchParams(window.location.search);
      const roomParam = normalizeText(
        params.get("room") ||
        params.get("room_id") ||
        params.get("roomId") ||
        params.get("session_id") ||
        params.get("sessionId")
      );
      const networkParam = normalizeText(
        params.get("network") ||
        params.get("network_id") ||
        params.get("networkId") ||
        params.get("instance_id") ||
        params.get("instanceId")
      );

      const hasValidUrlRoom = isSpecToken(roomParam);
      const hasValidUrlNetwork = isSpecToken(networkParam);

      if (roomParam && !hasValidUrlRoom) {
        pushLog("room:error", "Ignoring invalid URL room");
      }
      if (networkParam && !hasValidUrlNetwork) {
        pushLog("network:error", "Ignoring invalid URL network");
      }

      const nextNetwork = hasValidUrlNetwork ? networkParam : normalizedNetworkValue();
      const nextRoom = hasValidUrlRoom ? roomParam : `room-${Math.random().toString(36).slice(2, 10)}`;
      if (nextNetwork && nextNetwork !== network.value) {
        network.value = nextNetwork;
      }
      if (nextNetwork && nextNetwork !== appliedNetwork.value) {
        appliedNetwork.value = nextNetwork;
      }
      sessionId.value = nextRoom;
      appliedSessionId.value = nextRoom;

      persistSharedIds();
    }

    function persistSharedIds() {
      const canonicalNetwork = normalizedNetworkValue();
      const canonicalRoom = normalizeText(sessionId.value) || "room:test";
      network.value = canonicalNetwork;
      sessionId.value = canonicalRoom;

      localStorage.setItem(
        SHARED_IDS_KEY,
        JSON.stringify({
          network: canonicalNetwork,
          room: canonicalRoom,
          instance_id: canonicalNetwork,
          session_id: canonicalRoom
        })
      );

      const url = new URL(window.location.href);
      url.searchParams.set("network", canonicalNetwork);
      url.searchParams.set("room", canonicalRoom);
      url.searchParams.delete("network_id");
      url.searchParams.delete("networkId");
      url.searchParams.delete("room_id");
      url.searchParams.delete("roomId");
      url.searchParams.delete("session_id");
      url.searchParams.delete("sessionId");
      url.searchParams.delete("instance_id");
      url.searchParams.delete("instanceId");
      window.history.replaceState(null, "", url);

      pushLog("scope", {
        network: canonicalNetwork,
        room: canonicalRoom,
        instance_id: canonicalNetwork,
        session_id: canonicalRoom
      });
    }

    function normalizeMeshLimit(value) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return 4;
      }
      return Math.max(1, Math.min(99, Math.floor(parsed)));
    }

    function persistUiPrefs() {
      try {
        sessionStorage.setItem(
          UI_PREFS_KEY,
          JSON.stringify({
            ws_url: normalizedWsUrlValue(),
            network: normalizedNetworkValue(),
            partial_mesh: Boolean(partialMesh.value),
            partial_mesh_max_peers: normalizeMeshLimit(partialMeshMaxPeers.value),
            chat_send_mode: chatSendMode.value === "target" ? "target" : "broadcast",
            active_view: activeView.value === "console" ? "console" : "webrtc"
          })
        );
      } catch {
        // Ignore storage write errors (private mode/quota).
      }
    }

    function loadUiPrefs() {
      try {
        const raw = sessionStorage.getItem(UI_PREFS_KEY);
        if (!raw) {
          return;
        }
        const saved = safeJsonParse(raw, null);
        if (!saved || typeof saved !== "object") {
          return;
        }

        const savedWs = normalizeText(saved.ws_url);
        if (savedWs) {
          wsUrl.value = savedWs;
          appliedWsUrl.value = savedWs;
        }

        const savedNetwork = normalizeText(saved.network);
        if (savedNetwork) {
          network.value = savedNetwork;
          appliedNetwork.value = savedNetwork;
        }

        if (typeof saved.partial_mesh === "boolean") {
          partialMesh.value = saved.partial_mesh;
        }

        partialMeshMaxPeers.value = normalizeMeshLimit(saved.partial_mesh_max_peers);

        if (saved.chat_send_mode === "target" || saved.chat_send_mode === "broadcast") {
          chatSendMode.value = saved.chat_send_mode;
        }

        if (saved.active_view === "console" || saved.active_view === "webrtc") {
          activeView.value = saved.active_view;
        }
      } catch {
        // Ignore storage read/parse errors.
      }
    }

    function switchScope(nextNetworkValue, nextRoomValue, message) {
      const nextNetwork = normalizeText(nextNetworkValue) || "network:test";
      const nextRoom = normalizeText(nextRoomValue) || "room:test";
      const previousNetwork = appliedNetwork.value || normalizedNetworkValue();
      const previousRoom = appliedSessionId.value || normalizeText(sessionId.value);
      const changed = nextNetwork !== previousNetwork || nextRoom !== previousRoom;

      if (!changed) {
        network.value = nextNetwork;
        sessionId.value = nextRoom;
        persistSharedIds();
        return;
      }

      // Leave using the previously applied scope before changing the values on
      // the wire. This prevents an existing direct channel from surviving a
      // Network or Room change.
      network.value = previousNetwork;
      sessionId.value = previousRoom;
      if (isConnected.value) {
        const peers = new Set([
          ...Array.from(meshLinks.keys()),
          ...discoveredPeers.value.map((peer) => peer?.peer_id).filter((peerId) => typeof peerId === "string")
        ]);
        for (const peerId of peers) {
          if (peerId && peerId !== fromPeer.value) {
            sendRelayEnvelope("bye", { reason: "scope_changed" }, { to: peerId });
          }
        }
        sendWithdraw();
      }

      reconnectLockedByBye = false;
      byeCooldowns.clear();
      failedPeerCooldowns.clear();
      toPeer.value = "";
      discoveredPeers.value = [];
      stopAutomation();
      stopRtc();
      meshLinks.clear();

      network.value = nextNetwork;
      sessionId.value = nextRoom;
      appliedNetwork.value = nextNetwork;
      appliedSessionId.value = nextRoom;
      persistSharedIds();
      refreshMeshStats();
      refreshSelectedPeerSnapshot();
      pushLog("scope", message || `Switched to network ${nextNetwork}, room ${nextRoom}`);

      if (isConnected.value) {
        void beginRtc();
      }
    }

    function regenerateNetworkAndRoom() {
      switchScope(
        `network-${Math.random().toString(36).slice(2, 10)}`,
        `room-${Math.random().toString(36).slice(2, 10)}`,
        "Generated a new Network and Room"
      );
    }

    function regeneratePeerId() {
      fromPeer.value = randomHex();
      appliedFromPeer.value = fromPeer.value;
      toPeer.value = "";
      stopRtc();
      pushLog("ids", { peer_id: fromPeer.value });

      if (isConnected.value) {
        sendAnnounce({ feedback: false });
        sendDiscover({ feedback: false });
      }
    }

    function applyNetworkChange() {
      const next = normalizeText(network.value) || "network:test";
      switchScope(next, sessionId.value, `Switched network to ${next}`);
    }

    function applyRoomChange() {
      const next = normalizeText(sessionId.value) || "room:test";
      switchScope(network.value, next, `Switched room to ${next}`);
    }

    function applyWsUrlChange() {
      const next = normalizeText(wsUrl.value);
      const resolved = next || `${wsScheme}://${host}/ws`;
      const changed = resolved !== appliedWsUrl.value;
      wsUrl.value = resolved;

      if (!changed) {
        return;
      }
      appliedWsUrl.value = resolved;

      pushLog("socket", `Updated signaling URL: ${wsUrl.value}`);
      if (socket.value && (socket.value.readyState === WebSocket.CONNECTING || socket.value.readyState === WebSocket.OPEN)) {
        disconnect();
        manualDisconnect = false;
        connect();
      }
    }

    function applyFromPeerChange() {
      const previous = appliedFromPeer.value;
      const next = normalizePeerId(fromPeer.value);
      if (!next) {
        fromPeer.value = previous;
        return;
      }

      if (!isValidPeerId(next)) {
        pushLog("ids:error", "Peer ID must be token-safe with no spaces and usually >=16 chars");
        fromPeer.value = previous;
        return;
      }

      if (next === previous) {
        fromPeer.value = previous;
        return;
      }

      fromPeer.value = next;
      appliedFromPeer.value = next;
      reconnectLockedByBye = false;
      byeCooldowns.clear();
      failedPeerCooldowns.clear();
      toPeer.value = "";
      discoveredPeers.value = [];

      stopAutomation();
      stopRtc();
      meshLinks.clear();
      refreshMeshStats();
      refreshSelectedPeerSnapshot();
      pushLog("ids", { peer_id: fromPeer.value });

      if (isConnected.value) {
        void beginRtc();
      }
    }

    function sendEnvelope(envelope) {
      if (!socket.value || socket.value.readyState !== WebSocket.OPEN) {
        pushLog("client:error", "Socket is not connected");
        return false;
      }

      // Keep network token stable even if the editable field has trailing spaces.
      const stableNetwork = normalizedAppliedNetworkValue();

      const outbound = {
        ...envelope,
        network: stableNetwork
      };

      socket.value.send(JSON.stringify(outbound));
      pushLog("client:send", outbound);
      return true;
    }

    function sendRelayEnvelope(type, body, override = {}) {
      const hasExplicitTarget = Object.prototype.hasOwnProperty.call(override, "to");
      const target = hasExplicitTarget ? override.to : toPeer.value || null;

      if (!target && !hasExplicitTarget) {
        pushLog("client:error", "No target peer selected yet");
        return false;
      }

      return sendEnvelope({
        psp_version: PSP_VERSION,
        type,
        network: network.value,
        from: fromPeer.value,
        to: target,
        session_id: normalizedAppliedRoomValue(),
        message_id: newId(type),
        timestamp: now(),
        ttl_ms: 30000,
        body,
        ...override
      });
    }

    function connect() {
      manualDisconnect = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      const existing = socket.value;
      if (existing && (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN)) {
        return;
      }
      if (!canConnect.value) {
        return;
      }

      if (existing && (existing.readyState === WebSocket.CLOSING || existing.readyState === WebSocket.CLOSED)) {
        socket.value = null;
      }

      status.value = "connecting";
      const resolvedWsUrl = normalizedWsUrlValue();
      if (resolvedWsUrl !== wsUrl.value) {
        wsUrl.value = resolvedWsUrl;
      }

      let ws;
      try {
        ws = new WebSocket(resolvedWsUrl);
      } catch (error) {
        status.value = "disconnected";
        socket.value = null;
        pushLog("socket:error", error?.message || "failed to create websocket");
        return;
      }
      socket.value = ws;

      ws.onopen = () => {
        status.value = "connected";
        pushLog("socket", `connected to ${resolvedWsUrl}`);
        // Auto-start handshake on connect
        void beginRtc();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          pushLog("server:recv", msg);
          void onServerEnvelope(msg);
        } catch {
          pushLog("server:recv", event.data);
        }
      };

      ws.onerror = () => {
        pushLog("socket:error", "WebSocket error");
        if (ws.readyState !== WebSocket.OPEN) {
          status.value = "disconnected";
        }
      };

      ws.onclose = () => {
        status.value = "disconnected";
        socket.value = null;
        pendingPingStartedAt = 0;
        pingButtonText.value = "ping";
        pingFlash.value = false;
        stopAutoLoop();
        stopRtc();
        pushLog("socket", "closed");

        // Stay fully hands-off: reconnect automatically unless user explicitly disconnected.
        if (!manualDisconnect) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (!socket.value) {
              connect();
            }
          }, 1200);
        }
      };
    }

    function disconnect() {
      manualDisconnect = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (!socket.value) {
        status.value = "disconnected";
        stopAutoLoop();
        stopRtc();
        return;
      }
      const ws = socket.value;
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "client requested close");
      }
      socket.value = null;
      status.value = "disconnected";
      stopAutoLoop();
      stopRtc();
    }

    function sendAnnounce(options = {}) {
      const { feedback = true } = options;
      const sent = sendEnvelope({
        psp_version: PSP_VERSION,
        type: "announce",
        network: network.value,
        from: fromPeer.value,
        to: null,
        session_id: normalizedAppliedRoomValue(),
        message_id: newId("announce"),
        timestamp: now(),
        ttl_ms: 30000,
        body: {
          instance_id: instanceId.value,
          roles: ["peer"],
          capabilities: {
            trickle_ice: true,
            datachannel: true,
            media: false
          },
          hints: {
            wants_peers: true,
            max_peers: partialMesh.value ? effectivePartialMeshLimit() : null
          }
        }
      });
      if (sent && feedback) {
        flashAnnounceButton();
      }
      return sent;
    }

    function sendWithdraw() {
      sendEnvelope({
        psp_version: PSP_VERSION,
        type: "withdraw",
        network: network.value,
        from: fromPeer.value,
        to: null,
        session_id: normalizedAppliedRoomValue(),
        message_id: newId("withdraw"),
        timestamp: now(),
        ttl_ms: 30000,
        body: {
          reason: "peer_offline"
        }
      });
    }

    function sendDiscover(options = {}) {
      const { feedback = true } = options;
      const sent = sendEnvelope({
        psp_version: PSP_VERSION,
        type: "discover",
        network: network.value,
        from: fromPeer.value,
        to: null,
        session_id: normalizedAppliedRoomValue(),
        message_id: newId("discover"),
        timestamp: now(),
        ttl_ms: 30000,
        body: {
          limit: 16,
          exclude_peers: [fromPeer.value]
        }
      });
      if (sent && feedback) {
        flashDiscoverButton();
      }
      return sent;
    }

    function isMatchingSessionId(value) {
      return normalizeText(value) === normalizedAppliedRoomValue();
    }

    function sendPing(peerId = toPeer.value || null) {
      if (!peerId) {
        return false;
      }
      pendingPingStartedAt = performance.now();
      pingButtonText.value = "...";
      pingFlash.value = true;
      if (pingFlashTimer) {
        clearTimeout(pingFlashTimer);
        pingFlashTimer = null;
      }
      const sent = sendEnvelope({
        psp_version: PSP_VERSION,
        type: "ping",
        network: network.value,
        from: fromPeer.value,
        to: peerId,
        session_id: normalizedAppliedRoomValue(),
        message_id: newId("ping"),
        timestamp: now(),
        ttl_ms: 30000,
        body: {
          nonce: Math.random().toString(36).slice(2)
        }
      });
      if (!sent) {
        pendingPingStartedAt = 0;
        pingButtonText.value = "ping";
        pingFlash.value = false;
      }
      return sent;
    }

    function sendRelay() {
      let body;
      try {
        body = JSON.parse(relayBody.value);
      } catch {
        pushLog("client:error", "Relay body must be valid JSON");
        return;
      }

      // Manual relay defaults to broadcast when no target peer is selected.
      const relayTargetPeerId = normalizePeerId(toPeer.value);
      toPeer.value = relayTargetPeerId;
      sendRelayEnvelope(relayType.value, body, { to: relayTargetPeerId || null });
    }

    function isPeerCoolingDown(peerId) {
      const expiresAt = failedPeerCooldowns.get(peerId);
      if (!expiresAt) {
        return false;
      }
      if (expiresAt <= now()) {
        failedPeerCooldowns.delete(peerId);
        return false;
      }
      return true;
    }

    function isPeerInByeCooldown(peerId) {
      const expiresAt = byeCooldowns.get(peerId);
      if (!expiresAt) {
        return false;
      }
      if (expiresAt <= now()) {
        byeCooldowns.delete(peerId);
        return false;
      }
      return true;
    }

    function markPeerFailed(peerId, reason) {
      if (!peerId) {
        return;
      }
      failedPeerCooldowns.set(peerId, now() + FAILED_PEER_COOLDOWN_MS);
      pushLog("rtc", `Peer cooldown (${reason}): ${peerId}`);
    }

    function markPeerBye(peerId, reason) {
      if (!peerId) {
        return;
      }
      byeCooldowns.set(peerId, now() + BYE_COOLDOWN_MS);
      pushLog("rtc", `Peer hold (${reason}): ${peerId}`);
    }

    function isFreshPeerAnnouncement(peer) {
      const updated = Number(peer?.timestamp || 0);
      if (!Number.isFinite(updated) || updated <= 0) {
        return false;
      }
      return now() - updated <= LIVE_PEER_MAX_AGE_MS;
    }

    function failoverFromCurrentPeer(peerId, reason) {
      if (!peerId) {
        return;
      }
      markPeerFailed(peerId, reason);
      closeMeshLink(peerId);
      if (toPeer.value === peerId) {
        toPeer.value = "";
      }
      selectNextPeerAndConnect(reason);
    }

    function selectNextPeerAndConnect(reason = "fallback") {
      const selected = choosePeerFromList(discoveredPeers.value);
      if (selected) {
        selectPeer(selected.peer_id);
        maybeAutoConnectPeer(selected.peer_id);
        return true;
      }
      pushLog("rtc", `No available peer (${reason}); requesting discover`);
      sendDiscover();
      return false;
    }

    function choosePeerFromList(peers) {
      if (!Array.isArray(peers)) {
        return null;
      }

      const candidates = peers
        .filter((peer) => peer && typeof peer.peer_id === "string" && peer.peer_id !== fromPeer.value)
        .sort((a, b) => a.peer_id.localeCompare(b.peer_id));

      const readyCandidates = candidates.filter((peer) => !isPeerCoolingDown(peer.peer_id) && !isPeerInByeCooldown(peer.peer_id));
      if (readyCandidates.length > 0) {
        // Prefer peers we can initiate with, to avoid waiting forever for a remote offer.
        const initiatorPreferred = readyCandidates.filter((peer) => fromPeer.value.localeCompare(peer.peer_id) < 0);
        if (initiatorPreferred.length > 0) {
          return initiatorPreferred[0];
        }
        return readyCandidates[0];
      }

      // All peers are in cooldown; wait for cooldown expiry instead of immediate re-trying a known busy peer.
      return null;
    }

    function selectPeer(peerId, options = {}) {
      const { manual = false, allowUnannounced = false } = options;

      if (peerId === fromPeer.value) {
        pushLog("discovery:error", "Ignoring self peer selection");
        toPeer.value = "";
        return;
      }
      
      // Only allow selecting announced peers to prevent phantom links.
      const isAnnounced = discoveredPeers.value.some((p) => p?.peer_id === peerId);
      if (!isAnnounced && !allowUnannounced) {
        pushLog("discovery:error", `Cannot select unannounced peer: ${peerId}`);
        toPeer.value = "";
        return;
      }
      
      toPeer.value = peerId;
      if (manual && !reconnectLockedByBye) {
        byeCooldowns.delete(peerId);
      }
      getMeshLink(peerId);
      refreshSelectedPeerSnapshot();
      pushLog("discovery", `Selected target peer: ${peerId}`);
    }

    function selectPeerFromUi(peerId) {
      if (activeView.value === "console") {
        // In console mode, clicking a peer should always update relay target.
        selectPeer(peerId, { manual: true, allowUnannounced: true });
        return;
      }

      // Clicking mesh rows toggles multi-target chat routing.
      chatSendMode.value = "target";

      const idx = selectedTargetPeers.value.indexOf(peerId);
      if (idx >= 0) {
        const next = [...selectedTargetPeers.value];
        next.splice(idx, 1);
        selectedTargetPeers.value = next;
        if (toPeer.value === peerId) {
          toPeer.value = next[0] || "";
          refreshSelectedPeerSnapshot();
        }
        pushLog("discovery", `Unselected target peer: ${peerId}`);
        return;
      }

      selectedTargetPeers.value = [...selectedTargetPeers.value, peerId];
      selectPeer(peerId, { manual: true, allowUnannounced: true });
    }

    function startAutoLoop() {
      stopAutoLoop();

      // Send announce immediately on join.
      if (isConnected.value) {
        sendAnnounce({ feedback: false });
      }

      // Periodic connection management: pings, auto-connect, stale pruning, and TTL keep-alive.
      discoveryTimer = setInterval(() => {
        if (!isConnected.value) {
          return;
        }

        // Keep discovery state bounded so stale peers cannot accumulate forever.
        const dedupedPeers = new Map();
        for (const peer of discoveredPeers.value) {
          const peerId = peer?.peer_id;
          if (
            typeof peerId !== "string" ||
            peerId === fromPeer.value ||
            !isValidPeerId(peerId) ||
            !isFreshPeerAnnouncement(peer) ||
            !isMatchingSessionId(peer?.session_id)
          ) {
            continue;
          }
          dedupedPeers.set(peerId, peer);
        }
        discoveredPeers.value = Array.from(dedupedPeers.values());
        const announcedPeerIds = new Set(dedupedPeers.keys());

        for (const peerId of Array.from(meshLinks.keys())) {
          if (!peerId || peerId === fromPeer.value) continue;
          const link = getMeshLink(peerId, false);
          // If peer is not currently announced, keep links that are active/recent.
          if (!announcedPeerIds.has(peerId)) {
            if (shouldKeepLinkWithoutAnnouncement(link)) {
              continue;
            }
            closeMeshLink(peerId);
            meshLinks.delete(peerId);
            continue;
          }
          // Keep healthy or recently-active links for announced peers too.
          // Otherwise the periodic loop can tear down valid channels and cause flap/reconnect churn.
          if (shouldKeepLinkWithoutAnnouncement(link)) {
            continue;
          }

          // Prune idle/dead links for still-announced peers.
          closeMeshLink(peerId);
          meshLinks.delete(peerId);
        }

        // Re-announce every 3s to keep D1 TTL alive. Server suppresses peer_list broadcasts
        // for heartbeat re-announces, so this is cheap and ensures continuous peer discovery.
        sendAnnounce({ feedback: false });

        // Low-frequency discover keeps peer_list timestamps fresh when heartbeat broadcasts are suppressed.
        if (autoDiscovery.value && now() - lastDiscoverSyncAt >= DISCOVER_SYNC_INTERVAL_MS) {
          sendDiscover({ feedback: false });
          lastDiscoverSyncAt = now();
        }

        const peers = discoveredPeers.value
          .map((peer) => peer?.peer_id)
          .filter((peerId) => typeof peerId === "string" && peerId !== fromPeer.value);

        for (const peerId of peers) {
          const link = getMeshLink(peerId);
          if (link.dc && link.dc.readyState === "open") {
            // Data channel is open; WebRTC keepalive handles liveness, no signaling ping needed.
            continue;
          }

          // Detect dead peers: if PC is closed/failed while still in requesting phase, mark failed immediately.
          if (
            ["requesting", "waiting-offer"].includes(link.phase) &&
            link.pc &&
            ["closed", "failed"].includes(link.pc.connectionState)
          ) {
            markPeerFailed(peerId, `pc-${link.pc.connectionState}`);
            link.connectRequested = false;
            link.phase = "idle";
            continue;
          }

          // PSP Section 11.2: Responders should timeout if initiator doesn't send offer within 10s.
          if (
            link.phase === "accepted" &&
            link.offerWaitTime &&
            now() - link.offerWaitTime > CONNECT_REQUEST_TIMEOUT_MS
          ) {
            markPeerFailed(peerId, "offer-timeout");
            link.phase = "idle";
            link.offerWaitTime = 0;
            link.connectRequested = false;
            pushLog("rtc", `${peerId} did not send offer within timeout`);
            continue;
          }

          // PSP Section 12.2: Initiators should timeout if responder doesn't send answer within 10s.
          if (
            link.phase === "offered" &&
            link.answerWaitTime &&
            now() - link.answerWaitTime > CONNECT_REQUEST_TIMEOUT_MS
          ) {
            markPeerFailed(peerId, "answer-timeout");
            link.phase = "idle";
            link.answerWaitTime = 0;
            link.connectRequested = false;
            pushLog("rtc", `${peerId} did not send answer within timeout`);
            continue;
          }

          if (
            ["requesting", "waiting-offer"].includes(link.phase) &&
            link.connectRequestTime &&
            now() - link.connectRequestTime > CONNECT_REQUEST_TIMEOUT_MS
          ) {
            markPeerFailed(peerId, "connect-timeout");
            link.connectRequested = false;
            link.connectRequestTime = 0;
            link.phase = "idle";
          }

          if (autoConnect.value) {
            maybeAutoConnectPeer(peerId);
          }
        }

        refreshSelectedPeerSnapshot();
      }, 3000);
    }

    function stopAutoLoop() {
      if (discoveryTimer) {
        clearInterval(discoveryTimer);
        discoveryTimer = null;
      }
    }

    function requestConnect(peerId) {
      if (!peerId || !isConnected.value) {
        return;
      }

      // Deterministic initiator rule: only lexicographically smaller peer starts the offer flow.
      if (fromPeer.value.localeCompare(peerId) >= 0) {
        return;
      }

      const isAnnounced = discoveredPeers.value.some((p) => p?.peer_id === peerId);
      if (!isAnnounced) {
        return;
      }

      const link = getMeshLink(peerId);
      if (!link || link.connectRequested || (link.dc && link.dc.readyState === "open")) {
        return;
      }

      // Keep one in-flight attempt state per peer.
      if (["offering", "offered", "answering", "answered", "connected-pending", "connected"].includes(link.phase)) {
        return;
      }

      link.connectRequested = true;
      link.connectRequestTime = now();
      link.phase = "offering";
      refreshSelectedPeerSnapshot();

      // Hard fallback path: skip connect_request/connect_accept handshake and
      // go straight to offer to avoid request/accept races in auto mode.
      startOfferFlow(peerId)
        .then(() => {
          const current = getMeshLink(peerId, false);
          if (!current) return;
          current.connectRequested = false;
          current.connectRequestTime = 0;
          if (current.phase === "offering") {
            current.phase = "offered";
          }
          refreshSelectedPeerSnapshot();
        })
        .catch((error) => {
          const current = getMeshLink(peerId, false);
          if (current) {
            current.connectRequested = false;
            current.connectRequestTime = 0;
            current.phase = "idle";
          }
          pushLog("rtc:error", error?.message || `failed to start offer flow for ${peerId}`);
          markPeerFailed(peerId, "direct-offer-failed");
          refreshSelectedPeerSnapshot();
        });
    }

    function activeMeshPeerCount() {
      const activePhases = new Set(["requesting", "waiting-offer", "offering", "offered", "answering", "answered", "connected-pending", "ready"]);
      let count = 0;
      for (const [pid, link] of meshLinks.entries()) {
        if (!pid || pid === fromPeer.value) continue;
        if (link?.dc?.readyState === "open" || activePhases.has(link?.phase)) count++;
      }
      return count;
    }

    function effectivePartialMeshLimit() {
      const rawLimit = Number(partialMeshMaxPeers.value);
      if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
        return 1;
      }
      return Math.max(1, Math.floor(rawLimit));
    }

    function hasMeshCapacityForPeer(peerId) {
      if (!partialMesh.value) {
        return true;
      }

      const existing = getMeshLink(peerId, false);
      if (existing && (existing?.dc?.readyState === "open" || isNegotiatingPhase(existing?.phase))) {
        return true;
      }

      return activeMeshPeerCount() < effectivePartialMeshLimit();
    }

    function maybeAutoConnectPeer(peerId) {
      if (reconnectLockedByBye || !autoConnect.value || !isConnected.value) {
        return;
      }

      if (!hasMeshCapacityForPeer(peerId)) {
        return;
      }

      if (!peerId || isPeerCoolingDown(peerId) || isPeerInByeCooldown(peerId) || peerId === fromPeer.value) {
        return;
      }

      // Deterministic role split prevents dual-initiator glare loops.
      if (fromPeer.value.localeCompare(peerId) >= 0) {
        return;
      }

      const isAnnounced = discoveredPeers.value.some((p) => p?.peer_id === peerId);
      if (!isAnnounced) {
        return;
      }

      const link = getMeshLink(peerId);
      if (
        ["requesting", "waiting-offer", "offering", "offered", "answering", "answered", "connected-pending", "connected"].includes(link.phase) ||
        (link.pc && ["connecting", "connected"].includes(link.pc.connectionState)) ||
        (link.dc && link.dc.readyState === "open")
      ) {
        return;
      }

      requestConnect(peerId);
    }

    function closeMeshLink(peerId) {
      const link = getMeshLink(peerId, false);
      if (!link) {
        return;
      }

      // Mark idle before closing transports so close callbacks do not trigger failover.
      link.phase = "idle";
      link.connectRequested = false;
      link.connectRequestTime = 0;
      link.offerWaitTime = 0;
      link.answerWaitTime = 0;
      link.rtcState = "closed";
      link.dataState = "closed";

      if (link.dc) {
        try {
          link.dc.close();
        } catch {
          // no-op
        }
      }
      link.dc = null;

      if (link.pc) {
        try {
          link.pc.close();
        } catch {
          // no-op
        }
      }
      link.pc = null;
      refreshMeshStats();
      refreshSelectedPeerSnapshot();
    }

    function setupDataChannel(peerId, channel, source) {
      const link = getMeshLink(peerId);
      link.dc = channel;
      link.dataState = channel.readyState;
      pushLog("rtc:datachannel", `${peerId} attached (${source})`);

      let dcKeepaliveTimer = null;
      let lastPongAt = Date.now();
      let lastPingSentAt = 0;

      function onTabVisible() {
        if (typeof document !== "undefined" && document.hidden) return;
        // Any ping sent while hidden can't have been answered — don't count the gap.
        lastPingSentAt = 0;
        lastPongAt = Date.now();
      }

      function startDcKeepalive() {
        clearInterval(dcKeepaliveTimer);
        dcKeepaliveTimer = setInterval(() => {
          if (channel.readyState !== "open") return;

          // Browser throttles timers in hidden tabs — skip timeout check while hidden.
          if (typeof document !== "undefined" && document.hidden) {
            lastPingSentAt = 0;
            lastPongAt = Date.now();
            return;
          }

          const pingInFlight = lastPingSentAt > lastPongAt;
          if (pingInFlight && Date.now() - lastPingSentAt > DATA_PONG_TIMEOUT_MS) {
            pushLog("rtc:datachannel", `${peerId} keepalive timeout`);
            clearInterval(dcKeepaliveTimer);
            dcKeepaliveTimer = null;
            try { channel.close(); } catch { /* no-op */ }
            try { link.pc?.close(); } catch { /* no-op */ }
            return;
          }

          try {
            channel.send(JSON.stringify({ type: "ping", ts: Date.now() }));
            lastPingSentAt = Date.now();
          } catch { /* ignore transient errors */ }
        }, DATA_PING_MS);
      }

      if (channel.readyState === "open") {
        link.phase = "connected";
        pushLog("rtc:datachannel", `${peerId} open`);
        refreshMeshStats();
        acquireWakeLock();
        document.addEventListener("visibilitychange", onTabVisible);
        startDcKeepalive();
      }

      channel.onopen = () => {
        link.dataState = channel.readyState;
        link.phase = "connected";
        link.connectRequested = false;
        link.connectRequestTime = 0;
        lastPongAt = Date.now();
        pushLog("rtc:datachannel", `${peerId} open`);
        refreshMeshStats();
        refreshSelectedPeerSnapshot();
        acquireWakeLock();
        document.addEventListener("visibilitychange", onTabVisible);
        startDcKeepalive();
      };

      channel.onclose = () => {
        link.dataState = channel.readyState;
        clearInterval(dcKeepaliveTimer);
        dcKeepaliveTimer = null;
        document.removeEventListener("visibilitychange", onTabVisible);
        pushLog("rtc:datachannel", `${peerId} closed`);
        refreshMeshStats();
        // Release wake lock if no more open channels remain.
        const anyOpen = [...meshLinks.values()].some((l) => l.dc?.readyState === "open");
        if (!anyOpen) releaseWakeLock();
        if (!stoppingRtc && autoConnect.value && link.phase === "connected") {
          failoverFromCurrentPeer(peerId, "datachannel-closed");
        }
        refreshSelectedPeerSnapshot();
      };

      channel.onerror = () => {
        pushLog("rtc:datachannel", `${peerId} error`);
      };

      channel.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { /* not JSON */ }
        if (msg?.type === "ping") {
          try { channel.send(JSON.stringify({ type: "pong", ts: Date.now() })); } catch { /* no-op */ }
          return;
        }
        if (msg?.type === "pong") {
          lastPongAt = Date.now();
          lastPingSentAt = 0;
          return;
        }
        pushChatMessage(event.data, "incoming");
      };

      refreshSelectedPeerSnapshot();
    }

    function ensurePeerConnection(peerId) {
      const link = getMeshLink(peerId);
      if (link.pc) {
        return link.pc;
      }

      const peerPc = new RTCPeerConnection(activeRtcConfig());
      link.pc = peerPc;
      link.rtcState = peerPc.connectionState;
      link.phase = "ready";

      peerPc.onconnectionstatechange = () => {
        link.rtcState = peerPc.connectionState;

        if (link.dc && link.dc.readyState === "open") {
          link.phase = "connected";
          link.connectRequested = false;
          link.connectRequestTime = 0;
        }

        if (["failed", "closed"].includes(peerPc.connectionState) && link.dc) {
          try {
            link.dc.close();
          } catch {
            // no-op
          }
          link.dataState = "closed";
          link.dc = null;
        }

        pushLog("rtc:state", `${peerId} ${peerPc.connectionState}`);
        if (
          !stoppingRtc &&
          autoConnect.value &&
          ["failed", "disconnected"].includes(peerPc.connectionState) &&
          (!link.dc || link.dc.readyState !== "open")
        ) {
          failoverFromCurrentPeer(peerId, `pc-${peerPc.connectionState}`);
        }
        refreshSelectedPeerSnapshot();
      };

      peerPc.onicecandidate = (event) => {
        if (event.candidate) {
          sendRelayEnvelope("ice_candidate", { candidate: event.candidate.toJSON() }, { to: peerId });
          return;
        }
        sendRelayEnvelope("ice_end", {}, { to: peerId });
      };

      peerPc.onicecandidateerror = (event) => {
        const code = event?.errorCode ?? "unknown";
        const text = event?.errorText ?? "unknown";
        const url = event?.url ?? "n/a";
        const numericCode = Number(code);
        if (Number.isInteger(numericCode) && numericCode >= 700 && numericCode < 800) {
          pushLog("rtc:ice", `${peerId} non-fatal ICE candidate diagnostic code=${code} text=${text} url=${url}`);
          return;
        }
        pushLog("rtc:ice-error", `${peerId} ice candidate error code=${code} text=${text} url=${url}`);
      };

      peerPc.onsignalingstatechange = () => {
        if (link.pc !== peerPc || peerPc.signalingState !== "have-local-offer") {
          return;
        }
        const pendingAnswer = link.pendingAnswer;
        if (!pendingAnswer || (link.pendingAnswerPc && link.pendingAnswerPc !== peerPc)) {
          return;
        }
        void onAnswer(pendingAnswer);
      };

      peerPc.ondatachannel = (event) => {
        setupDataChannel(peerId, event.channel, "remote-offer");
      };

      refreshSelectedPeerSnapshot();
      return peerPc;
    }

    async function startOfferFlow(peerId) {
      let peerPc = ensurePeerConnection(peerId);
      let link = getMeshLink(peerId);

      if (link.dc && link.dc.readyState === "open") {
        link.phase = "connected";
        link.connectRequested = false;
        link.connectRequestTime = 0;
        refreshSelectedPeerSnapshot();
        return;
      }

      const needsFreshPeerConnection = Boolean(
        link.pc && (
          link.pc.signalingState !== "stable" ||
          link.pc.currentLocalDescription ||
          link.pc.currentRemoteDescription ||
          link.pc.pendingLocalDescription ||
          link.pc.pendingRemoteDescription ||
          link.dc
        )
      );

      if (needsFreshPeerConnection) {
        pushLog("rtc", `Resetting stale offer state for ${peerId}`);
        closeMeshLink(peerId);
        peerPc = ensurePeerConnection(peerId);
        link = getMeshLink(peerId);
      }

      try {
        if (!link.dc) {
          const channel = peerPc.createDataChannel("freertc");
          setupDataChannel(peerId, channel, "local-offer");
        }

        const offer = await peerPc.createOffer();
        await peerPc.setLocalDescription(offer);
        await waitForIceGatheringComplete(peerPc);
        link.phase = "offered";
        link.answerWaitTime = now();

        sendRelayEnvelope(
          "offer",
          {
            sdp: peerPc.localDescription?.sdp || offer.sdp,
            trickle_ice: true,
            restart_ice: false,
            setup_role: "actpass"
          },
          { to: peerId }
        );
      } catch (error) {
        pushLog("rtc:error", error?.message || "failed to create local offer");
        markPeerFailed(peerId, "offer-create-failed");
        closeMeshLink(peerId);
        if (toPeer.value === peerId) {
          toPeer.value = "";
        }
      }

      refreshSelectedPeerSnapshot();
    }

    async function beginRtc() {
      if (!isConnected.value) {
        pushLog("rtc:error", "Connect socket first");
        return;
      }

      reconnectLockedByBye = false;
      autoDiscovery.value = true;
      autoConnect.value = true;
      persistSharedIds();
      sendAnnounce({ feedback: false });
      sendDiscover({ feedback: false });
      lastDiscoverSyncAt = now();
      startAutoLoop();

      if (!toPeer.value) {
        rtcPhase.value = "discovering";
        pushLog("rtc", "Waiting for peer_list to select target peer");
        return;
      }

      maybeAutoConnectPeer(toPeer.value);
    }

    function stopRtc() {
      stoppingRtc = true;
      for (const peerId of meshLinks.keys()) {
        closeMeshLink(peerId);
      }

      rtcPhase.value = "idle";
      rtcState.value = "closed";
      dataState.value = "closed";
      stoppingRtc = false;
    }

    function resetRtc() {
      // Reset should start fresh by sending bye to all peers first, then clearing state.
      const peers = new Set([
        ...Array.from(meshLinks.keys()),
        ...discoveredPeers.value.map((peer) => peer?.peer_id).filter((peerId) => typeof peerId === "string")
      ]);
      for (const peerId of peers) {
        if (peerId && peerId !== fromPeer.value) {
          sendRelayEnvelope("bye", { reason: "reset_rtc" }, { to: peerId });
        }
      }

      reconnectLockedByBye = false;
      byeCooldowns.clear();
      failedPeerCooldowns.clear();
      toPeer.value = "";

      stopAutomation();
      stopRtc();

      if (isConnected.value) {
        void beginRtc();
      }
    }

    function stopAutomation() {
      autoDiscovery.value = false;
      autoConnect.value = false;
      for (const link of meshLinks.values()) {
        link.connectRequested = false;
        link.connectRequestTime = 0;
      }
      stopAutoLoop();
      pushLog("auto", "Stopped auto discovery/connect loop");
    }

    async function onServerEnvelope(message) {
      if (!message || typeof message !== "object") {
        return;
      }

      const isForMe = !message.to || message.to === fromPeer.value;
      const sameNetwork = normalizeText(message.network) === normalizedNetworkValue();
      if (!isForMe || !sameNetwork) {
        return;
      }

      if (message.from && message.from === fromPeer.value) {
        return;
      }

      if (message.type === "error") {
        pushLog("server:error", message.body || {});
        return;
      }

      if (
        ["connect_request", "connect_accept", "connect_reject", "offer", "answer", "ice_candidate", "ice_end", "bye"].includes(message.type) &&
        !isMatchingSessionId(message.session_id)
      ) {
        if (message.type === "connect_request" && message.from) {
          sendRelayEnvelope(
            "connect_reject",
            {
              code: "session_mismatch",
              reason: "session_id does not match"
            },
            { to: message.from, reply_to: message.message_id }
          );
        }
        pushLog("rtc", `Ignored ${message.type} with mismatched session_id from ${message.from || "unknown"}`);
        return;
      }

      if (message.type === "peer_list") {
        const peers = Array.isArray(message.body?.peers) ? message.body.peers : [];
        const deduped = new Map();
        for (const peer of peers) {
          const peerId = peer?.peer_id;
          if (
            typeof peerId !== "string" ||
            peerId === fromPeer.value ||
            !isValidPeerId(peerId) ||
            !isFreshPeerAnnouncement(peer) ||
            !isMatchingSessionId(peer?.session_id)
          ) {
            continue;
          }
          deduped.set(peerId, peer);
        }

        discoveredPeers.value = Array.from(deduped.values());
        const announcedPeerIds = new Set(deduped.keys());

        for (const peerId of Array.from(meshLinks.keys())) {
          if (!peerId || peerId === fromPeer.value || announcedPeerIds.has(peerId)) {
            continue;
          }
          const link = getMeshLink(peerId, false);
          if (shouldKeepLinkWithoutAnnouncement(link)) {
            continue;
          }
          pushLog("discovery", `Pruned stale peer not in latest peer_list: ${peerId}`);
          closeMeshLink(peerId);
          meshLinks.delete(peerId);
        }

        if (toPeer.value && !announcedPeerIds.has(toPeer.value)) {
          toPeer.value = "";
        }

        const selected = choosePeerFromList(discoveredPeers.value);
        if (selected && !toPeer.value) {
          selectPeer(selected.peer_id);
        }
        if (autoConnect.value) {
          for (const peer of discoveredPeers.value) {
            maybeAutoConnectPeer(peer.peer_id);
          }
        }
        refreshMeshStats();
        refreshSelectedPeerSnapshot();
        return;
      }

      if (
        ["connect_accept", "connect_reject", "offer", "answer", "ice_candidate", "ice_end", "bye"].includes(message.type)
      ) {
        if (!message.from || message.from === fromPeer.value) {
          return;
        }
        // Accept RTC signaling even before peer_list catches up; upsert temporary discovery entry.
        const isAnnounced = discoveredPeers.value.some((p) => p?.peer_id === message.from);
        if (!isAnnounced) {
          const existingPeers = new Map(
            discoveredPeers.value
              .filter((peer) => typeof peer?.peer_id === "string")
              .map((peer) => [peer.peer_id, peer])
          );
          existingPeers.set(message.from, {
            peer_id: message.from,
            session_id: message.session_id || null,
            timestamp: now()
          });
          discoveredPeers.value = Array.from(existingPeers.values());
          pushLog("discovery", `Accepted inbound RTC peer before peer_list sync: ${message.from}`);
          refreshMeshStats();
        }
        const link = getMeshLink(message.from);
        if (link) {
          link.lastSignalAt = now();
        }
      }

      if (message.type === "connect_request" && message.from && message.from !== fromPeer.value) {
        const isAnnounced = discoveredPeers.value.some((p) => p?.peer_id === message.from);
        if (!isAnnounced) {
          const existingPeers = new Map(
            discoveredPeers.value
              .filter((peer) => typeof peer?.peer_id === "string")
              .map((peer) => [peer.peer_id, peer])
          );
          existingPeers.set(message.from, {
            peer_id: message.from,
            session_id: message.session_id || null,
            timestamp: now()
          });
          discoveredPeers.value = Array.from(existingPeers.values());
          pushLog("discovery", `Accepted inbound peer before peer_list sync: ${message.from}`);
          refreshMeshStats();
        }
        if (!toPeer.value) {
          selectPeer(message.from, { allowUnannounced: true });
        }
      }

      if (
        message.from &&
        (reconnectLockedByBye || isPeerInByeCooldown(message.from)) &&
        ["connect_request", "connect_accept", "offer", "answer", "ice_candidate", "ice_end"].includes(message.type)
      ) {
        if (message.type === "connect_request") {
          sendRelayEnvelope(
            "connect_reject",
            {
              code: reconnectLockedByBye ? "manual_hangup_lock" : "peer_on_hold",
              reason: reconnectLockedByBye ? "manual hangup lock" : "recent bye",
              retry_after_ms: BYE_COOLDOWN_MS
            },
            { to: message.from, reply_to: message.message_id }
          );
        }
        pushLog("rtc", `Ignored ${message.type} from held peer ${message.from}`);
        return;
      }

      switch (message.type) {
        case "connect_request":
          await onConnectRequest(message);
          break;
        case "connect_accept":
          await onConnectAccept(message);
          break;
        case "connect_reject":
          onConnectReject(message);
          break;
        case "offer":
          await onOffer(message);
          break;
        case "answer":
          await onAnswer(message);
          break;
        case "ice_candidate":
          await onIceCandidate(message);
          break;
        case "ice_end":
          pushLog("rtc:ice", "remote end-of-candidates");
          break;
        case "bye":
          pushLog("rtc", `remote ended session ${message.from || "unknown"}`);
          if (message.from) {
            markPeerBye(message.from, "remote-bye");
            closeMeshLink(message.from);
          }
          if (toPeer.value === message.from) {
            toPeer.value = "";
          }
          break;
        case "ack":
          break;
        case "pong":
          if (pendingPingStartedAt > 0) {
            const elapsedMs = Math.max(1, Math.round(performance.now() - pendingPingStartedAt));
            pendingPingStartedAt = 0;
            pingButtonText.value = `OK ${elapsedMs}ms`;
            flashPingButton();
          }
          break;
        default:
          break;
      }
    }

    async function onConnectRequest(message) {
      if (!message.from) {
        return;
      }

      const peerId = message.from;
      if (peerId === fromPeer.value) {
        return;
      }
      const link = getMeshLink(peerId);

      if (!hasMeshCapacityForPeer(peerId)) {
        sendRelayEnvelope(
          "connect_reject",
          {
            code: "mesh_full",
            reason: "local partial mesh limit reached"
          },
          { to: peerId, reply_to: message.message_id }
        );
        pushLog("rtc", `Rejected connect_request from ${peerId}: local mesh full`);
        return;
      }

       if (link.dc && link.dc.readyState === "open") {
        sendRelayEnvelope(
          "connect_reject",
          {
            code: "already_connected",
            reason: "datachannel already open"
          },
          { to: peerId, reply_to: message.message_id }
        );
        pushLog("rtc", `Ignored duplicate connect_request from connected peer ${peerId}`);
        return;
      }

      if (!toPeer.value) {
        selectPeer(peerId);
      }

      const initiator = fromPeer.value.localeCompare(peerId) < 0 ? fromPeer.value : peerId;
      sendRelayEnvelope(
        "connect_accept",
        {
          initiator_decision: initiator,
          expires_in_ms: 10000
        },
        { to: peerId, reply_to: message.message_id }
      );

      link.connectRequested = false;
      link.connectRequestTime = 0;
      link.phase = "accepted";

      if (initiator === fromPeer.value) {
        await startOfferFlow(peerId);
      }
      refreshSelectedPeerSnapshot();
    }

    async function onConnectAccept(message) {
      if (!message.from) {
        return;
      }
      const peerId = message.from;
      if (peerId === fromPeer.value) {
        return;
      }
      const link = getMeshLink(peerId);

      if (link.dc && link.dc.readyState === "open") {
        link.phase = "connected";
        link.connectRequested = false;
        link.connectRequestTime = 0;
        link.offerWaitTime = 0;
        refreshSelectedPeerSnapshot();
        return;
      }

      link.connectRequested = false;
      link.connectRequestTime = 0;

      const initiator = message.body?.initiator_decision;
      link.phase = "accepted";

      if (initiator === fromPeer.value) {
        await startOfferFlow(peerId);
      } else {
        // Responder mode: start timeout waiting for offer from initiator (PSP Section 11.2)
        link.offerWaitTime = now();
        pushLog("rtc", `Connect accepted by ${peerId}, waiting for offer from initiator`);
      }
      refreshSelectedPeerSnapshot();
    }

    function onConnectReject(message) {
      if (!message.from) {
        return;
      }
      const peerId = message.from;
      if (peerId === fromPeer.value) {
        return;
      }
      const rejectCode = message.body?.code || "connect_reject";
      const link = getMeshLink(peerId);
      link.connectRequested = false;
      link.connectRequestTime = 0;
      link.phase = "idle";
      pushLog("rtc", message.body || { code: "connect_reject" });
      markPeerFailed(peerId, `connect-reject:${rejectCode}`);
      closeMeshLink(peerId);

      if (["peer_on_hold", "manual_hangup_lock"].includes(rejectCode)) {
        markPeerBye(peerId, rejectCode);
      }

      if (toPeer.value === peerId) {
        toPeer.value = "";
      }

      if (autoConnect.value) {
        selectNextPeerAndConnect(`connect-reject:${rejectCode}`);
      }

      refreshSelectedPeerSnapshot();
    }

    async function onOffer(message) {
      if (!message.from) {
        return;
      }
      const peerId = message.from;
      if (peerId === fromPeer.value) {
        return;
      }

      if (!hasMeshCapacityForPeer(peerId)) {
        sendRelayEnvelope(
          "connect_reject",
          {
            code: "mesh_full",
            reason: "local partial mesh limit reached"
          },
          { to: peerId, reply_to: message.message_id }
        );
        pushLog("rtc", `Rejected offer from ${peerId}: local mesh full`);
        return;
      }

      const link = getMeshLink(peerId);
      if (!message.body?.sdp) {
        return;
      }
      if (link.phase === "connected" || (link.dc && link.dc.readyState === "open")) {
        pushLog("rtc", `Ignored offer from connected peer ${peerId}`);
        return;
      }

      // Responder received the offer, stop waiting timeout (PSP Section 11.2)
      link.offerWaitTime = 0;

      let peerPc = ensurePeerConnection(peerId);
      if (peerPc.remoteDescription?.sdp && peerPc.remoteDescription.sdp !== message.body.sdp) {
        closeMeshLink(peerId);
        peerPc = ensurePeerConnection(peerId);
        pushLog("rtc", `Replaced stale connection for new offer from ${peerId}`);
      }
      if (!["stable", "have-local-offer"].includes(peerPc.signalingState)) {
        pushLog("rtc", `Ignored stale offer from ${peerId} while in ${peerPc.signalingState}`);
        return;
      }

      // Glare handling: if both sides offered concurrently, keep one deterministic winner.
      if (peerPc.signalingState === "have-local-offer") {
        const iAmInitiator = fromPeer.value.localeCompare(peerId) < 0;
        if (iAmInitiator) {
          // Initiator keeps its own offer and ignores collided remote offer.
          pushLog("rtc", `Ignored collided offer from ${peerId} (keeping local offer)`);
          return;
        }
        try {
          await peerPc.setLocalDescription({ type: "rollback" });
          pushLog("rtc", `Rolled back local offer to accept remote offer from ${peerId}`);
        } catch (error) {
          pushLog("rtc:error", error?.message || `failed rollback during glare with ${peerId}`);
          return;
        }
      }

      try {
        await peerPc.setRemoteDescription({ type: "offer", sdp: message.body.sdp });
      } catch (error) {
        const messageText = String(error?.message || error || "");
        const isRtpExtensionRemap = error?.name === "InvalidAccessError"
          && /remap RTP extension id/i.test(messageText);
        if (!isRtpExtensionRemap) {
          pushLog("rtc:error", messageText || `failed to apply offer from ${peerId}`);
          markPeerFailed(peerId, "offer-apply-failed");
          closeMeshLink(peerId);
          return;
        }
        closeMeshLink(peerId);
        peerPc = ensurePeerConnection(peerId);
        pushLog("rtc", `Retrying offer from ${peerId} on fresh connection after RTP extension remap`);
        try {
          await peerPc.setRemoteDescription({ type: "offer", sdp: message.body.sdp });
        } catch (retryError) {
          pushLog("rtc:error", retryError?.message || `failed to apply offer from ${peerId}`);
          markPeerFailed(peerId, "offer-apply-failed");
          closeMeshLink(peerId);
          return;
        }
      }

      await flushPendingIceCandidates(peerId, link);
      link.phase = "answering";

      const answer = await peerPc.createAnswer();
      await peerPc.setLocalDescription(answer);
      await waitForIceGatheringComplete(peerPc);
      link.phase = "answered";

      sendRelayEnvelope(
        "answer",
        {
          sdp: peerPc.localDescription?.sdp || answer.sdp,
          trickle_ice: true,
          restart_ice: false
        },
        { to: peerId, reply_to: message.message_id }
      );
      refreshSelectedPeerSnapshot();
    }

    async function onAnswer(message) {
      if (!message.from || !message.body?.sdp) {
        return;
      }
      const peerId = message.from;
      if (peerId === fromPeer.value) {
        return;
      }
      const link = getMeshLink(peerId);
      if (link.phase === "connected") {
        return;
      }

      if (link.dc && link.dc.readyState === "open") {
        link.phase = "connected";
        link.connectRequested = false;
        link.connectRequestTime = 0;
        link.answerWaitTime = 0;
        refreshSelectedPeerSnapshot();
        return;
      }

      if (!link.pc) {
        link.pendingAnswer = message;
        link.pendingAnswerPc = null;
        pushLog("rtc", `Queued answer from isolated peer ${peerId} until a local offer is ready`);
        return;
      }

      if (link.pc.signalingState !== "have-local-offer") {
        if (!link.dc || link.dc.readyState !== "open") {
          link.pendingAnswer = message;
          link.pendingAnswerPc = link.pc;
          pushLog("rtc", `Queued answer from isolated peer ${peerId} while in ${link.pc.signalingState}`);
          return;
        }
        pushLog("rtc", `Ignored stale answer from connected peer ${peerId} while in ${link.pc.signalingState}`);
        return;
      }

      link.pendingAnswer = null;
      link.pendingAnswerPc = null;
      try {
        await link.pc.setRemoteDescription({ type: "answer", sdp: message.body.sdp });
      } catch (error) {
        pushLog("rtc:error", error?.message || `failed to apply answer from ${peerId}`);
        markPeerFailed(peerId, "answer-apply-failed");
        closeMeshLink(peerId);
        if (toPeer.value === peerId) {
          toPeer.value = "";
        }
        return;
      }

      await flushPendingIceCandidates(peerId, link);
      link.phase = "connected-pending";
      link.answerWaitTime = 0;  // Answer received, stop waiting
      pushLog("rtc", `answer applied from ${peerId}`);
      refreshSelectedPeerSnapshot();
    }

    async function onIceCandidate(message) {
      if (!message.from || !message.body?.candidate) {
        return;
      }

      if (message.from === fromPeer.value) {
        return;
      }

      const link = getMeshLink(message.from);
      if (!Array.isArray(link.pendingCandidates)) {
        link.pendingCandidates = [];
      }

      if (!link?.pc || !link.pc.remoteDescription) {
        link.pendingCandidates.push(message.body.candidate);
        return;
      }

      try {
        await link.pc.addIceCandidate(message.body.candidate);
      } catch (error) {
        pushLog("rtc:ice-error", error?.message || "failed to apply candidate");
      }
    }

    function sendChat() {
      const text = normalizeText(chatInput.value);
      if (!text) {
        return;
      }

      const openLinks = Array.from(meshLinks.values()).filter((link) => link.dc && link.dc.readyState === "open");
      if (openLinks.length === 0) {
        pushLog("chat:error", "No open DataChannel");
        return;
      }

      if (chatSendMode.value === "target") {
        const targetPeerIds = selectedTargetPeers.value.length > 0
          ? [...selectedTargetPeers.value]
          : (toPeer.value ? [toPeer.value] : []);

        if (targetPeerIds.length === 0) {
          pushLog("chat:error", "Target mode requires selected peer");
          return;
        }

        let sentCount = 0;
        const unavailable = [];
        for (const peerId of targetPeerIds) {
          const selected = getMeshLink(peerId, false);
          if (!selected?.dc || selected.dc.readyState !== "open") {
            unavailable.push(peerId);
            continue;
          }
          selected.dc.send(text);
          sentCount += 1;
        }

        if (sentCount === 0) {
          pushLog("chat:error", "Selected peer DataChannel is not open");
          return;
        }

        if (unavailable.length > 0) {
          pushLog("chat:warn", `Some selected peers are unavailable: ${unavailable.join(", ")}`);
        }

        pushChatMessage(text, "outgoing");
        chatInput.value = "";
        return;
      }

      for (const link of openLinks) {
        link.dc.send(text);
      }
      pushChatMessage(text, "outgoing");
      chatInput.value = "";
    }

    function hangup() {
      reconnectLockedByBye = true;
      const peers = new Set([
        ...Array.from(meshLinks.keys()),
        ...discoveredPeers.value.map((peer) => peer?.peer_id).filter((peerId) => typeof peerId === "string")
      ]);
      for (const peerId of peers) {
        if (peerId && peerId !== fromPeer.value) {
          markPeerBye(peerId, "local-bye");
          sendRelayEnvelope("bye", { reason: "manual_hangup" }, { to: peerId });
        }
      }
      stopAutomation();
      stopRtc();
      toPeer.value = "";
      pushLog("rtc", "sent bye and disconnected peer session");
    }

    watch(
      [wsUrl, network, partialMesh, partialMeshMaxPeers, chatSendMode, activeView],
      () => {
        persistUiPrefs();
      },
      { flush: "sync" }
    );

    loadUiPrefs();
    initSharedIds();

    function acquireWakeLock() {
      if (_wakeLock) return;
      if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
      navigator.wakeLock.request("screen").then((lock) => {
        _wakeLock = lock;
        lock.addEventListener("release", () => { _wakeLock = null; });
        pushLog("wakelock", "acquired");
      }).catch(() => { /* permission denied or unavailable — not fatal */ });
    }

    function releaseWakeLock() {
      if (!_wakeLock) return;
      try { _wakeLock.release(); } catch { /* no-op */ }
      _wakeLock = null;
    }

    function handleTabVisible() {
      if (typeof document !== "undefined" && document.hidden) return;
      failedPeerCooldowns.clear();
      byeCooldowns.clear();
      lastDiscoverSyncAt = 0;
      // Re-acquire wake lock lost while hidden.
      const anyOpen = [...meshLinks.values()].some((l) => l.dc?.readyState === "open");
      if (anyOpen) acquireWakeLock();
      // Reconnect WebSocket if it dropped while the tab was inactive.
      if (!manualDisconnect) {
        const ws = socket.value;
        if (!ws || (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING)) {
          pushLog("socket", "tab visible — WebSocket dropped while hidden, reconnecting");
          // Purge stale peer connections before reconnect so they don't block re-dialing.
          for (const peerId of meshLinks.keys()) closeMeshLink(peerId);
          meshLinks.clear();
          discoveredPeers.value = [];
          if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
          connect();
        }
      }
    }

    function handleSuspendRestore() {
      if (manualDisconnect) return;

      pushLog("socket", "browser resumed — reconnecting immediately");
      failedPeerCooldowns.clear();
      byeCooldowns.clear();
      lastDiscoverSyncAt = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      // A thawed browser can briefly report a dead socket as OPEN/CONNECTING.
      // Detach it so its delayed close cannot schedule a duplicate reconnect.
      const staleSocket = socket.value;
      socket.value = null;
      if (staleSocket) {
        staleSocket.onopen = null;
        staleSocket.onmessage = null;
        staleSocket.onerror = null;
        staleSocket.onclose = null;
        try { staleSocket.close(1000, "browser_resume"); } catch { /* no-op */ }
      }

      for (const peerId of meshLinks.keys()) closeMeshLink(peerId);
      meshLinks.clear();
      discoveredPeers.value = [];
      status.value = "disconnected";
      stopAutoLoop();
      stopRtc();
      connect();
    }

    function handleFreeze() {
      // Tab is about to be CPU-suspended — proactively withdraw from signaling.
      const ws = socket.value;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            psp_version: PSP_VERSION,
            type: "withdraw",
            network: network.value || "room:test",
            from: fromPeer.value,
            to: null,
            session_id: normalizedAppliedRoomValue(),
            message_id: crypto.randomUUID(),
            timestamp: Date.now(),
            ttl_ms: 30000,
            body: { reason: "tab_freeze" }
          }));
        } catch { /* ignore */ }
      }
      releaseWakeLock();
    }

    onMounted(() => {
      // Withdraw on page unload/reload using both beforeunload and pagehide to cover all cases.
      // Use fetch with keepalive to guarantee delivery even if socket closes immediately.
      window.addEventListener("beforeunload", () => {
        const envelope = {
          psp_version: PSP_VERSION,
          type: "withdraw",
          network: network.value || "room:test",
          from: fromPeer.value,
          to: null,
          session_id: normalizedAppliedRoomValue(),
          message_id: crypto.randomUUID(),
          timestamp: Date.now(),
          ttl_ms: 30000,
          body: { reason: "peer_offline" }
        };
        // Try WebSocket first if open
        if (socket.value && socket.value.readyState === WebSocket.OPEN) {
          try {
            socket.value.send(JSON.stringify(envelope));
          } catch (e) {
            // Ignored
          }
        }
      });

      window.addEventListener("pagehide", () => {
        if (socket.value && socket.value.readyState === WebSocket.OPEN) {
          sendWithdraw();
        }
      });

      // Inactive-tab resilience: reconnect when the tab becomes visible again.
      document.addEventListener("visibilitychange", handleTabVisible);
      // Page Lifecycle API: fires on freeze (CPU-suspend) and resume (thaw).
      document.addEventListener("freeze", handleFreeze);
      document.addEventListener("resume", handleSuspendRestore);
      // bfcache restore: browser shows page from back/forward cache (WS is dead).
      window.addEventListener("pageshow", (e) => { if (e.persisted) handleSuspendRestore(); });

      // No-click behavior: boot socket + auto-handshake loop on load.
      connect();
    });

    return {
      pspSpecUrl: PSP_SPEC_URL,
      specPillLabel,
      pingButtonLabel,
      discoverButtonLabel,
      announceButtonLabel,
      pingFlash,
      discoverFlash,
      announceFlash,
      activeView,
      wsUrl,
      status,
      network,
      fromPeer,
      toPeer,
      sessionId,
      relayType,
      relayBody,
      discoveredPeers,
      autoDiscovery,
      autoConnect,
      partialMesh,
      partialMeshMaxPeers,
      debugExpanded,
      logsText,
      logCount,
      logHeadline,
      logPreviewEntries,
      isConnected,
      canConnect,
      canDisconnect,
      canRunRtc,
      chatMessages,
      chatEmptyMessage,
      fromPeerDisplay,
      targetPeerDisplay,
      relayTargetDisplay,
      sendRouteDisplay,
      sendRouteTooltip,
      specWarnings,
      specWarningCount,
      meshPeers,
      meshConnectedCount,
      meshTargetCount,
      rtcPhase,
      rtcState,
      dataState,
      chatInput,
      chatSendMode,
      selectedTargetPeers,
      chatThreadRef,
      connect,
      disconnect,
      applyWsUrlChange,
      applyNetworkChange,
      applyRoomChange,
      applyFromPeerChange,
      sendAnnounce,
      sendDiscover,
      sendPing,
      sendRelay,
      beginRtc,
      stopAutomation,
      stopRtc,
      resetRtc,
      sendChat,
      hangup,
      regeneratePeerId,
      regenerateNetworkAndRoom,
      selectPeer,
      selectPeerFromUi,
      handleSpecLinkClick
    };
  },
  template: `
    <main class="shell">
      <section class="card hero">
        <div class="hero-compact">
          <div class="brand-lockup">
            <span class="logo-badge" aria-hidden="true">
              <svg class="brand-icon" viewBox="0 0 48 48" role="img" aria-label="freertc logo">
                <circle cx="24" cy="24" r="18" fill="none" stroke="#8b5cf6" stroke-width="2.8" />
                <circle cx="24" cy="24" r="10" fill="none" stroke="#8b5cf6" stroke-width="2.4" />
                <circle cx="24" cy="24" r="3.2" fill="#8b5cf6" />
                <path d="M24 7.4v6.2" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" />
                <path d="M24 34.4v6.2" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" />
                <path d="M7.4 24h6.2" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" />
                <path d="M34.4 24h6.2" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" />
              </svg>
            </span>
            <h1 class="brand-wordmark"><span class="brand-free">free</span><span class="brand-rtc">rtc</span></h1>
          </div>
          <div class="hero-copy"><a class="inline-link" :href="pspSpecUrl" target="_blank" rel="noopener noreferrer" @click="handleSpecLinkClick">PSP</a> signaling and WebRTC data-channel mesh primitives for real-time peer networking.</div>
        </div>
        <div class="hero-status">
          <div class="status-pill" :class="status">
            <strong>{{ status }}</strong>
          </div>
          <div class="pill" :class="{ 'pill-warn': specWarningCount > 0, 'pill-ok': specLinkFlash }">
            <strong><a class="pill-link" :href="pspSpecUrl" target="_blank" rel="noopener noreferrer" @click="handleSpecLinkClick">{{ specPillLabel }}</a></strong>
            {{ specWarningCount > 0 ? specWarningCount + ' warning' + (specWarningCount === 1 ? '' : 's') : 'ok' }}
          </div>
        </div>
      </section>

      <section v-if="specWarningCount > 0" class="card spec-warning-card stack">
        <div class="section-header">
          <h2 class="panel-title"><a class="pill-link" :href="pspSpecUrl" target="_blank" rel="noopener noreferrer" @click="handleSpecLinkClick">PSP Spec</a> Warnings</h2>
          <span class="pill pill-warn"><strong>count</strong> {{ specWarningCount }}</span>
        </div>
        <ul class="spec-warning-list">
          <li v-for="warning in specWarnings" :key="warning" class="spec-warning-item">{{ warning }}</li>
        </ul>
      </section>

      <section class="headline-grid">
        <article class="card stack">
          <div class="section-header">
            <h2 class="panel-title">Session Surface</h2>
            <div class="tabs">
              <button class="tab" :class="{ active: activeView === 'webrtc' }" @click="activeView = 'webrtc'">Auto WebRTC</button>
              <button class="tab" :class="{ active: activeView === 'console' }" @click="activeView = 'console'">Console</button>
            </div>
          </div>

          <div class="info-grid">
            <div class="stat-card">
              <div class="stat-label">Signaling Server URL</div>
              <input class="stat-input mono" v-model="wsUrl" @change="applyWsUrlChange" placeholder="wss://peer.ooo/ws">
            </div>
            <div class="stat-card">
              <div class="stat-label">Network</div>
              <input class="stat-input mono" v-model="network" @change="applyNetworkChange" placeholder="network:abc">
            </div>
            <div class="stat-card">
              <div class="stat-label">Room</div>
              <input class="stat-input mono" v-model="sessionId" @change="applyRoomChange" placeholder="room:abc">
            </div>
            <div class="stat-card">
              <div class="stat-label">Your Peer ID</div>
              <input class="stat-input mono" v-model="fromPeer" @change="applyFromPeerChange" placeholder="opaque peer id">
            </div>
          </div>

          <div class="row">
            <button @click="connect" :disabled="!canConnect">Connect</button>
            <button class="secondary" @click="disconnect" :disabled="!canDisconnect">Disconnect</button>
            <button class="secondary" @click="regeneratePeerId">New Peer ID</button>
            <button class="secondary" @click="regenerateNetworkAndRoom">New Network + Room</button>
          </div>

          <div class="metrics">
            <dl class="metric">
              <dt>Target Peer</dt>
              <dd class="mono peer-value">{{ targetPeerDisplay }}</dd>
            </dl>
            <dl class="metric">
              <dt>RTC Phase</dt>
              <dd>{{ rtcPhase }}</dd>
            </dl>
            <dl class="metric">
              <dt>PeerConnection</dt>
              <dd>{{ rtcState }}</dd>
            </dl>
            <dl class="metric">
              <dt>DataChannel</dt>
              <dd>{{ dataState }}</dd>
            </dl>
          </div>
        </article>

        <article class="card stack">
          <h2 class="panel-title">Connection Details</h2>
          <div class="field-grid">
            <label>
              WebSocket URL
              <input v-model="wsUrl" placeholder="wss://peer.ooo/ws" @change="applyWsUrlChange">
            </label>
            <label>
              Network
              <input v-model="network" placeholder="network:abc" @change="applyNetworkChange">
            </label>
            <label>
              Room
              <input v-model="sessionId" placeholder="room:abc" @change="applyRoomChange">
            </label>
          </div>
          <div class="row">
            <span class="pill"><strong>mesh</strong> {{ meshConnectedCount }}/{{ meshTargetCount }} connected</span>
            <button class="secondary" @click="regenerateNetworkAndRoom">New Network + Room</button>
          </div>
          <div class="row">
            <button :class="{ active: announceFlash }" @click="sendAnnounce" :disabled="!isConnected">{{ announceButtonLabel }}</button>
            <button class="secondary" :class="{ active: discoverFlash }" @click="sendDiscover" :disabled="!isConnected">{{ discoverButtonLabel }}</button>
            <button class="secondary" :class="{ active: pingFlash }" @click="sendPing" :disabled="!isConnected">{{ pingButtonLabel }}</button>
          </div>
        </article>
      </section>

      <section class="control-grid">
        <article v-if="activeView === 'console'" class="card console-card stack">
          <div class="section-header">
            <h2 class="panel-title">Raw Relay Console</h2>
            <span class="pill"><strong><a class="pill-link" :href="pspSpecUrl" target="_blank" rel="noopener noreferrer" @click="handleSpecLinkClick">psp</a></strong> manual envelope mode</span>
            <label class="pill" :title="toPeer || 'broadcast'" style="gap:6px; text-transform:none; letter-spacing:0.04em; padding:6px 10px; min-width:260px; justify-content:flex-start;">
              <strong style="text-transform:uppercase; letter-spacing:0.08em;">to</strong>
              <input
                v-model="toPeer"
                placeholder="broadcast"
                :title="toPeer || 'broadcast'"
                style="background:transparent; border:0; outline:none; color:inherit; width:100%; padding:0; font-size:0.84rem;"
              >
            </label>
          </div>
          <label>
            Relay Type
            <select v-model="relayType">
              <option>announce</option>
              <option>discover</option>
              <option>ping</option>
              <option>connect_request</option>
              <option>connect_accept</option>
              <option>connect_reject</option>
              <option>offer</option>
              <option>answer</option>
              <option>ice_candidate</option>
              <option>ice_end</option>
              <option>renegotiate</option>
              <option>bye</option>
              <option>ext</option>
            </select>
          </label>

          <label>
            Body (JSON)
            <textarea v-model="relayBody"></textarea>
          </label>

          <div class="row">
            <button class="console-action-btn" @click="sendRelay" :disabled="!isConnected">Send Relay</button>
          </div>

          <p class="muted">Send protocol frames directly when you need to inspect or force specific signaling behavior.</p>
        </article>

        <article v-else class="card stack">
          <div class="section-header">
            <h2 class="panel-title">Auto Handshake</h2>
            <span class="pill"><strong>peers</strong> {{ meshConnectedCount }}</span>
            <span class="pill"><strong>route</strong> {{ sendRouteDisplay }}</span>
          </div>

          <p class="muted">Auto mode runs peer discovery, target selection, and WebRTC negotiation using the shared session and instance identifiers across tabs. Chat is broadcast by default.</p>

          <div class="row">
            <button @click="beginRtc" :disabled="!canRunRtc">Start Auto Handshake</button>
            <button
              class="secondary"
              :class="{ active: !autoDiscovery && !autoConnect }"
              @click="stopAutomation"
            >
              Stop Auto Discovery/Connect
            </button>
            <button class="secondary" @click="hangup" :disabled="!canRunRtc">Send bye</button>
            <button class="secondary" @click="resetRtc">Reset RTC</button>
          </div>

          <div class="runtime-strip">
            <article class="runtime-chip" :class="autoDiscovery ? 'ok' : 'idle'">
              <div class="runtime-label">Auto Discovery</div>
              <div class="runtime-value">{{ autoDiscovery ? 'On' : 'Off' }}</div>
            </article>
            <article class="runtime-chip" :class="autoConnect ? 'ok' : 'idle'">
              <div class="runtime-label">Auto Connect</div>
              <div class="runtime-value">{{ autoConnect ? 'On' : 'Off' }}</div>
            </article>
            <article class="runtime-chip" :class="partialMesh ? 'ok' : 'idle'" style="cursor:pointer" @click="partialMesh = !partialMesh" :title="'Partial mesh limits connections to ' + partialMeshMaxPeers + ' peers (full mesh connects to all)'">
              <div class="runtime-label">Partial Mesh</div>
              <div class="runtime-value" style="display:flex;align-items:center;gap:4px">
                <span>{{ partialMesh ? 'On' : 'Off' }}</span>
                <input v-if="partialMesh" type="number" min="1" max="99" :value="partialMeshMaxPeers" @input.stop="partialMeshMaxPeers = Math.max(1, parseInt($event.target.value) || 1)" @click.stop style="width:3em;font-size:0.85em;background:transparent;border:1px solid currentColor;border-radius:4px;padding:0 3px;color:inherit;text-align:center" title="Max peers" />
              </div>
            </article>
            <article class="runtime-chip selected">
              <div class="runtime-label">Send Route</div>
              <div class="runtime-value mono runtime-route-value" :title="sendRouteTooltip">{{ sendRouteDisplay }}</div>
            </article>
          </div>

          <div ref="chatThreadRef" class="chat-thread" v-if="chatMessages.length">
            <div
              v-for="entry in chatMessages"
              :key="entry.id"
              class="chat-row"
              :class="entry.kind"
            >
              <article class="chat-bubble">
                <div class="chat-meta">{{ entry.kind === 'outgoing' ? 'you' : 'peer' }} · {{ entry.at }}</div>
                <div class="chat-body">{{ entry.text }}</div>
              </article>
            </div>
          </div>
          <div v-else class="chat-empty">{{ chatEmptyMessage }}</div>

          <section class="chat-composer stack">
            <label class="chat-label">
              Message
              <input v-model="chatInput" placeholder="Write a message" @keyup.enter="sendChat">
            </label>

            <div class="chat-toolbar">
              <div class="mode-toggle" role="group" aria-label="Chat send mode">
                <button
                  class="mode-btn"
                  :class="{ active: chatSendMode === 'broadcast' }"
                  :aria-pressed="chatSendMode === 'broadcast'"
                  @click="chatSendMode = 'broadcast'"
                >
                  Broadcast
                </button>
                <button
                  class="mode-btn"
                  :class="{ active: chatSendMode === 'target' }"
                  :aria-pressed="chatSendMode === 'target'"
                  @click="chatSendMode = 'target'"
                >
                  Selected only
                </button>
              </div>
              <button class="chat-send-btn" @click="sendChat">Send</button>
            </div>

            <p class="mode-indicator">
              {{ chatSendMode === 'broadcast'
                ? 'Broadcast to ' + meshConnectedCount + ' connected peer' + (meshConnectedCount === 1 ? '' : 's')
                : (selectedTargetPeers.length > 1
                  ? 'Selected route: ' + selectedTargetPeers.length + ' peers'
                  : 'Selected route: ' + targetPeerDisplay) }}
            </p>
          </section>
        </article>

        <div class="sidebar-stack">
          <article class="card stack">
            <div class="section-header">
              <h2 class="panel-title">Mesh Peers</h2>
              <span class="pill"><strong>links</strong> {{ meshConnectedCount }}/{{ meshTargetCount }}</span>
            </div>
            <p class="muted mesh-helper">Click any peer row to set selected target when mode is Selected only.</p>

            <div v-if="meshPeers.length" class="mesh-list">
              <button
                v-for="peer in meshPeers"
                :key="peer.peerId"
                class="mesh-row"
                :class="{ 'is-selected': peer.selected, 'is-connected': peer.connected }"
                @click="selectPeerFromUi(peer.peerId)"
              >
                <span class="mesh-main">
                  <span class="mesh-peer-row">
                    <span class="mesh-peer mono" :title="peer.peerId">{{ peer.display }}</span>
                    <span class="mesh-badges">
                      <span class="mesh-badge mesh-role" :class="peer.role">{{ peer.role }}</span>
                      <span class="mesh-badge" :class="peer.statusTone">{{ peer.statusLabel }}</span>
                    </span>
                  </span>
                  <span class="mesh-state-line">{{ peer.phase }} • RTC {{ peer.rtcState }} • DC {{ peer.dataState }}</span>
                </span>
              </button>
            </div>
            <div v-else class="chat-empty mesh-empty">No peers announced yet.</div>
          </article>

          <article class="card debug-card stack">
            <div class="section-header">
              <h2 class="panel-title">Debug Log</h2>
              <div class="row">
                <span class="pill"><strong>rtc</strong> newest first</span>
                <span class="pill"><strong>events</strong> {{ logCount }}</span>
                <button class="secondary" @click="debugExpanded = !debugExpanded">{{ debugExpanded ? 'Hide log' : 'Show log' }}</button>
              </div>
            </div>
            <div v-if="debugExpanded" class="log">{{ logsText }}</div>
            <div v-else class="log-preview">
              <div class="log-preview-head">{{ logHeadline }}</div>
              <ul v-if="logPreviewEntries.length" class="log-preview-list">
                <li v-for="entry in logPreviewEntries" :key="entry.id" class="log-preview-item">
                  <span class="log-preview-time">{{ entry.at }}</span>
                  <span class="log-preview-label">{{ entry.label }}</span>
                  <span class="log-preview-text">{{ entry.preview }}</span>
                </li>
              </ul>
              <p v-else class="muted">No log events yet.</p>
            </div>
          </article>
        </div>
      </section>

      <section class="card footer-note muted">
        <div>freertc · generic realtime signaling console</div>
        <div>Worker endpoint: <code>{{ wsUrl }}</code></div>
      </section>
    </main>
  `
}).mount("#app");
