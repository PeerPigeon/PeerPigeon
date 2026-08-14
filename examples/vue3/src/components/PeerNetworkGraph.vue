<template>
  <div class="peer-network-scene">
    <canvas
      ref="canvas"
      class="peer-network-canvas"
      aria-label="Live PeerPigeon peer network"
      @pointermove="handlePointerMove"
      @pointerleave="handlePointerLeave"
    ></canvas>
    <div class="peer-network-status" aria-hidden="true">
      <span class="peer-network-status-dot"></span>
      LIVE MESH · {{ nodes.length }} {{ nodes.length === 1 ? 'PEER' : 'PEERS' }}
    </div>
    <div
      v-if="tooltip.visible"
      class="peer-network-tooltip"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      <strong>{{ tooltip.short }}</strong>
      <span>{{ tooltip.peerId }}</span>
      <small>{{ tooltip.detail }}</small>
    </div>
  </div>
</template>

<script>
function hashPeerId(value) {
  const text = String(value || 'peer');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function avalancheHash(hash) {
  let mixed = hash >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function peerColorSeed(peerId) {
  const prefix = String(peerId || '').trim().slice(0, 4).toLowerCase();
  if (/^[0-9a-f]{4}$/.test(prefix)) return Number.parseInt(prefix, 16);
  return avalancheHash(hashPeerId(prefix)) & 0xffff;
}

function peerPastelColor(peerId) {
  const seed = peerColorSeed(peerId);
  // Golden-ratio spacing sends even adjacent four-character prefixes to distant
  // parts of the color wheel while keeping the visible short ID tied to color.
  const distributedHue = ((seed * 0.618033988749895) % 1) * 270;
  // The canvas background occupies the indigo/violet range. Reserve that band
  // so translucent peer circles never blend into it: [0, 215) U [305, 360).
  const hue = distributedHue < 215 ? distributedHue : distributedHue + 90;
  // Canvas renders the core at 50% opacity, so retain enough chroma here for
  // distinct hues while keeping the displayed circles soft and pastel.
  const saturation = 80 + ((seed >>> 8) % 9);
  const lightness = 59 + ((seed >>> 4) % 7);
  const normalizedHue = hue / 60;
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const secondary = chroma * (1 - Math.abs((normalizedHue % 2) - 1));
  const offset = normalizedLightness - chroma / 2;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (normalizedHue < 1) [red, green] = [chroma, secondary];
  else if (normalizedHue < 2) [red, green] = [secondary, chroma];
  else if (normalizedHue < 3) [green, blue] = [chroma, secondary];
  else if (normalizedHue < 4) [green, blue] = [secondary, chroma];
  else if (normalizedHue < 5) [red, blue] = [secondary, chroma];
  else [red, blue] = [chroma, secondary];

  const toHex = (channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0');
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
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

export default {
  name: 'PeerNetworkGraph',
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
      tooltip: {
        visible: false,
        x: 0,
        y: 0,
        short: '',
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
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
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
  beforeUnmount() {
    if (this._scene?.animationFrame) cancelAnimationFrame(this._scene.animationFrame);
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._scene = null;
    this._activity?.clear();
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

      const previousById = new Map(scene.nodes.map((node) => [node.id, node]));
      const previousIds = scene.nodeIds;
      const nextNodes = (this.nodes || [])
        .map((input) => {
          const id = String(input?.id || '').trim();
          if (!id) return null;
          const previous = previousById.get(id);
          const position = previous || normalizedPeerPosition(id, Boolean(input.isSelf));
          return {
            ...input,
            id,
            short: String(input.short || id.slice(0, 4)).toUpperCase(),
            color: peerPastelColor(id),
            bornAt: previous?.bornAt || Date.now(),
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
      const links = (this.links || [])
        .map((link) => {
          const source = String(typeof link.source === 'object' ? link.source?.id : link.source || '').trim();
          const target = String(typeof link.target === 'object' ? link.target?.id : link.target || '').trim();
          if (!source || !target || !nextIds.has(source) || !nextIds.has(target)) return null;
          return { source, target, direct: Boolean(link.direct) };
        })
        .filter(Boolean);

      scene.nodes = nextNodes;
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
      const cosY = Math.cos(scene.rotationY);
      const sinY = Math.sin(scene.rotationY);
      const tiltX = Math.sin(scene.rotationY * 0.32) * 0.11;
      const cosX = Math.cos(tiltX);
      const sinX = Math.sin(tiltX);
      const scale = Math.min(scene.width, scene.height) * 0.34;
      const centerX = scene.width / 2;
      const centerY = scene.height / 2;

      return scene.nodes.map((node) => {
        const autoX = node.x * cosY + node.z * sinY;
        const autoZ = -node.x * sinY + node.z * cosY;
        const rotatedY = node.y * cosX - autoZ * sinX;
        const rotatedZ = node.y * sinX + autoZ * cosX;
        const perspective = 3.2 / (3.2 + rotatedZ);
        const activity = this.activityStrength(node.id, now);
        const intro = Math.min(1, Math.max(0.18, (now - node.bornAt) / 520));
        // Every banner node has the same world-space radius. Perspective alone
        // changes its projected size; activity never inflates the core.
        const radius = 8 * perspective * (0.72 + intro * 0.28);

        return {
          ...node,
          activity,
          depth: rotatedZ,
          radius,
          screenX: centerX + autoX * scale * perspective,
          screenY: centerY + rotatedY * scale * perspective,
        };
      });
    },

    drawBackground(ctx, width, height) {
      const vignette = ctx.createRadialGradient(width * 0.5, height * 0.48, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
      vignette.addColorStop(0, 'rgba(255, 255, 255, 0.025)');
      vignette.addColorStop(0.58, 'rgba(26, 14, 76, 0.05)');
      vignette.addColorStop(1, 'rgba(15, 8, 48, 0.36)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    },

    drawLink(ctx, link, byId) {
      const source = byId.get(link.source);
      const target = byId.get(link.target);
      if (!source || !target) return;

      const activity = Math.max(source.activity, target.activity);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(source.screenX, source.screenY);
      ctx.lineTo(target.screenX, target.screenY);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 + activity * 0.35})`;
      ctx.lineWidth = 1;
      if (!link.direct) ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.restore();
    },

    drawNode(ctx, node) {
      const radius = Math.max(4.5, node.radius);
      // Match the banner's two-mesh treatment: a flat core plus a 1.5x
      // translucent outer circle that exists only during real peer activity.
      const glowRadius = radius * 1.5;
      const activityColor = blendTowardWhite(node.color, node.activity * 0.8);

      ctx.save();
      if (node.activity > 0) {
        ctx.globalAlpha = node.activity * 0.3;
        ctx.fillStyle = activityColor;
        ctx.beginPath();
        ctx.arc(node.screenX, node.screenY, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 0.5 + node.activity * 0.2;
      ctx.fillStyle = activityColor;
      ctx.beginPath();
      ctx.arc(node.screenX, node.screenY, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.shadowColor = 'rgba(18, 8, 52, 0.95)';
      ctx.shadowBlur = 4;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.font = '700 10px Monaco, "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(node.short, node.screenX, node.screenY + radius + 6);
      ctx.restore();
    },

    paintFrame(timestamp) {
      const scene = this._scene;
      if (!scene?.ctx || !scene.canvas?.isConnected) return;

      const elapsed = scene.lastFrameAt ? Math.min(50, timestamp - scene.lastFrameAt) : 16;
      scene.lastFrameAt = timestamp;
      if (!scene.reducedMotion) scene.rotationY += elapsed * 0.00012 * scene.rotationDirection;

      const ctx = scene.ctx;
      ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
      ctx.clearRect(0, 0, scene.width, scene.height);
      this.drawBackground(ctx, scene.width, scene.height);

      const now = Date.now();
      const projected = this.projectNodes(scene, now);
      const byId = new Map(projected.map((node) => [node.id, node]));
      for (const link of scene.links) this.drawLink(ctx, link, byId);
      projected.slice().sort((a, b) => b.depth - a.depth).forEach((node) => this.drawNode(ctx, node));

      scene.projectedNodes = projected;
      scene.animationFrame = requestAnimationFrame(scene.paint);
    },

    handlePointerMove(event) {
      const scene = this._scene;
      if (!scene?.canvas) return;
      const rect = scene.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const hovered = scene.projectedNodes
        .slice()
        .sort((a, b) => a.depth - b.depth)
        .find((node) => Math.hypot(node.screenX - x, node.screenY - y) <= Math.max(14, node.radius + 7));

      if (!hovered) {
        this.tooltip.visible = false;
        scene.canvas.style.cursor = 'default';
        return;
      }

      scene.canvas.style.cursor = 'pointer';
      this.tooltip = {
        visible: true,
        x: Math.max(12, Math.min(rect.width - 210, x + 14)),
        y: Math.max(12, Math.min(rect.height - 72, y + 14)),
        short: hovered.short,
        peerId: hovered.id,
        detail: hovered.isSelf
          ? 'This peer'
          : (hovered.isDirect
            ? (hovered.isTolerant ? 'Tolerant direct connection' : 'Direct connection')
            : 'Indirect peer'),
      };
    },

    handlePointerLeave() {
      if (this._scene) {
        if (this._scene.canvas) this._scene.canvas.style.cursor = 'default';
      }
      this.tooltip.visible = false;
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

.peer-network-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #7df9ff;
  box-shadow: 0 0 10px rgba(125, 249, 255, 0.9);
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

@media (prefers-reduced-motion: reduce) {
  .peer-network-status-dot {
    box-shadow: none;
  }
}
</style>
