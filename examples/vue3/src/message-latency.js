import { sha1Hex } from '../../../src/sha1.ts';

export function messagePeerSha1(value) {
  const peerId = String(value ?? '').trim();
  if (!peerId) return '';
  return /^[0-9a-f]{40}$/i.test(peerId) ? peerId.toLowerCase() : sha1Hex(peerId);
}

export function formatMessagePeerId(value, length = 6) {
  const digest = messagePeerSha1(value);
  const size = Math.max(1, Math.min(40, Math.floor(Number(length) || 6)));
  return digest.slice(0, size);
}

export function calculateMessageLatency(sentAt, receivedAt = Date.now()) {
  const sent = Number(sentAt);
  const received = Number(receivedAt);
  if (!Number.isFinite(sent) || sent <= 0 || !Number.isFinite(received) || received <= 0) return null;
  return Math.max(0, Math.round(received - sent));
}

export function formatMessageLatency(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  const roundedMs = Math.round(milliseconds);
  if (roundedMs < 1_000) return `${roundedMs}ms`;
  if (roundedMs < 60_000) {
    const seconds = Math.round(roundedMs / 100) / 10;
    return `${seconds}s`;
  }
  const minutes = Math.floor(roundedMs / 60_000);
  const seconds = Math.round((roundedMs % 60_000) / 1_000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function formatHopLatency(hops, latencyMs) {
  const count = Math.max(0, Math.floor(Number(hops) || 0));
  const hopText = count === 1 ? '1 hop' : `${count} hops`;
  const latencyText = formatMessageLatency(latencyMs);
  return latencyText ? `${hopText}, ${latencyText}` : hopText;
}

export function formatHopTrace(path, hops) {
  const peerIds = Array.isArray(path)
    ? path.filter((peerId) => typeof peerId === 'string' && peerId.length > 0)
    : [];
  if (peerIds.length === 0) return '';
  const labels = peerIds.map((peerId) => formatMessagePeerId(peerId));
  const expectedPeerCount = Math.max(labels.length, Math.floor(Number(hops) || 0) + 1);
  const omitted = expectedPeerCount - labels.length;
  if (omitted > 0 && labels.length > 1) {
    labels.splice(1, 0, `… ${omitted} omitted …`);
  }
  return `Route: ${labels.join(' → ')}`;
}
