import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignPeerColor,
  peerColorBackgroundVisibility,
} from '../examples/vue3/src/peer-color.js';

const PREFIX_HUES = [
  0, 180, 90, 270,
  45, 225, 135, 315,
  22.5, 202.5, 112.5, 337.5,
  67.5, 247.5, 157.5, 292.5,
];

function hueOf(color) {
  const value = Number.parseInt(color.slice(1), 16);
  const channels = [
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].map((channel) => channel / 255);
  const maximum = Math.max(...channels);
  const minimum = Math.min(...channels);
  const chroma = maximum - minimum;
  if (chroma === 0) return 0;
  let hue;
  if (maximum === channels[0]) hue = ((channels[1] - channels[2]) / chroma) % 6;
  else if (maximum === channels[1]) hue = (channels[2] - channels[0]) / chroma + 2;
  else hue = (channels[0] - channels[1]) / chroma + 4;
  return ((hue * 60) + 360) % 360;
}

function saturationAndLightnessOf(color) {
  const value = Number.parseInt(color.slice(1), 16);
  const channels = [
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].map((channel) => channel / 255);
  const maximum = Math.max(...channels);
  const minimum = Math.min(...channels);
  const lightness = (maximum + minimum) / 2;
  const chroma = maximum - minimum;
  const saturation = chroma === 0
    ? 0
    : chroma / (1 - Math.abs(2 * lightness - 1));
  return { saturation, lightness };
}

function circularHueDistance(first, second) {
  const direct = Math.abs(first - second);
  return Math.min(direct, 360 - direct);
}

test('0-F prefixes own 16 distinct, non-overlapping hue sectors', () => {
  const used = [...'0123456789abcdef'].map((prefix) => {
    const peerId = `${prefix}${'0123456789abcdef'.repeat(4).slice(1)}`;
    return assignPeerColor(peerId);
  });

  assert.equal(new Set(used).size, 16);
  const hues = used.map(hueOf);
  hues.forEach((hue, index) => {
    const expected = PREFIX_HUES[index];
    assert.ok(
      circularHueDistance(hue, expected) <= 0.5,
      `${used[index]} escaped prefix ${index.toString(16).toUpperCase()}'s hue sector`,
    );
  });
  for (let left = 0; left < used.length; left += 1) {
    for (let right = left + 1; right < used.length; right += 1) {
      assert.ok(
        circularHueDistance(hues[left], hues[right]) >= 15,
        `${used[left]} and ${used[right]} share a hue sector`,
      );
    }
  }
  assert.ok(
    Math.abs(circularHueDistance(hues[0xa], hues[0xf]) - 180) <= 0.5,
    'A and F must remain opposite on the color wheel',
  );
});

test('every prefix color remains visibly separated from the neutral graph background', () => {
  for (const prefix of '0123456789abcdef') {
    const color = assignPeerColor(`${prefix}${'89abcdef01234567'.repeat(4).slice(1)}`);
    const visibility = peerColorBackgroundVisibility(color);
    assert.ok(
      visibility.minimumDistance >= 0.14,
      `${prefix.toUpperCase()} color ${color} is too close to the graph background`,
    );
  }
});

test('every prefix family renders as a visible pastel', () => {
  for (const prefix of '0123456789abcdef') {
    const color = assignPeerColor(`${prefix}${'0123456789abcdef'.repeat(4).slice(1)}`);
    const { saturation, lightness } = saturationAndLightnessOf(color);
    assert.ok(saturation >= 0.64 && saturation <= 0.78, `${color} is not pastel saturation`);
    assert.ok(lightness >= 0.67 && lightness <= 0.77, `${color} is not pastel lightness`);
  }
});

test('graph-gradient colors are rejected as peer colors', () => {
  for (const color of ['#151515', '#1e1e1e', '#262626']) {
    const visibility = peerColorBackgroundVisibility(color);
    assert.ok(
      visibility.minimumDistance < 0.16,
      `${color} should conflict with the graph background`,
    );
  }
});

test('different self IDs do not converge on the same first color', () => {
  const colors = [...'0123456789abcdef'].map((prefix) => assignPeerColor(
    `${prefix}${'fedcba9876543210'.repeat(4).slice(1)}`,
    [],
  ));
  assert.equal(new Set(colors).size, colors.length);
});

test('peer color depends only on peer ID, never graph membership or assignment order', () => {
  const peerId = 'f234567890abcdef'.repeat(4);
  const expected = assignPeerColor(peerId);
  assert.equal(assignPeerColor(peerId, []), expected);
  assert.equal(assignPeerColor(peerId, ['#ff0000', '#00ff00', '#0000ff']), expected);
});
