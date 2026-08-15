export function canonicalPeerId(value) {
  return String(value ?? '').trim();
}

export function formatPeerId(value) {
  const peerId = canonicalPeerId(value);
  return peerId.slice(0, 4);
}
