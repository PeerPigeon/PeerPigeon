export const PEER_COLOR_ALGORITHM_VERSION = 8;
export const PEER_NODE_IDLE_ALPHA = 0.72;
export const SELF_NODE_IDLE_ALPHA = 0.64;
export const MIN_PEER_NODE_IDLE_ALPHA = 0.54;
const PEER_ID_PREFIX_HUE_COUNT = 256;

function hashText(value) {
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

function reverseByteBits(value) {
  let input = value & 0xff;
  let output = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    output = (output << 1) | (input & 1);
    input >>>= 1;
  }
  return output;
}

function srgbToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function rgbToOklab({ r, g, b }) {
  const red = srgbToLinear(r);
  const green = srgbToLinear(g);
  const blue = srgbToLinear(b);
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function hexToRgb(hex) {
  const value = Number.parseInt(String(hex).replace('#', ''), 16);
  return {
    r: (value >>> 16) & 0xff,
    g: (value >>> 8) & 0xff,
    b: value & 0xff,
  };
}

function blendRgb(foreground, background, alpha) {
  return {
    r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
    g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
    b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
  };
}

function relativeLuminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function colorDistanceSquared(first, second) {
  const deltaL = first.l - second.l;
  const deltaA = first.a - second.a;
  const deltaB = first.b - second.b;
  return deltaL * deltaL + deltaA * deltaA + deltaB * deltaB;
}

const GRAPH_BACKGROUND_SAMPLES = (() => {
  const start = hexToRgb('#151515');
  const end = hexToRgb('#262626');
  const vignette = hexToRgb('#000000');
  const neutralGlow = hexToRgb('#ffffff');
  const samples = [];

  // Sample the complete neutral CSS gradient, plus the strongest neutral
  // vignette and highlight overlays that can appear beneath a peer.
  for (let step = 0; step <= 16; step += 1) {
    const base = blendRgb(end, start, step / 16);
    samples.push(
      base,
      blendRgb(vignette, base, 0.42),
      blendRgb(neutralGlow, base, 0.055),
      blendRgb(neutralGlow, base, 0.035),
    );
  }
  return samples;
})();

function backgroundVisibility(rgb) {
  let minimumContrast = Number.POSITIVE_INFINITY;
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (const background of GRAPH_BACKGROUND_SAMPLES) {
    // Validate at the lowest opacity any circle may use. Stars deliberately
    // remain opaque and therefore need no separate lower-opacity allowance.
    const rendered = blendRgb(rgb, background, MIN_PEER_NODE_IDLE_ALPHA);
    minimumContrast = Math.min(minimumContrast, contrastRatio(rendered, background));
    minimumDistance = Math.min(
      minimumDistance,
      Math.sqrt(colorDistanceSquared(rgbToOklab(rendered), rgbToOklab(background))),
    );
  }
  return { minimumContrast, minimumDistance };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function hslToRgb(hue, saturation, lightness) {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hueSection = normalizedHue / 60;
  const secondary = chroma * (1 - Math.abs((hueSection % 2) - 1));
  let channels;
  if (hueSection < 1) channels = [chroma, secondary, 0];
  else if (hueSection < 2) channels = [secondary, chroma, 0];
  else if (hueSection < 3) channels = [0, chroma, secondary];
  else if (hueSection < 4) channels = [0, secondary, chroma];
  else if (hueSection < 5) channels = [secondary, 0, chroma];
  else channels = [chroma, 0, secondary];
  const offset = lightness - chroma / 2;
  return {
    r: Math.round((channels[0] + offset) * 255),
    g: Math.round((channels[1] + offset) * 255),
    b: Math.round((channels[2] + offset) * 255),
  };
}

export function assignPeerColor(peerId) {
  const canonicalId = String(peerId || 'peer');
  // Use the complete leading byte, not only its first nibble. Bit reversal
  // deliberately throws visually similar hexadecimal prefixes into distant
  // parts of the wheel (for example 1a/ef and f9/f4). This also gives all 256
  // displayed two-character prefixes their own deterministic hue.
  const prefixText = canonicalId.slice(0, 2);
  const parsedPrefix = /^[0-9a-f]{2}$/i.test(prefixText)
    ? Number.parseInt(prefixText, 16)
    : avalancheHash(hashText(canonicalId)) & 0xff;
  const prefixIndex = reverseByteBits(parsedPrefix);
  const variation = avalancheHash(hashText(`${canonicalId}\u0000peer-color-variation`));
  const hue = prefixIndex * (360 / PEER_ID_PREFIX_HUE_COUNT);
  // The neutral graph canvas supports the complete pastel wheel. Keep enough
  // saturation to distinguish neighboring prefix families, with high stable
  // lightness so low-opacity distant circles remain visible.
  const saturation = 0.66 + ((variation >>> 16) & 0xff) / 2550;
  const lightness = 0.68 + ((variation >>> 24) & 0xff) / 3187.5;
  return rgbToHex(hslToRgb(hue, saturation, lightness));
}

export function peerColorDistance(first, second) {
  return Math.sqrt(colorDistanceSquared(
    rgbToOklab(hexToRgb(first)),
    rgbToOklab(hexToRgb(second)),
  ));
}

export function peerColorBackgroundVisibility(color) {
  return backgroundVisibility(hexToRgb(color));
}
