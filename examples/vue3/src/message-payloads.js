const USER_VISIBLE_PP_TYPES = new Set([
  'pp-encrypted-broadcast-v1',
  'pp-encrypted-direct-v1',
]);

/**
 * Normalize payloads from mixed runtime versions, some of which may wrap a
 * structured payload in one extra JSON string.
 */
export function normalizeMessagePayload(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

/**
 * Protocol-reserved payloads are never user chat. New internal pp-* message
 * types default to hidden unless explicitly listed as user-visible transport.
 */
export function isInternalMessagePayload(value) {
  const payload = normalizeMessagePayload(value);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;

  const peerPigeonType = String(payload.__peerPigeonType || '').trim();
  if (peerPigeonType) return true;

  const ppType = String(payload.__ppType || '').trim();
  return ppType.startsWith('pp-') && !USER_VISIBLE_PP_TYPES.has(ppType);
}

/** Hide control envelopes that an older runtime may already have logged. */
export function isInternalChatText(value) {
  const text = String(value || '').trim();
  const payloadText = text.startsWith('[DM]') ? text.slice(4).trim() : text;
  return isInternalMessagePayload(payloadText);
}
