<template>
  <div class="peer-network-scene">
    <canvas
      ref="canvas"
      class="peer-network-canvas"
      aria-label="Live PeerPigeon peer network. Solid edges are direct, dashed edges are relayed, node size indicates hop distance, white points are distant peers, and glow indicates activity."
      @pointermove="handlePointerMove"
      @pointerleave="handlePointerLeave"
    ></canvas>
    <button
      type="button"
      class="peer-network-rotation-toggle"
      :aria-label="rotationPaused ? 'Resume graph rotation' : 'Pause graph rotation'"
      :title="rotationPaused ? 'Resume rotation' : 'Pause rotation'"
      :aria-pressed="rotationPaused"
      @click="toggleRotation"
    >
      <span
        class="peer-network-rotation-icon"
        :class="rotationPaused ? 'is-play' : 'is-pause'"
        aria-hidden="true"
      ></span>
    </button>
    <div class="peer-network-status" aria-hidden="true">
      <FontAwesomeIcon :icon="networkGraphIcon" class="peer-network-status-icon" />
      <span>NETWORK GRAPH</span>
    </div>
    <div
      v-if="tooltip.visible"
      class="peer-network-tooltip"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      <strong>{{ tooltip.label }}</strong>
      <span>{{ tooltip.peerId }}</span>
      <small>{{ tooltip.detail }}</small>
    </div>
  </div>
</template>

<script>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faDiagramProject } from '@fortawesome/free-solid-svg-icons';
import {
  assignPeerColor,
  MIN_PEER_NODE_IDLE_ALPHA,
  PEER_COLOR_ALGORITHM_VERSION,
  PEER_NODE_IDLE_ALPHA,
  SELF_NODE_IDLE_ALPHA,
} from '../peer-color.js';
import { canonicalPeerId, formatPeerId } from '../peer-id.js';

const DISTANT_STAR_RADIUS_THRESHOLD = 5;
const DISTANT_STAR_POINT_RADIUS = 1.65;
const GRAPH_ROTATION_RADIANS_PER_MS = 0.000065;
const STAR_TO_CIRCLE_GROWTH_MS = 1800;
const LINK_STYLE_TRANSITION_MS = 900;
const LINK_VISIBILITY_TRANSITION_MS = 700;
const LINK_GLOW_RESPONSE_MS = 280;
const LABEL_OPACITY_RESPONSE_MS = 280;
const NODE_VISIBILITY_RESPONSE_MS = 120;
const NODE_EXIT_VISIBILITY_EPSILON = 0.01;
const MAX_NODE_TRAVEL_PX_PER_MS = 0.045;
const MAX_NODE_TRAVEL_PX_PER_FRAME = 1.25;
const MAX_NODE_RADIUS_CHANGE_PX_PER_MS = 0.012;

function transitionValue(from, to, startedAt, duration, now) {
  const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
  const eased = progress * progress * (3 - 2 * progress);
  return from + (to - from) * eased;
}

function limitScreenTravel(previousX, previousY, targetX, targetY, elapsedMs) {
  if (![previousX, previousY, targetX, targetY].every(Number.isFinite)) {
    return { x: targetX, y: targetY };
  }
  const deltaX = targetX - previousX;
  const deltaY = targetY - previousY;
  const distance = Math.hypot(deltaX, deltaY);
  const maximumTravel = Math.max(
    0.25,
    Math.min(MAX_NODE_TRAVEL_PX_PER_FRAME, elapsedMs * MAX_NODE_TRAVEL_PX_PER_MS),
  );
  if (distance <= maximumTravel || distance === 0) return { x: targetX, y: targetY };
  const ratio = maximumTravel / distance;
  return {
    x: previousX + deltaX * ratio,
    y: previousY + deltaY * ratio,
  };
}

function limitRadiusChange(previousRadius, targetRadius, elapsedMs) {
  if (!Number.isFinite(previousRadius) || !Number.isFinite(targetRadius)) return targetRadius;
  const maximumChange = Math.max(0.08, elapsedMs * MAX_NODE_RADIUS_CHANGE_PX_PER_MS);
  return previousRadius + Math.max(
    -maximumChange,
    Math.min(maximumChange, targetRadius - previousRadius),
  );
}

function hashPeerId(value) {
  const text = String(value || 'peer');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizedPeerPosition(peerId, isSelf) {
  if (isSelf) return { x: 0, y: 0, z: 0 };

  const first = hashPeerId(peerId);
  const second = hashPeerId(`${peerId}:depth`);
  const third = hashPeerId(`${peerId}:radius`);
  const theta = (first / 0xffffffff) * Math.PI * 2;
  const z = (second / 0xffffffff) * 2 - 1;
  const ring = Math.sqrt(Math.max(0, 1 - z * z));
  const radius = 0.78 + (third / 0xffffffff) * 0.38;

  return {
    x: Math.cos(theta) * ring * radius,
    y: Math.sin(theta) * ring * radius,
    z: z * radius,
  };
}

function peerRotationSpeedFactor(peerId, hopDistance, isSelf) {
  if (isSelf) return 0;

  // Peers in the same hop band must not move in lockstep. The peer-ID hash
  // gives each peer a stable speed within its band, while non-overlapping
  // bands preserve parallax: every nearer circle is faster than every farther
  // circle. Peers rendered as stars remain fixed by projectNodes.
  const variation = hashPeerId(`${peerId}:orbit-speed`) / 0xffffffff;
  const hops = Number(hopDistance);
  if (hops === 1) return 0.92 + variation * 0.20;
  if (hops === 2) return 0.72 + variation * 0.16;
  if (hops === 3) return 0.48 + variation * 0.12;
  return 0.30 + variation * 0.10;
}

function peerSizeProfile(peerId, hopDistance, isSelf) {
  const variation = hashPeerId(`${peerId}:node-size`) / 0xffffffff;
  if (isSelf) {
    return { circleRadius: 11.5 + variation, starPointRadius: 0 };
  }

  const hops = Number(hopDistance);
  if (hops === 1) {
    return { circleRadius: 7.4 + variation * 1.8, starPointRadius: 0 };
  }
  if (hops === 2) {
    return { circleRadius: 5.25 + variation * 1.5, starPointRadius: 0 };
  }

  // Distant tiers remain stars, but each hop tier and each peer within it has
  // a deterministic size range. Clamp the farthest tiers above a visible
  // floor so no live identity disappears into a sub-pixel point.
  const distantTier = Number.isInteger(hops) && hops >= 3
    ? Math.min(24, hops - 3)
    : 8;
  const starDistanceDecay = 0.75 ** distantTier;
  return {
    circleRadius: Math.max(3.05, 4.35 - distantTier * 0.2 + variation * 0.4),
    // Every farther star tier is strictly smaller than the tier before it,
    // while the additive floor and glow keep even very distant peers visible.
    starPointRadius: 0.65 + (1.15 + variation * 0.3) * starDistanceDecay,
  };
}

function hexToRgb(hex) {
  const normalized = String(hex || '#ffffff').replace('#', '');
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function blendTowardWhite(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const blend = Math.max(0, Math.min(1, amount));
  return `rgb(${Math.round(r + (255 - r) * blend)}, ${Math.round(g + (255 - g) * blend)}, ${Math.round(b + (255 - b) * blend)})`;
}

function nodeCoreAppearance(node) {
  const growthProgress = node?.distantPoint
    ? 0
    : Math.max(0, Math.min(1, Number(node?.circleGrowthProgress) || 0));
  const easedGrowth = growthProgress * growthProgress * (3 - 2 * growthProgress);
  const shrinkProgress = node?.distantPoint
    ? Math.max(0, Math.min(1, Number(node?.starShrinkProgress) || 0))
    : 0;
  const easedShrink = shrinkProgress * shrinkProgress * (3 - 2 * shrinkProgress);
  const transitionWhite = node?.distantPoint ? easedShrink : 1 - easedGrowth;
  const activity = Math.max(0, Math.min(1, Number(node?.activity) || 0));
  const distanceScale = Math.max(0.35, Math.min(1, Number(node?.distanceScale) || 0.35));
  const minimumCircleScale = DISTANT_STAR_RADIUS_THRESHOLD / 8;
  const distanceOpacityProgress = Math.max(0, Math.min(
    1,
    (distanceScale - minimumCircleScale) / (1 - minimumCircleScale),
  ));
  const remoteIdleAlpha = MIN_PEER_NODE_IDLE_ALPHA
    + (PEER_NODE_IDLE_ALPHA - MIN_PEER_NODE_IDLE_ALPHA) * distanceOpacityProgress;
  const idleAlpha = node?.isSelf ? SELF_NODE_IDLE_ALPHA : remoteIdleAlpha;
  // Activity adds the same opacity increment at every distance, preserving the
  // distance fade instead of making all active circles equally opaque.
  const circleAlpha = Math.min(0.96, idleAlpha + activity * 0.2);
  return {
    growthProgress,
    easedGrowth,
    easedShrink,
    color: blendTowardWhite(
      node?.color || '#7df9ff',
      Math.max(activity * 0.8, transitionWhite),
    ),
    alpha: node?.distantPoint
      ? circleAlpha + (0.96 - circleAlpha) * easedShrink
      : 0.96 + (circleAlpha - 0.96) * easedGrowth,
  };
}

export default {
  name: 'PeerNetworkGraph',
  components: {
    FontAwesomeIcon,
  },
  props: {
    nodes: {
      type: Array,
      default: () => [],
    },
    links: {
      type: Array,
      default: () => [],
    },
    activityByPeer: {
      type: Object,
      default: () => ({}),
    },
  },
  data() {
    return {
      networkGraphIcon: faDiagramProject,
      rotationPaused: false,
      tooltip: {
        visible: false,
        x: 0,
        y: 0,
        label: '',
        peerId: '',
        detail: '',
      },
    };
  },
  watch: {
    nodes: {
      deep: true,
      handler() {
        this.rebuildScene();
      },
    },
    links: {
      deep: true,
      handler() {
        this.rebuildScene();
      },
    },
    activityByPeer: {
      deep: true,
      handler(nextActivity) {
        this.applyActivity(nextActivity);
      },
    },
  },
  mounted() {
    this._activity = new Map();
    this._peerColorById = new Map();
    this._peerColorAlgorithmVersion = PEER_COLOR_ALGORITHM_VERSION;
    this._linkVisualStateByKey = new Map();
    this._visualStateByPeerId = new Map();
    this._pointerPosition = null;
    this.rotationPaused = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this._scene = {
      animationFrame: null,
      canvas: this.$refs.canvas,
      ctx: this.$refs.canvas?.getContext('2d') || null,
      dpr: 1,
      height: 1,
      lastFrameAt: 0,
      links: [],
      nodeIds: new Set(),
      nodes: [],
      projectedNodes: [],
      rotationDirection: Math.random() < 0.5 ? -1 : 1,
      rotationY: 0,
      width: 1,
    };
    this._scene.paint = (timestamp) => this.paintFrame(timestamp);
    this._resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => this.resizeCanvas())
      : null;
    this._resizeObserver?.observe(this.$el);
    this.applyActivity(this.activityByPeer);
    this.rebuildScene();
    this.resizeCanvas();
    this._scene.animationFrame = requestAnimationFrame(this._scene.paint);
  },
  updated() {
    // Vue preserves component instances across HMR. Rebuild immediately when
    // the color algorithm changes so cached self colors cannot survive it.
    if (this._peerColorAlgorithmVersion !== PEER_COLOR_ALGORITHM_VERSION) {
      this.rebuildScene();
    }
  },
  beforeUnmount() {
    if (this._scene?.animationFrame) cancelAnimationFrame(this._scene.animationFrame);
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._scene = null;
    this._activity?.clear();
    this._peerColorById?.clear();
    this._linkVisualStateByKey?.clear();
    this._visualStateByPeerId?.clear();
    this._pointerPosition = null;
  },
  methods: {
    applyActivity(activity) {
      if (!this._activity) return;
      for (const [peerId, timestamp] of Object.entries(activity || {})) {
        const normalizedTimestamp = Number(timestamp);
        if (!peerId || !Number.isFinite(normalizedTimestamp)) continue;
        const previous = this._activity.get(peerId) || 0;
        if (normalizedTimestamp > previous) this._activity.set(peerId, normalizedTimestamp);
      }
    },

    rebuildScene() {
      const scene = this._scene;
      if (!scene) return;
      if (this._peerColorAlgorithmVersion !== PEER_COLOR_ALGORITHM_VERSION) {
        this._peerColorById.clear();
        this._peerColorAlgorithmVersion = PEER_COLOR_ALGORITHM_VERSION;
      }

      const previousById = new Map(scene.nodes.map((node) => [node.id, node]));
      const previousIds = scene.nodeIds;
      const nextNodes = (this.nodes || [])
        .map((input) => {
          const id = canonicalPeerId(input?.id);
          if (!id) return null;
          const previous = previousById.get(id);
          const position = previous || normalizedPeerPosition(id, Boolean(input.isSelf));
          const requestedScale = Number(input.distanceScale);
          if (!this._peerColorById.has(id)) {
            this._peerColorById.set(id, assignPeerColor(id));
          }
          return {
            ...input,
            id,
            // Self is a role in this local view, not a second identity. Remote
            // nodes show the canonical compact ID; the center node says (You)
            // while its full canonical ID remains available in the tooltip.
            label: input.isSelf ? '(You)' : formatPeerId(id),
            color: this._peerColorById.get(id),
            distanceScale: Number.isFinite(requestedScale)
              ? Math.max(0.35, Math.min(1, requestedScale))
              : 1,
            bornAt: previous?.bornAt || Date.now(),
            // A peer's world position is assigned once from its ID and is
            // retained across every discovery/connection state change.
            x: position.x,
            y: position.y,
            z: position.z,
          };
        })
        .filter(Boolean);

      if (previousIds.size > 0) {
        const now = Date.now();
        for (const node of nextNodes) {
          if (!previousIds.has(node.id)) this._activity.set(node.id, now);
        }
      }

      const nextIds = new Set(nextNodes.map((node) => node.id));
      if (this._visualStateByPeerId) {
        for (const node of nextNodes) {
          const visualState = this._visualStateByPeerId.get(node.id);
          if (!visualState) continue;
          visualState.reappearing = visualState.present === false;
          visualState.present = true;
        }
        for (const [peerId, visualState] of this._visualStateByPeerId) {
          if (!nextIds.has(peerId)) visualState.present = false;
        }
      }
      const renderNodes = nextNodes.slice();
      for (const previousNode of scene.nodes) {
        if (nextIds.has(previousNode.id)) continue;
        const visualState = this._visualStateByPeerId?.get(previousNode.id);
        if (!visualState) continue;
        visualState.present = false;
        if (
          !Number.isFinite(visualState.visibilityOpacity)
          || visualState.visibilityOpacity > NODE_EXIT_VISIBILITY_EPSILON
        ) {
          renderNodes.push({ ...previousNode, exiting: true });
        }
      }
      const links = (this.links || [])
        .map((link) => {
          const source = String(typeof link.source === 'object' ? link.source?.id : link.source || '').trim();
          const target = String(typeof link.target === 'object' ? link.target?.id : link.target || '').trim();
          if (!source || !target || !nextIds.has(source) || !nextIds.has(target)) return null;
          const [canonicalSource, canonicalTarget] = source < target ? [source, target] : [target, source];
          return {
            key: `${canonicalSource}\u0000${canonicalTarget}`,
            source: canonicalSource,
            target: canonicalTarget,
            direct: Boolean(link.direct),
            exiting: false,
          };
        })
        .filter(Boolean);
      const activeLinkKeys = new Set(links.map((link) => link.key));
      for (const previousLink of scene.links) {
        if (activeLinkKeys.has(previousLink.key)) continue;
        links.push({ ...previousLink, exiting: true });
      }
      const retainedLinkKeys = new Set(links.map((link) => link.key));
      for (const linkKey of this._linkVisualStateByKey?.keys() || []) {
        if (!retainedLinkKeys.has(linkKey)) this._linkVisualStateByKey.delete(linkKey);
      }

      scene.nodes = renderNodes;
      scene.nodeIds = nextIds;
      scene.links = links;
      this.resizeCanvas();
    },

    resizeCanvas() {
      const scene = this._scene;
      if (!scene?.canvas || !scene.ctx) return;
      const rect = scene.canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);

      if (scene.canvas.width !== pixelWidth || scene.canvas.height !== pixelHeight) {
        scene.canvas.width = pixelWidth;
        scene.canvas.height = pixelHeight;
      }
      scene.width = width;
      scene.height = height;
      scene.dpr = dpr;
    },

    activityStrength(peerId, now) {
      const startedAt = this._activity?.get(peerId);
      if (!startedAt) return 0;
      const age = now - startedAt;
      // The banner uses a 1.2–1.8 second activity window per node.
      const duration = 1200 + (hashPeerId(`${peerId}:activity-duration`) % 601);
      if (age < 0 || age >= duration) {
        if (age >= duration) this._activity.delete(peerId);
        return 0;
      }

      const phase = age / duration;
      if (phase < 0.2) return phase / 0.2;
      if (phase < 0.8) return 1;
      return 1 - (phase - 0.8) / 0.2;
    },

    projectNodes(scene, now) {
      const scale = Math.min(scene.width, scene.height) * 0.34;
      const centerX = scene.width / 2;
      const centerY = scene.height / 2;

      return scene.nodes.map((node) => {
        // Size reflects shortest-path distance from this peer, independent of
        // camera perspective. Direct peers retain the full remote radius.
        const sizeProfile = peerSizeProfile(node.id, node.hopDistance, node.isSelf);
        const baseRadius = sizeProfile.circleRadius;
        const starPointRadius = sizeProfile.starPointRadius || DISTANT_STAR_POINT_RADIUS;
        const distantPoint = !node.isSelf && baseRadius < DISTANT_STAR_RADIUS_THRESHOLD;
        const rotationSpeedFactor = peerRotationSpeedFactor(
          node.id,
          node.hopDistance,
          node.isSelf,
        );
        let visualState = this._visualStateByPeerId.get(node.id);
        if (!visualState) {
          visualState = {
            distantPoint,
            present: true,
            reappearing: false,
            renderAnchorX: Number.NaN,
            renderAnchorY: Number.NaN,
            renderScreenX: Number.NaN,
            renderScreenY: Number.NaN,
            lastProjectedAt: now,
            rotationSpeedFactor,
            rotationOffset: 0,
            starAnchorX: null,
            starAnchorY: null,
            starRotationY: scene.rotationY * rotationSpeedFactor,
            displayRadius: distantPoint ? starPointRadius : null,
            starPointRadius,
            starShrinkFromRadius: starPointRadius,
            starShrinkStartedAt: null,
            positionTransitionDurationMs: null,
            positionTransitionFromX: null,
            positionTransitionFromY: null,
            positionTransitionStartedAt: null,
            circleGrowthDurationMs: STAR_TO_CIRCLE_GROWTH_MS,
            circleGrowthStartedAt: null,
            beginCirclePositionTransition: false,
            labelOpacity: 0,
            visibilityOpacity: 0,
          };
          this._visualStateByPeerId.set(node.id, visualState);
        } else if (visualState.rotationSpeedFactor !== rotationSpeedFactor) {
          // Preserve the exact current orbital phase when a topology update
          // moves a peer into a different speed band or HMR changes the bands.
          const previousSpeedFactor = Number.isFinite(visualState.rotationSpeedFactor)
            ? visualState.rotationSpeedFactor
            : 1;
          const currentRotationY = scene.rotationY * previousSpeedFactor
            + (Number.isFinite(visualState.rotationOffset) ? visualState.rotationOffset : 0);
          visualState.rotationSpeedFactor = rotationSpeedFactor;
          visualState.rotationOffset = currentRotationY
            - scene.rotationY * rotationSpeedFactor;
        }
        if (visualState.distantPoint !== distantPoint) {
          if (distantPoint) {
            // Stop at the exact current orbital phase and screen position.
            visualState.starRotationY = scene.rotationY * visualState.rotationSpeedFactor
              + visualState.rotationOffset;
            visualState.starAnchorX = Number.isFinite(visualState.renderScreenX)
              ? (visualState.renderScreenX - centerX) / scale
              : null;
            visualState.starAnchorY = Number.isFinite(visualState.renderScreenY)
              ? (visualState.renderScreenY - centerY) / scale
              : null;
            visualState.starShrinkFromRadius = Number.isFinite(visualState.displayRadius)
              ? visualState.displayRadius
              : Math.max(3.25, baseRadius);
            visualState.starShrinkStartedAt = now;
            visualState.positionTransitionStartedAt = null;
            visualState.circleGrowthStartedAt = null;
          } else {
            // Resume from the star's frozen orbital phase. The shared graph
            // clock supplies movement at this peer's distance-adjusted speed.
            visualState.rotationOffset = visualState.starRotationY
              - scene.rotationY * visualState.rotationSpeedFactor;
            visualState.circleGrowthFromRadius = Number.isFinite(visualState.displayRadius)
              ? visualState.displayRadius
              : starPointRadius;
            visualState.starShrinkStartedAt = null;
            visualState.circleGrowthDurationMs = STAR_TO_CIRCLE_GROWTH_MS;
            visualState.circleGrowthStartedAt = now;
            visualState.beginCirclePositionTransition = true;
          }
          visualState.distantPoint = distantPoint;
        }
        const previousStarPointRadius = Number.isFinite(visualState.starPointRadius)
          ? visualState.starPointRadius
          : starPointRadius;
        if (
          distantPoint
          && Math.abs(previousStarPointRadius - starPointRadius) > 0.001
        ) {
          // A peer that moves between distant hop tiers must resize from its
          // currently rendered point instead of popping to the new tier size.
          visualState.starShrinkFromRadius = Number.isFinite(visualState.displayRadius)
            ? visualState.displayRadius
            : previousStarPointRadius;
          visualState.starShrinkStartedAt = now;
        }
        visualState.starPointRadius = starPointRadius;

        const effectiveRotationY = distantPoint
          ? visualState.starRotationY
          : scene.rotationY * visualState.rotationSpeedFactor + visualState.rotationOffset;
        const cosY = Math.cos(effectiveRotationY);
        const sinY = Math.sin(effectiveRotationY);
        const tiltX = Math.sin(effectiveRotationY * 0.32) * 0.11;
        const cosX = Math.cos(tiltX);
        const sinX = Math.sin(tiltX);
        const autoX = node.x * cosY + node.z * sinY;
        const autoZ = -node.x * sinY + node.z * cosY;
        const rotatedY = node.y * cosX - autoZ * sinX;
        const rotatedZ = node.y * sinX + autoZ * cosX;
        const perspective = 3.2 / (3.2 + rotatedZ);
        const activity = this.activityStrength(node.id, now);
        const intro = Math.min(1, Math.max(0.18, (now - node.bornAt) / 520));
        // HMR can preserve visual-state objects created before this timestamp
        // field existed. Treat those as one normal frame old so the continuity
        // limiter is active immediately instead of receiving NaN.
        const previousProjectionAt = Number.isFinite(visualState.lastProjectedAt)
          ? visualState.lastProjectedAt
          : now - 16;
        const frameElapsedMs = Math.min(50, Math.max(1, now - previousProjectionAt));
        const visibilityTarget = visualState.present === false || node.exiting ? 0 : 1;
        if (!Number.isFinite(visualState.visibilityOpacity)) {
          // HMR may add this field to already-rendered peers. Preserve their
          // current visibility; only actual additions begin at zero.
          visualState.visibilityOpacity = 1;
        } else {
          const visibilityBlend = 1 - Math.exp(-frameElapsedMs / NODE_VISIBILITY_RESPONSE_MS);
          visualState.visibilityOpacity += (
            visibilityTarget - visualState.visibilityOpacity
          ) * visibilityBlend;
        }
        const labelTargetOpacity = distantPoint ? 0.84 : 1;
        if (!Number.isFinite(visualState.labelOpacity)) {
          // Preserve labels when HMR upgrades an existing visual-state object.
          visualState.labelOpacity = labelTargetOpacity;
        } else {
          const labelBlend = 1 - Math.exp(-frameElapsedMs / LABEL_OPACITY_RESPONSE_MS);
          visualState.labelOpacity += (labelTargetOpacity - visualState.labelOpacity) * labelBlend;
        }
        const targetRadius = baseRadius * (0.72 + intro * 0.28);
        const radius = !distantPoint && !Number.isFinite(visualState.circleGrowthStartedAt)
          ? limitRadiusChange(visualState.displayRadius, targetRadius, frameElapsedMs)
          : targetRadius;
        const orbitScreenX = centerX + autoX * scale * perspective;
        const orbitScreenY = centerY + rotatedY * scale * perspective;
        if (!distantPoint && visualState.beginCirclePositionTransition) {
          const previousScreenX = Number.isFinite(visualState.renderScreenX)
            ? visualState.renderScreenX
            : orbitScreenX;
          const previousScreenY = Number.isFinite(visualState.renderScreenY)
            ? visualState.renderScreenY
            : orbitScreenY;
          const travelDistance = Math.hypot(
            orbitScreenX - previousScreenX,
            orbitScreenY - previousScreenY,
          );
          const orbitRadius = Math.max(24, Math.hypot(orbitScreenX - centerX, orbitScreenY - centerY));
          const rotationSpeed = Math.max(
            0.004,
            orbitRadius * GRAPH_ROTATION_RADIANS_PER_MS * Math.max(0.25, visualState.rotationSpeedFactor),
          );
          const transitionDuration = Math.max(
            STAR_TO_CIRCLE_GROWTH_MS,
            Math.min(12_000, travelDistance / rotationSpeed),
          );
          visualState.positionTransitionFromX = previousScreenX;
          visualState.positionTransitionFromY = previousScreenY;
          visualState.positionTransitionStartedAt = now;
          visualState.positionTransitionDurationMs = transitionDuration;
          visualState.circleGrowthDurationMs = transitionDuration;
          visualState.beginCirclePositionTransition = false;
        }
        if (distantPoint && visualState.starAnchorX == null) {
          visualState.starAnchorX = (orbitScreenX - centerX) / scale;
          visualState.starAnchorY = (orbitScreenY - centerY) / scale;
        }

        let screenX = distantPoint
          ? centerX + visualState.starAnchorX * scale
          : orbitScreenX;
        let screenY = distantPoint
          ? centerY + visualState.starAnchorY * scale
          : orbitScreenY;
        if (visualState.reappearing) {
          const previousScreenX = Number.isFinite(visualState.renderAnchorX)
            ? centerX + visualState.renderAnchorX * scale
            : screenX;
          const previousScreenY = Number.isFinite(visualState.renderAnchorY)
            ? centerY + visualState.renderAnchorY * scale
            : screenY;
          const travelDistance = Math.hypot(screenX - previousScreenX, screenY - previousScreenY);
          const orbitRadius = Math.max(24, Math.hypot(screenX - centerX, screenY - centerY));
          const rotationSpeed = Math.max(0.006, orbitRadius * GRAPH_ROTATION_RADIANS_PER_MS);
          const transitionDuration = Math.max(
            STAR_TO_CIRCLE_GROWTH_MS,
            Math.min(12_000, travelDistance / rotationSpeed),
          );
          if (!distantPoint) {
            visualState.positionTransitionFromX = previousScreenX;
            visualState.positionTransitionFromY = previousScreenY;
            visualState.positionTransitionStartedAt = now;
            visualState.positionTransitionDurationMs = transitionDuration;
            visualState.circleGrowthFromRadius = starPointRadius;
            visualState.circleGrowthStartedAt = now;
            visualState.circleGrowthDurationMs = transitionDuration;
          } else {
            visualState.positionTransitionStartedAt = null;
          }
          visualState.reappearing = false;
        }
        if (!distantPoint && Number.isFinite(visualState.positionTransitionStartedAt)) {
          const transitionProgress = Math.min(1, Math.max(
            0,
            (now - visualState.positionTransitionStartedAt) / visualState.positionTransitionDurationMs,
          ));
          screenX = visualState.positionTransitionFromX
            + (screenX - visualState.positionTransitionFromX) * transitionProgress;
          screenY = visualState.positionTransitionFromY
            + (screenY - visualState.positionTransitionFromY) * transitionProgress;
          if (transitionProgress >= 1) visualState.positionTransitionStartedAt = null;
        }
        const circleGrowthProgress = !distantPoint && Number.isFinite(visualState.circleGrowthStartedAt)
          ? Math.min(1, Math.max(
            0,
            (now - visualState.circleGrowthStartedAt) / visualState.circleGrowthDurationMs,
          ))
          : 1;
        if (circleGrowthProgress >= 1) visualState.circleGrowthStartedAt = null;
        const starShrinkProgress = distantPoint && Number.isFinite(visualState.starShrinkStartedAt)
          ? Math.min(1, Math.max(
            0,
            (now - visualState.starShrinkStartedAt) / STAR_TO_CIRCLE_GROWTH_MS,
          ))
          : (distantPoint ? 1 : 0);
        if (starShrinkProgress >= 1) visualState.starShrinkStartedAt = null;
        const continuousPosition = limitScreenTravel(
          visualState.renderScreenX,
          visualState.renderScreenY,
          screenX,
          screenY,
          frameElapsedMs,
        );
        screenX = continuousPosition.x;
        screenY = continuousPosition.y;
        visualState.renderScreenX = screenX;
        visualState.renderScreenY = screenY;
        visualState.lastProjectedAt = now;
        visualState.renderAnchorX = (screenX - centerX) / scale;
        visualState.renderAnchorY = (screenY - centerY) / scale;

        return {
          ...node,
          activity,
          depth: distantPoint ? node.z : rotatedZ,
          distantPoint,
          circleGrowthProgress,
          circleGrowthFromRadius: visualState.circleGrowthFromRadius ?? starPointRadius,
          starShrinkProgress,
          starShrinkFromRadius: visualState.starShrinkFromRadius,
          starPointRadius: visualState.starPointRadius,
          labelOpacity: visualState.labelOpacity,
          visibilityOpacity: visualState.visibilityOpacity,
          radius,
          screenX,
          screenY,
        };
      });
    },

    drawBackground(ctx, width, height) {
      const vignette = ctx.createRadialGradient(width * 0.5, height * 0.48, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
      vignette.addColorStop(0, 'rgba(255, 255, 255, 0.025)');
      vignette.addColorStop(0.58, 'rgba(0, 0, 0, 0.08)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    },

    drawLegend(ctx, width, height, projectedNodes = []) {
      const left = 16;
      const panelHeight = 188;
      const top = height - panelHeight - 14;
      const corner = 10;
      const iconX = left + 19;
      const labelX = left + 40;
      const legendFont = '700 9px Monaco, "Courier New", monospace';
      const rowStartY = top + 22;
      const rowGap = 24;
      const selfNode = projectedNodes.find((node) => node.isSelf);
      const selfAppearance = selfNode ? nodeCoreAppearance(selfNode) : null;
      const items = [
        {
          label: selfNode?.id ? `YOU (${formatPeerId(selfNode.id)})` : 'YOU',
          type: 'node',
          radius: 12,
          color: selfAppearance?.color || 'rgba(125, 249, 255, 0.82)',
          alpha: selfAppearance?.alpha ?? 1,
        },
        { label: '1 HOP', type: 'node', radius: 8, color: 'rgba(125, 249, 255, 0.72)' },
        { label: '2 HOPS', type: 'node', radius: 8 / Math.sqrt(2), color: 'rgba(255, 153, 220, 0.7)' },
        { label: '3+ HOPS', type: 'star', radius: DISTANT_STAR_POINT_RADIUS, color: '#ffffff' },
        { label: 'DIRECT', type: 'line' },
        { label: 'RELAYED', type: 'line', dashed: true },
        { label: 'ACTIVE', type: 'active' },
      ];

      ctx.save();
      ctx.font = legendFont;
      const widestLabel = Math.max(...items.map((item) => ctx.measureText(item.label).width));
      const desiredPanelWidth = Math.ceil(labelX - left + widestLabel + 12);
      const panelWidth = Math.max(
        corner * 2,
        Math.min(desiredPanelWidth, Math.max(corner * 2, width - left - 16)),
      );
      ctx.beginPath();
      ctx.moveTo(left + corner, top);
      ctx.lineTo(left + panelWidth - corner, top);
      ctx.quadraticCurveTo(left + panelWidth, top, left + panelWidth, top + corner);
      ctx.lineTo(left + panelWidth, top + panelHeight - corner);
      ctx.quadraticCurveTo(left + panelWidth, top + panelHeight, left + panelWidth - corner, top + panelHeight);
      ctx.lineTo(left + corner, top + panelHeight);
      ctx.quadraticCurveTo(left, top + panelHeight, left, top + panelHeight - corner);
      ctx.lineTo(left, top + corner);
      ctx.quadraticCurveTo(left, top, left + corner, top);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.075)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = legendFont;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';

      items.forEach((item, index) => {
        const rowY = rowStartY + index * rowGap;
        if (item.type === 'line') {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(iconX - 9, rowY);
          ctx.lineTo(iconX + 9, rowY);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
          ctx.lineWidth = 1;
          if (item.dashed) ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.save();
          ctx.beginPath();
          ctx.arc(iconX, rowY, item.radius || 2, 0, Math.PI * 2);
          ctx.globalAlpha = item.alpha ?? 1;
          ctx.fillStyle = item.color || '#8ff7ff';
          if (item.type === 'star') {
            ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
            ctx.shadowBlur = 6;
          } else if (item.type === 'active') {
            ctx.shadowColor = 'rgba(143, 247, 255, 0.9)';
            ctx.shadowBlur = 8;
          }
          ctx.fill();
          ctx.restore();
        }
        ctx.fillText(item.label, labelX, rowY);
      });
      ctx.restore();
    },

    drawLink(ctx, link, byId, now) {
      const liveSource = byId.get(link.source);
      const liveTarget = byId.get(link.target);
      const directTarget = link.direct ? 1 : 0;
      const visibilityTarget = link.exiting ? 0 : 1;
      let state = this._linkVisualStateByKey.get(link.key);
      if (!state) {
        if (!liveSource || !liveTarget) return false;
        state = {
          directFrom: directTarget,
          directMix: directTarget,
          directTarget,
          directStartedAt: now,
          glow: 0,
          lastFrameAt: now,
          visibility: 0,
          visibilityFrom: 0,
          visibilityTarget,
          visibilityStartedAt: now,
          sourceScreenX: liveSource.screenX,
          sourceScreenY: liveSource.screenY,
          targetScreenX: liveTarget.screenX,
          targetScreenY: liveTarget.screenY,
        };
        this._linkVisualStateByKey.set(link.key, state);
      }

      if (liveSource) {
        state.sourceScreenX = liveSource.screenX;
        state.sourceScreenY = liveSource.screenY;
      }
      if (liveTarget) {
        state.targetScreenX = liveTarget.screenX;
        state.targetScreenY = liveTarget.screenY;
      }
      if (
        !Number.isFinite(state.sourceScreenX)
        || !Number.isFinite(state.sourceScreenY)
        || !Number.isFinite(state.targetScreenX)
        || !Number.isFinite(state.targetScreenY)
      ) return false;

      const activity = Math.max(liveSource?.activity || 0, liveTarget?.activity || 0);

      state.directMix = transitionValue(
        state.directFrom,
        state.directTarget,
        state.directStartedAt,
        LINK_STYLE_TRANSITION_MS,
        now,
      );
      if (state.directTarget !== directTarget) {
        state.directFrom = state.directMix;
        state.directTarget = directTarget;
        state.directStartedAt = now;
      }
      state.visibility = transitionValue(
        state.visibilityFrom,
        state.visibilityTarget,
        state.visibilityStartedAt,
        LINK_VISIBILITY_TRANSITION_MS,
        now,
      );
      if (state.visibilityTarget !== visibilityTarget) {
        state.visibilityFrom = state.visibility;
        state.visibilityTarget = visibilityTarget;
        state.visibilityStartedAt = now;
      }
      const elapsed = Math.min(100, Math.max(0, now - state.lastFrameAt));
      const glowBlend = 1 - Math.exp(-elapsed / LINK_GLOW_RESPONSE_MS);
      state.glow += (activity - state.glow) * glowBlend;
      state.lastFrameAt = now;

      const strokeVariant = (weight, dashed) => {
        const opacity = state.visibility * weight;
        if (opacity <= 0.002) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(state.sourceScreenX, state.sourceScreenY);
        ctx.lineTo(state.targetScreenX, state.targetScreenY);
        if (dashed) ctx.setLineDash([5, 5]);

        if (state.glow > 0.002) {
          ctx.globalAlpha = opacity * state.glow * 0.42;
          ctx.strokeStyle = '#8ff7ff';
          ctx.lineWidth = 1;
          ctx.shadowColor = 'rgba(143, 247, 255, 0.72)';
          ctx.shadowBlur = 8 + state.glow * 6;
          ctx.stroke();
        }

        ctx.globalAlpha = opacity;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 + state.glow * 0.35})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.restore();
      };

      strokeVariant(1 - state.directMix, true);
      strokeVariant(state.directMix, false);
      if (link.exiting && state.visibility <= 0.002) {
        this._linkVisualStateByKey.delete(link.key);
        return false;
      }
      return true;
    },

    drawNode(ctx, node) {
      const visibilityOpacity = Math.max(
        0,
        Math.min(1, Number(node.visibilityOpacity) || 0),
      );
      if (visibilityOpacity <= 0.001) return;
      const {
        growthProgress,
        easedGrowth,
        easedShrink,
        color: activityColor,
        alpha: coreAlpha,
      } = nodeCoreAppearance(node);
      const starPointRadius = Number.isFinite(node.starPointRadius)
        ? node.starPointRadius
        : DISTANT_STAR_POINT_RADIUS;
      const fullCircleRadius = Math.max(3.25, node.radius);
      const shrinkFromRadius = Number.isFinite(node.starShrinkFromRadius)
        ? node.starShrinkFromRadius
        : fullCircleRadius;
      const growthFromRadius = Number.isFinite(node.circleGrowthFromRadius)
        ? node.circleGrowthFromRadius
        : starPointRadius;
      const radius = node.distantPoint
        ? shrinkFromRadius + (starPointRadius - shrinkFromRadius) * easedShrink
        : growthFromRadius + (fullCircleRadius - growthFromRadius) * easedGrowth;
      const visualState = this._visualStateByPeerId.get(node.id);
      if (visualState) visualState.displayRadius = radius;
      node.renderRadius = radius;
      // Match the banner's two-mesh treatment: a flat core plus a 1.5x
      // translucent outer circle that exists only during real peer activity.
      const glowRadius = node.distantPoint
        ? Math.max(4.5, radius * 1.5)
        : Math.max(4.5 * (1 - easedGrowth), radius * 1.5);
      ctx.save();
      if (node.distantPoint || growthProgress < 0.2) {
        ctx.shadowColor = 'rgba(255, 255, 255, 0.78)';
        ctx.shadowBlur = 6 + node.activity * 5;
      }
      if (node.activity > 0) {
        ctx.globalAlpha = node.activity * 0.3 * visibilityOpacity;
        ctx.fillStyle = activityColor;
        ctx.beginPath();
        ctx.arc(node.screenX, node.screenY, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = coreAlpha * visibilityOpacity;
      ctx.fillStyle = activityColor;
      ctx.beginPath();
      ctx.arc(node.screenX, node.screenY, radius, 0, Math.PI * 2);
      ctx.fill();

      // A distant peer is still a real peer. Keep its exact ID prefix visible
      // after the circle contracts into a star so every live identity can be
      // located on every graph where it is known.
      // Label opacity has its own persistent transition state. Never derive it
      // directly from a connection-state branch: star/circle changes would
      // otherwise replace 0.84 with 0 for one frame and visibly flash the ID.
      const labelOpacity = Math.max(0, Math.min(1, Number(node.labelOpacity) || 0));
      if (labelOpacity > 0) {
        ctx.globalAlpha = labelOpacity * visibilityOpacity;
        ctx.shadowColor = 'rgba(18, 8, 52, 0.95)';
        ctx.shadowBlur = 4;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        ctx.font = '700 10px Monaco, "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(node.label, node.screenX, node.screenY + radius + 6);
      }
      ctx.restore();
    },

    paintFrame(timestamp) {
      const scene = this._scene;
      if (!scene?.ctx || !scene.canvas?.isConnected) return;

      const elapsed = scene.lastFrameAt ? Math.min(50, timestamp - scene.lastFrameAt) : 16;
      scene.lastFrameAt = timestamp;
      if (!this.rotationPaused) {
        scene.rotationY += elapsed * GRAPH_ROTATION_RADIANS_PER_MS * scene.rotationDirection;
      }

      const ctx = scene.ctx;
      ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
      ctx.clearRect(0, 0, scene.width, scene.height);
      this.drawBackground(ctx, scene.width, scene.height);

      const now = Date.now();
      const projected = this.projectNodes(scene, now);
      const byId = new Map(projected.map((node) => [node.id, node]));
      scene.links = scene.links.filter((link) => this.drawLink(ctx, link, byId, now));
      projected.slice().sort((a, b) => b.depth - a.depth).forEach((node) => this.drawNode(ctx, node));
      this.drawLegend(ctx, scene.width, scene.height, projected);

      const completedExitIds = new Set(
        projected
          .filter((node) => node.exiting && node.visibilityOpacity <= NODE_EXIT_VISIBILITY_EPSILON)
          .map((node) => node.id),
      );
      if (completedExitIds.size > 0) {
        scene.nodes = scene.nodes.filter((node) => !completedExitIds.has(node.id));
        for (const peerId of completedExitIds) {
          if (scene.nodeIds.has(peerId)) continue;
          this._visualStateByPeerId.delete(peerId);
          this._activity.delete(peerId);
        }
      }

      scene.projectedNodes = projected.filter((node) => node.visibilityOpacity > 0.05);
      if (this._pointerPosition) {
        this.updateTooltipAt(this._pointerPosition.x, this._pointerPosition.y);
      }
      scene.animationFrame = requestAnimationFrame(scene.paint);
    },

    findHoveredNode(scene, x, y) {
      if (!scene?.ctx) return null;
      scene.ctx.save();
      scene.ctx.font = '700 10px Monaco, "Courier New", monospace';
      const candidates = scene.projectedNodes
        .filter((node) => node.visibilityOpacity > 0.1)
        .map((node) => {
          const radius = Number.isFinite(node.renderRadius) ? node.renderRadius : node.radius;
          const distance = Math.hypot(node.screenX - x, node.screenY - y);
          const labelWidth = scene.ctx.measureText(node.label).width;
          const labelTop = node.screenY + radius + 4;
          const labelHit = x >= node.screenX - labelWidth / 2 - 4
            && x <= node.screenX + labelWidth / 2 + 4
            && y >= labelTop - 2
            && y <= labelTop + 15;
          const circleHit = distance <= Math.max(8, radius + 5);
          return { node, labelHit, circleHit, distance };
        })
        .filter((candidate) => candidate.labelHit || candidate.circleHit)
        .sort((a, b) => (
          Number(b.labelHit) - Number(a.labelHit)
          || a.distance - b.distance
          || a.node.depth - b.node.depth
        ));
      scene.ctx.restore();
      return candidates[0]?.node || null;
    },

    updateTooltipAt(x, y, rect = null) {
      const scene = this._scene;
      if (!scene?.canvas) return;
      const hovered = this.findHoveredNode(scene, x, y);

      if (!hovered) {
        if (this.tooltip.visible) this.tooltip.visible = false;
        scene.canvas.style.cursor = 'default';
        return;
      }

      scene.canvas.style.cursor = 'pointer';
      const canvasRect = rect || scene.canvas.getBoundingClientRect();
      const hopDistance = hovered.hopDistance == null ? Number.NaN : Number(hovered.hopDistance);
      const hopDetail = Number.isInteger(hopDistance) && hopDistance >= 0
        ? `${hopDistance} ${hopDistance === 1 ? 'hop' : 'hops'} away`
        : 'Temporarily awaiting a topology route';
      const nextTooltip = {
        visible: true,
        x: Math.max(12, Math.min(canvasRect.width - 210, x + 14)),
        y: Math.max(12, Math.min(canvasRect.height - 72, y + 14)),
        label: hovered.label,
        peerId: hovered.id,
        detail: hovered.isSelf
          ? 'This peer · 0 hops away'
          : `${hovered.isDirect
            ? (hovered.isTolerant ? 'Tolerant direct connection' : 'Direct connection')
            : (hovered.isDiscovered ? 'Discovered peer' : 'Indirect peer')} · ${hopDetail}`,
      };
      if (
        !this.tooltip.visible
        || this.tooltip.peerId !== nextTooltip.peerId
        || this.tooltip.x !== nextTooltip.x
        || this.tooltip.y !== nextTooltip.y
        || this.tooltip.detail !== nextTooltip.detail
      ) {
        this.tooltip = nextTooltip;
      }
    },

    handlePointerMove(event) {
      const scene = this._scene;
      if (!scene?.canvas) return;
      const rect = scene.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      this._pointerPosition = { x, y };
      this.updateTooltipAt(x, y, rect);
    },

    handlePointerLeave() {
      if (this._scene) {
        if (this._scene.canvas) this._scene.canvas.style.cursor = 'default';
      }
      this._pointerPosition = null;
      this.tooltip.visible = false;
    },

    toggleRotation() {
      this.rotationPaused = !this.rotationPaused;
    },
  },
};
</script>

<style scoped>
.peer-network-scene {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.peer-network-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.peer-network-rotation-toggle {
  position: absolute;
  z-index: 2;
  top: 14px;
  right: 16px;
  display: grid;
  width: 30px;
  height: 30px;
  padding: 0;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  background: rgba(31, 18, 81, 0.26);
  color: rgba(255, 255, 255, 0.82);
  cursor: pointer;
  backdrop-filter: blur(8px);
}

.peer-network-rotation-toggle:hover,
.peer-network-rotation-toggle:focus-visible {
  border-color: rgba(143, 247, 255, 0.72);
  background: rgba(55, 35, 120, 0.5);
  color: #8ff7ff;
  outline: none;
}

.peer-network-rotation-icon {
  display: block;
  width: 10px;
  height: 12px;
}

.peer-network-rotation-icon.is-pause {
  background: linear-gradient(
    to right,
    currentColor 0 3px,
    transparent 3px 7px,
    currentColor 7px 10px
  );
}

.peer-network-rotation-icon.is-play {
  width: 0;
  height: 0;
  margin-left: 2px;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-left: 10px solid currentColor;
}

.peer-network-status {
  position: absolute;
  top: 14px;
  left: 16px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  background: rgba(31, 18, 81, 0.26);
  color: rgba(255, 255, 255, 0.8);
  font: 700 10px/1 Monaco, "Courier New", monospace;
  letter-spacing: 0.08em;
  backdrop-filter: blur(8px);
  pointer-events: none;
}

.peer-network-status-icon {
  width: 1em;
  color: #8ff7ff;
  flex: 0 0 auto;
}

.peer-network-tooltip {
  position: absolute;
  z-index: 3;
  display: grid;
  gap: 2px;
  width: 196px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 8px;
  background: rgba(24, 12, 67, 0.88);
  box-shadow: 0 12px 30px rgba(23, 10, 58, 0.38);
  color: #ffffff;
  text-align: left;
  pointer-events: none;
  backdrop-filter: blur(12px);
}

.peer-network-tooltip strong {
  font: 800 12px/1.2 Monaco, "Courier New", monospace;
}

.peer-network-tooltip span {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.68);
  font: 500 9px/1.25 Monaco, "Courier New", monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.peer-network-tooltip small {
  color: #8ff7ff;
  font-size: 10px;
}

</style>
