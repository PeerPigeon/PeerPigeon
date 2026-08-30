import { sha256 } from 'unsea';

export const KADEMLIA_ID_BITS = 256;
export const KADEMLIA_ID_HEX_LENGTH = KADEMLIA_ID_BITS / 4;
export const DEFAULT_K_BUCKET_SIZE = 20;
export const DEFAULT_LOOKUP_ALPHA = 3;
export const DEFAULT_REPLICATION_FACTOR = 5;

const NODE_ID_RE = /^[0-9a-f]{64}$/;

export function isNodeId(value) {
  return typeof value === 'string' && NODE_ID_RE.test(value);
}

function encodeCanonical(value, seen) {
  if (value === null) return 'null';

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return JSON.stringify(value);
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON only supports finite numbers');
    return JSON.stringify(value);
  }
  if (type !== 'object') throw new TypeError(`Canonical JSON does not support ${type}`);
  if (seen.has(value)) throw new TypeError('Canonical JSON does not support circular values');

  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => encodeCanonical(item, seen)).join(',')}]`;
  } else {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encodeCanonical(value[key], seen)}`);
    result = `{${entries.join(',')}}`;
  }
  seen.delete(value);
  return result;
}

/** Stable JSON encoding used for signatures and routing-key derivation. */
export function canonicalJson(value) {
  return encodeCanonical(value, new Set());
}

export async function relayNodeId(publicKey) {
  if (typeof publicKey !== 'string' || !publicKey) {
    throw new TypeError('Relay public key is required');
  }
  return sha256(canonicalJson(['freertc-kad', 1, 'relay', publicKey]));
}

export async function scopeRoutingKey(network, room) {
  return sha256(canonicalJson(['freertc-kad', 1, 'scope', network, room]));
}

export async function peerRoutingKey(network, room, peerId) {
  return sha256(canonicalJson(['freertc-kad', 1, 'peer', network, room, peerId]));
}

/**
 * Return the Kademlia bucket number for another node. Bucket zero contains
 * XOR distances [1, 2); bucket 255 contains distances [2^255, 2^256).
 */
export function bucketIndex(selfId, otherId) {
  if (!isNodeId(selfId) || !isNodeId(otherId)) throw new TypeError('Kademlia IDs must be 64 lowercase hex characters');
  for (let index = 0; index < KADEMLIA_ID_HEX_LENGTH; index += 1) {
    const xorNibble = Number.parseInt(selfId[index], 16) ^ Number.parseInt(otherId[index], 16);
    if (xorNibble !== 0) {
      return ((KADEMLIA_ID_HEX_LENGTH - index - 1) * 4) + Math.floor(Math.log2(xorNibble));
    }
  }
  return -1;
}

export function xorDistanceHex(leftId, rightId) {
  if (!isNodeId(leftId) || !isNodeId(rightId)) throw new TypeError('Kademlia IDs must be 64 lowercase hex characters');
  let result = '';
  for (let index = 0; index < KADEMLIA_ID_HEX_LENGTH; index += 1) {
    result += (Number.parseInt(leftId[index], 16) ^ Number.parseInt(rightId[index], 16)).toString(16);
  }
  return result;
}

/** Sort signed node records by XOR distance without relying on BigInt. */
export function selectClosestNodes(nodes, targetId, limit = DEFAULT_K_BUCKET_SIZE) {
  if (!isNodeId(targetId)) throw new TypeError('Kademlia target must be a 64-character lowercase hex ID');
  const unique = new Map();
  for (const node of nodes || []) {
    if (!node || !isNodeId(node.node_id)) continue;
    unique.set(node.node_id, node);
  }
  return Array.from(unique.values())
    .map((node) => ({ node, distance: xorDistanceHex(node.node_id, targetId) }))
    .sort((left, right) => {
      if (left.distance !== right.distance) return left.distance < right.distance ? -1 : 1;
      return left.node.node_id < right.node.node_id ? -1 : left.node.node_id > right.node.node_id ? 1 : 0;
    })
    .slice(0, Math.max(0, limit))
    .map(({ node }) => node);
}

/** Keep at most k most-recently-seen contacts in each XOR-distance bucket. */
export function compactRoutingTable(selfId, nodes, k = DEFAULT_K_BUCKET_SIZE) {
  const buckets = Array.from({ length: KADEMLIA_ID_BITS }, () => []);
  for (const node of nodes || []) {
    if (!node || node.node_id === selfId || !isNodeId(node.node_id)) continue;
    const index = bucketIndex(selfId, node.node_id);
    if (index >= 0) buckets[index].push(node);
  }
  return buckets.flatMap((bucket) => bucket
    .sort((left, right) => Number(right.last_seen_ms || 0) - Number(left.last_seen_ms || 0))
    .slice(0, Math.max(1, k)));
}

/** Prefer healthy providers while keeping the result deterministic. */
export function rankProviderRecords(records, limit = DEFAULT_REPLICATION_FACTOR) {
  const unique = new Map();
  for (const record of records || []) {
    if (!record?.node_id || !record?.url) continue;
    const key = `${record.kind}:${record.node_id}`;
    const previous = unique.get(key);
    if (!previous || Number(record.sequence || 0) > Number(previous.sequence || 0)) unique.set(key, record);
  }
  return Array.from(unique.values())
    .sort((left, right) => {
      const leftCapacity = Math.max(1, Number(left.capacity || 1));
      const rightCapacity = Math.max(1, Number(right.capacity || 1));
      const loadDifference = (Number(left.connections || 0) / leftCapacity) - (Number(right.connections || 0) / rightCapacity);
      return loadDifference || left.node_id.localeCompare(right.node_id);
    })
    .slice(0, Math.max(0, limit));
}
