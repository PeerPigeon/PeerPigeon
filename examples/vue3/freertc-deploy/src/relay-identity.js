import { signMessage, verifyMessage } from 'unsea';
import { canonicalJson, isNodeId, relayNodeId } from './kademlia.js';

export const RELAY_NODE_RECORD_KIND = 'relay-node';
export const SCOPE_PROVIDER_RECORD_KIND = 'scope-provider';
export const PEER_PROVIDER_RECORD_KIND = 'peer-provider';
export const PROVIDER_RECORD_KINDS = new Set([SCOPE_PROVIDER_RECORD_KIND, PEER_PROVIDER_RECORD_KIND]);

const RECORD_VERSION = 1;
const MAX_CLOCK_SKEW_MS = 60_000;
const MAX_NODE_RECORD_TTL_MS = 10 * 60_000;
const MAX_PROVIDER_RECORD_TTL_MS = 2 * 60_000;
const IDENTITY_SECRET_VERSION = 1;

export function encodeRelayIdentitySecret(publicKey, privateKey) {
  if (typeof publicKey !== 'string' || !publicKey || typeof privateKey !== 'string' || !privateKey) {
    throw new TypeError('Both relay signing keys are required');
  }
  return JSON.stringify({ v: IDENTITY_SECRET_VERSION, pub: publicKey, priv: privateKey });
}

export function decodeRelayIdentitySecret(value) {
  if (typeof value !== 'string' || !value) throw new TypeError('Relay identity secret is required');
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError('Relay identity secret must be valid JSON');
  }
  if (parsed?.v !== IDENTITY_SECRET_VERSION || typeof parsed.pub !== 'string' || typeof parsed.priv !== 'string') {
    throw new TypeError('Relay identity secret has an unsupported format');
  }
  return { publicKey: parsed.pub, privateKey: parsed.priv };
}

function unsignedRecord(record) {
  const { signature: _signature, ...payload } = record;
  return payload;
}

function normalizeRelayUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Relay URL is required');
  const url = new URL(value.trim());
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new TypeError('Relay URL must use ws:// or wss://');
  url.hash = '';
  url.search = '';
  url.pathname = '/ws';
  return url.toString();
}

async function signRecord(payload, privateKey) {
  return { ...payload, signature: await signMessage(canonicalJson(payload), privateKey) };
}

export async function createRelayIdentity(publicKey, privateKey) {
  if (typeof publicKey !== 'string' || !publicKey || typeof privateKey !== 'string' || !privateKey) {
    throw new TypeError('Both relay signing keys are required');
  }
  const challenge = canonicalJson(['freertc-kad', 1, 'key-check', publicKey]);
  const signature = await signMessage(challenge, privateKey);
  if (!await verifyMessage(challenge, signature, publicKey)) {
    throw new Error('Relay signing public and private keys do not match');
  }
  return { publicKey, privateKey, nodeId: await relayNodeId(publicKey) };
}

export async function createSignedNodeRecord(identity, options) {
  const now = Number(options.now ?? Date.now());
  const ttlMs = Math.min(MAX_NODE_RECORD_TTL_MS, Math.max(30_000, Number(options.ttlMs ?? 5 * 60_000)));
  return signRecord({
    version: RECORD_VERSION,
    kind: RELAY_NODE_RECORD_KIND,
    node_id: identity.nodeId,
    public_key: identity.publicKey,
    url: normalizeRelayUrl(options.url),
    name: typeof options.name === 'string' && options.name ? options.name.slice(0, 128) : null,
    connections: Math.max(0, Number(options.connections || 0)),
    capacity: Math.max(1, Number(options.capacity || 10_000)),
    issued_at_ms: now,
    expires_at_ms: now + ttlMs,
  }, identity.privateKey);
}

export async function createSignedProviderRecord(identity, options) {
  if (!PROVIDER_RECORD_KINDS.has(options.kind)) throw new TypeError('Unsupported provider record kind');
  if (!isNodeId(options.key)) throw new TypeError('Provider routing key must be a Kademlia ID');
  const now = Number(options.now ?? Date.now());
  const ttlMs = Math.min(MAX_PROVIDER_RECORD_TTL_MS, Math.max(15_000, Number(options.ttlMs ?? 45_000)));
  return signRecord({
    version: RECORD_VERSION,
    kind: options.kind,
    key: options.key,
    node_id: identity.nodeId,
    public_key: identity.publicKey,
    url: normalizeRelayUrl(options.url),
    connections: Math.max(0, Number(options.connections || 0)),
    capacity: Math.max(1, Number(options.capacity || 10_000)),
    sequence: Math.max(now, Number(options.sequence || 0)),
    issued_at_ms: now,
    expires_at_ms: now + ttlMs,
  }, identity.privateKey);
}

export async function verifySignedRelayRecord(record, options = {}) {
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
    if (record.version !== RECORD_VERSION || !isNodeId(record.node_id)) return false;
    if (typeof record.public_key !== 'string' || typeof record.signature !== 'string') return false;
    if (await relayNodeId(record.public_key) !== record.node_id) return false;

    const allowedKinds = options.allowedKinds || new Set([
      RELAY_NODE_RECORD_KIND,
      SCOPE_PROVIDER_RECORD_KIND,
      PEER_PROVIDER_RECORD_KIND,
    ]);
    if (!allowedKinds.has(record.kind)) return false;

    const now = Number(options.now ?? Date.now());
    const issuedAt = Number(record.issued_at_ms);
    const expiresAt = Number(record.expires_at_ms);
    const maxTtl = record.kind === RELAY_NODE_RECORD_KIND ? MAX_NODE_RECORD_TTL_MS : MAX_PROVIDER_RECORD_TTL_MS;
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return false;
    if (issuedAt > now + MAX_CLOCK_SKEW_MS || expiresAt <= now || expiresAt - issuedAt > maxTtl) return false;
    if (normalizeRelayUrl(record.url) !== record.url) return false;
    if (record.kind !== RELAY_NODE_RECORD_KIND && !isNodeId(record.key)) return false;

    return await verifyMessage(canonicalJson(unsignedRecord(record)), record.signature, record.public_key);
  } catch {
    return false;
  }
}
