import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignPeerColor,
  peerColorBackgroundVisibility,
  peerColorDistance,
} from '../examples/vue3/src/peer-color.js';

function reverseByteBits(value) {
  let input = value & 0xff;
  let output = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    output = (output << 1) | (input & 1);
    input >>>= 1;
  }
  return output;
}

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

test('all 256 two-character prefixes own deterministic bit-spread hues', () => {
  const hues = Array.from({ length: 256 }, (_, prefix) => {
    const prefixText = prefix.toString(16).padStart(2, '0');
    return hueOf(assignPeerColor(`${prefixText}${'0123456789abcdef'.repeat(4).slice(2)}`));
  });

  hues.forEach((hue, prefix) => {
    const expected = reverseByteBits(prefix) * (360 / 256);
    assert.ok(
      circularHueDistance(hue, expected) <= 0.75,
      `${prefix.toString(16).padStart(2, '0')} escaped its hue`,
    );
  });
});

test('reported lookalike peer prefixes are visibly separated', () => {
  const suffix = '0123456789abcdef'.repeat(4).slice(2);
  for (const [first, second] of [['1a', 'ef'], ['f9', 'f4']]) {
    const firstColor = assignPeerColor(`${first}${suffix}`);
    const secondColor = assignPeerColor(`${second}${suffix}`);
    assert.ok(
      circularHueDistance(hueOf(firstColor), hueOf(secondColor)) >= 100,
      `${first} ${firstColor} and ${second} ${secondColor} still share a hue family`,
    );
    assert.ok(
      peerColorDistance(firstColor, secondColor) >= 0.2,
      `${first} ${firstColor} and ${second} ${secondColor} remain perceptually similar`,
    );
  }
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
