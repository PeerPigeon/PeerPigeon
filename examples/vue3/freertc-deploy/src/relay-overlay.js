import {
  DEFAULT_K_BUCKET_SIZE,
  DEFAULT_LOOKUP_ALPHA,
  DEFAULT_REPLICATION_FACTOR,
  bucketIndex,
  isNodeId,
  rankProviderRecords,
  scopeRoutingKey,
  selectClosestNodes,
} from './kademlia.js';
import {
  PROVIDER_RECORD_KINDS,
  RELAY_NODE_RECORD_KIND,
  SCOPE_PROVIDER_RECORD_KIND,
  createRelayIdentity,
  createSignedNodeRecord,
  createSignedProviderRecord,
  decodeRelayIdentitySecret,
  verifySignedRelayRecord,
} from './relay-identity.js';

const MAX_ROUTING_CONTACTS = 256 * DEFAULT_K_BUCKET_SIZE;
const MAX_LOOKUP_QUERIES = 24;
const MAX_LOOKUP_RECORDS = 64;
const MAX_PROVIDER_RELAYS = 8;
const MAX_RPC_BODY_BYTES = 128 * 1024;
const RPC_TIMEOUT_MS = 3_000;
// How long a completed bootstrap join is trusted. Every join is a fan-out of
// find RPCs and a database write per contact heard, and the cache is per
// isolate, so a short interval multiplies across every isolate the platform
// starts. Node records live five minutes by default; rejoining at under half
// that keeps this relay announced to its bootstraps without churning them.
const BOOTSTRAP_REFRESH_INTERVAL_MS = 120_000;
// A relay announces that it serves a room, once a minute at most however many peers it holds
// there. The record lives two minutes, the longest any relay accepts, so one missed
// publication does not lapse it. Both are per relay and room, never per peer: a record per
// peer republished on every peer's heartbeat made the overlay's work grow with the peers.
const PROVIDER_PUBLISH_INTERVAL_MS = 60_000;
const PROVIDER_RECORD_TTL_MS = 120_000;
const MAX_RECENT_PROVIDER_PUBLISHES = 20_000;
const PEER_PROVIDER_LOOKUP_CACHE_MS = 5_000;
const MAX_RECENT_PEER_PROVIDER_LOOKUPS = 2_000;
// A shared pending promise must never park every caller forever. A join or a
// lookup started on behalf of one socket can be abandoned by the platform when
// that socket's request ends; whoever awaits it next would otherwise hang,
// and every relay operation funnels through these two waits.
const SHARED_WAIT_TIMEOUT_MS = 6_000;

function withTimeout(promise, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

const identityPromises = new WeakMap();
const joinPromises = new WeakMap();
const recentBootstrapJoins = new WeakMap();
const recentProviderPublishes = new Map();
const recentPeerProviderLookups = new Map();

function rememberPeerProviderLookup(key, entry) {
  recentPeerProviderLookups.delete(key);
  recentPeerProviderLookups.set(key, entry);
  while (recentPeerProviderLookups.size > MAX_RECENT_PEER_PROVIDER_LOOKUPS) {
    recentPeerProviderLookups.delete(recentPeerProviderLookups.keys().next().value);
  }
}

function markProviderPublish(key, now) {
  const previous = Number(recentProviderPublishes.get(key) || 0);
  if (now - previous < PROVIDER_PUBLISH_INTERVAL_MS) return false;

  recentProviderPublishes.delete(key);
  recentProviderPublishes.set(key, now);
  while (recentProviderPublishes.size > MAX_RECENT_PROVIDER_PUBLISHES) {
    recentProviderPublishes.delete(recentProviderPublishes.keys().next().value);
  }
  return true;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function relayHttpBase(relayUrl) {
  return relayUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/ws$/, '');
}

export function configuredBootstrapUrls(env) {
  const values = [
    ...(typeof env.KADEMLIA_BOOTSTRAP_URLS === 'string' ? env.KADEMLIA_BOOTSTRAP_URLS.split(',') : []),
    env.GLOBAL_RELAY_URL,
  ];
  const urls = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    let normalized = value.trim().replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    if (!normalized.endsWith('/ws')) normalized = `${normalized.replace(/\/$/, '')}/ws`;
    urls.add(normalized);
  }
  return Array.from(urls);
}

export function isKademliaEnabled(env) {
  return Boolean(env?.DB && (
    env?.RELAY_IDENTITY_SECRET ||
    (env?.RELAY_SIGNING_PUBLIC_KEY && env?.RELAY_SIGNING_PRIVATE_KEY)
  ));
}

async function configuredIdentity(env) {
  if (env?.RELAY_IDENTITY_SECRET) {
    const identity = decodeRelayIdentitySecret(env.RELAY_IDENTITY_SECRET);
    if (!identityPromises.has(env)) {
      identityPromises.set(env, createRelayIdentity(identity.publicKey, identity.privateKey));
    }
    return identityPromises.get(env);
  }

  const publicKey = env?.RELAY_SIGNING_PUBLIC_KEY;
  const privateKey = env?.RELAY_SIGNING_PRIVATE_KEY;
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey) throw new Error('Both RELAY_SIGNING_PUBLIC_KEY and RELAY_SIGNING_PRIVATE_KEY are required');

  if (!identityPromises.has(env)) {
    identityPromises.set(env, createRelayIdentity(publicKey, privateKey));
  }
  return identityPromises.get(env);
}

async function overlayContext(env, selfUrl, options = {}) {
  if (!env?.DB || !selfUrl || !isKademliaEnabled(env)) return null;
  const identity = await configuredIdentity(env);
  if (!identity) return null;
  const nodeRecord = await createSignedNodeRecord(identity, {
    url: selfUrl,
    name: env.RELAY_NAME || null,
    connections: options.connections || 0,
    capacity: Number(env.RELAY_CAPACITY || 10_000),
  });
  return { env, db: env.DB, identity, nodeRecord, selfUrl: nodeRecord.url };
}

async function cleanupExpiredOverlay(context) {
  const now = Date.now();
  await Promise.all([
    context.db.prepare('DELETE FROM psp_kad_nodes WHERE expires_at_ms <= ?1').bind(now).run(),
    context.db.prepare('DELETE FROM psp_kad_records WHERE expires_at_ms <= ?1').bind(now).run(),
  ]);
}

async function upsertNodeRecord(context, record) {
  if (record.node_id === context.identity.nodeId) return;
  const index = bucketIndex(context.identity.nodeId, record.node_id);
  const now = Date.now();
  // Every RPC carries a freshly signed requester record, so an unconditional
  // upsert rewrites a row (and both of its indexes) on every message from a
  // contact already known. Rewrite only when the contact is new, has moved, or
  // its stored record has less than half of its lifetime left: rows are still
  // renewed well before they expire, but a busy contact costs one write per
  // half-life instead of one per message. A skipped write changes no rows.
  const written = await context.db.prepare(`
    INSERT INTO psp_kad_nodes
      (node_id, bucket_index, url, record_json, expires_at_ms, last_seen_ms)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(node_id) DO UPDATE SET
      bucket_index = excluded.bucket_index,
      url = excluded.url,
      record_json = excluded.record_json,
      expires_at_ms = excluded.expires_at_ms,
      last_seen_ms = excluded.last_seen_ms
    WHERE psp_kad_nodes.url != excluded.url
      OR (psp_kad_nodes.expires_at_ms - excluded.last_seen_ms) * 2
         <= (excluded.expires_at_ms - excluded.last_seen_ms)
  `).bind(
    record.node_id,
    index,
    record.url,
    JSON.stringify(record),
    record.expires_at_ms,
    now,
  ).run();
  // Nothing was inserted or renewed, so no bucket can have grown past k.
  if (written?.meta?.changes === 0) return;

  await context.db.prepare(`
    DELETE FROM psp_kad_nodes
    WHERE node_id IN (
      SELECT node_id FROM psp_kad_nodes
      WHERE bucket_index = ?1
      ORDER BY last_seen_ms DESC, node_id ASC
      LIMIT -1 OFFSET ?2
    )
  `).bind(index, DEFAULT_K_BUCKET_SIZE).run();
}

// A record read back from the table carries the row's last_seen_ms beside
// the signed fields. That column is bookkeeping, not part of what the relay
// signed, so it is dropped before the signature is checked. Relays already
// deployed still serve their contacts with it attached; without this a new
// relay rejected every second-hand contact those relays offered and only
// ever knew the relays it had spoken to itself.
function signedNodeRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const { last_seen_ms: _lastSeen, ...signed } = record;
  return signed;
}

async function acceptNodeRecord(context, record) {
  const signed = signedNodeRecord(record);
  const valid = await verifySignedRelayRecord(signed, { allowedKinds: new Set([RELAY_NODE_RECORD_KIND]) });
  if (!valid) return false;
  await upsertNodeRecord(context, signed);
  return true;
}

async function listActiveNodeRecords(context) {
  const result = await context.db.prepare(`
    SELECT record_json, last_seen_ms
    FROM psp_kad_nodes
    WHERE expires_at_ms > ?1
    ORDER BY last_seen_ms DESC
    LIMIT ?2
  `).bind(Date.now(), MAX_ROUTING_CONTACTS).all();

  const nodes = [];
  for (const row of result.results || []) {
    try {
      const record = JSON.parse(row.record_json);
      if (isNodeId(record.node_id)) nodes.push({ ...record, last_seen_ms: row.last_seen_ms });
    } catch {}
  }
  return nodes;
}

async function storeProviderRecord(context, record) {
  const valid = await verifySignedRelayRecord(record, { allowedKinds: PROVIDER_RECORD_KINDS });
  if (!valid) return false;
  await context.db.prepare(`
    INSERT INTO psp_kad_records
      (routing_key, owner_node_id, kind, sequence, record_json, expires_at_ms)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(routing_key, owner_node_id, kind) DO UPDATE SET
      sequence = excluded.sequence,
      record_json = excluded.record_json,
      expires_at_ms = excluded.expires_at_ms
    WHERE excluded.sequence > psp_kad_records.sequence
  `).bind(
    record.key,
    record.node_id,
    record.kind,
    record.sequence,
    JSON.stringify(record),
    record.expires_at_ms,
  ).run();
  return true;
}

async function findLocalProviderRecords(context, routingKey) {
  const result = await context.db.prepare(`
    SELECT record_json
    FROM psp_kad_records
    WHERE routing_key = ?1 AND expires_at_ms > ?2
    ORDER BY sequence DESC
    LIMIT ?3
  `).bind(routingKey, Date.now(), MAX_LOOKUP_RECORDS).all();
  const records = [];
  for (const row of result.results || []) {
    try {
      const record = JSON.parse(row.record_json);
      if (record.key === routingKey) records.push(record);
    } catch {}
  }
  return records;
}

async function postRpc(relayUrl, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await fetch(`${relayHttpBase(relayUrl)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const responseBody = await response.text();
    if (responseBody.length > MAX_RPC_BODY_BYTES) return null;
    return JSON.parse(responseBody);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function acceptLookupResponse(context, response, targetId, records, knownNodeIds = null) {
  if (!response?.ok) return [];
  const responseNodes = Array.isArray(response.nodes) ? response.nodes : [];
  const uniqueNodes = Array.from(new Map(
    [response.node, ...responseNodes]
      .filter((node) => typeof node?.node_id === 'string')
      // Another relay's table holds this relay too; a lookup never adds
      // itself to its own shortlist.
      .filter((node) => node.node_id !== context.identity.nodeId)
      .filter((node) => !knownNodeIds?.has(node.node_id))
      .map((node) => [node.node_id, node]),
  ).values());
  const acceptedNodes = await Promise.all(uniqueNodes.map(async (node) => (
    await acceptNodeRecord(context, node) ? node : null
  )));

  const responseRecords = Array.isArray(response.records) ? response.records : [];
  const acceptedRecords = await Promise.all(responseRecords.map(async (record) => {
    if (record?.key !== targetId || !await storeProviderRecord(context, record)) return null;
    return record;
  }));
  for (const record of acceptedRecords) {
    if (record) records.set(`${record.kind}:${record.node_id}`, record);
  }
  return acceptedNodes.filter(Boolean);
}

async function iterativeLookup(context, targetId, wantRecords = false) {
  const known = new Map();
  const queried = new Set();
  const records = new Map();
  for (const node of await listActiveNodeRecords(context)) known.set(node.node_id, node);

  let queryCount = 0;
  while (queryCount < MAX_LOOKUP_QUERIES) {
    const shortlist = selectClosestNodes(Array.from(known.values()), targetId, DEFAULT_K_BUCKET_SIZE * 2);
    const remainingQueries = MAX_LOOKUP_QUERIES - queryCount;
    const batch = shortlist
      .filter((node) => !queried.has(node.node_id))
      .slice(0, Math.min(DEFAULT_LOOKUP_ALPHA, remainingQueries));
    if (batch.length === 0) break;
    for (const node of batch) queried.add(node.node_id);
    queryCount += batch.length;

    const responses = await Promise.all(batch.map((node) => postRpc(node.url, '/api/v1/kad/find', {
      target: targetId,
      want_records: wantRecords,
      requester: context.nodeRecord,
    })));
    const knownNodeIds = new Set(known.keys());
    const receivedGroups = await Promise.all(
      responses.map((response) => acceptLookupResponse(
        context,
        response,
        targetId,
        records,
        knownNodeIds,
      )),
    );
    for (const received of receivedGroups) {
      for (const node of received) known.set(node.node_id, node);
    }
  }

  if (wantRecords) {
    for (const record of await findLocalProviderRecords(context, targetId)) {
      if (await verifySignedRelayRecord(record, { allowedKinds: PROVIDER_RECORD_KINDS })) {
        records.set(`${record.kind}:${record.node_id}`, record);
      }
    }
  }

  return {
    nodes: selectClosestNodes(Array.from(known.values()), targetId, DEFAULT_K_BUCKET_SIZE),
    records: Array.from(records.values()),
    queries: queryCount,
  };
}

/** The urls in a random order, so no one seed is every relay's first stop. */
function shuffled(urls) {
  const out = [...urls];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The relays closest to this one among those it has heard of: where to join when no seed answers. */
async function learnedBootstrapUrls(context, exclude) {
  const known = await listActiveNodeRecords(context);
  return selectClosestNodes(known, context.identity.nodeId, DEFAULT_K_BUCKET_SIZE)
    .map((node) => node.url)
    .filter((url) => typeof url === 'string' && url && !exclude.has(url) && url !== context.selfUrl);
}

// The standard Kademlia join. No relay is the hub: any relay can be a seed, and a seed answers
// with the relays closest to the joiner's own id, which is how a new relay is directed to the
// ones near it. So one seed is asked, in random order, and the first to answer is enough;
// asking every seed and every relay ever heard of at once was a fan-out that grew with the
// network and that every receiver wrote down. Relays learned from earlier answers are only
// tried when every configured seed is unreachable, so a relay still rejoins through its
// neighbours when the seeds are down.
async function joinBootstrap(context) {
  const seeds = shuffled(configuredBootstrapUrls(context.env).filter((url) => url !== context.selfUrl));
  const tried = [];
  const records = new Map();
  const askOneOf = async (urls) => {
    for (const url of urls) {
      tried.push(url);
      const response = await postRpc(url, '/api/v1/kad/find', {
        target: context.identity.nodeId,
        want_records: false,
        requester: context.nodeRecord,
      });
      if (response?.ok) {
        await acceptLookupResponse(context, response, context.identity.nodeId, records);
        return true;
      }
    }
    return false;
  };
  const joined = await askOneOf(seeds) || await askOneOf(await learnedBootstrapUrls(context, new Set(seeds)));
  return { bootstrapUrls: tried, joined: joined ? 1 : 0 };
}

async function ensureRoutingContacts(context) {
  const bootstrapKey = configuredBootstrapUrls(context.env)
    .filter((url) => url !== context.selfUrl)
    .sort()
    .join("\n");
  const recentJoin = recentBootstrapJoins.get(context.env);
  if (recentJoin?.bootstrapKey === bootstrapKey &&
      Date.now() - recentJoin.completedAt < BOOTSTRAP_REFRESH_INTERVAL_MS) {
    return;
  }

  if (!joinPromises.has(context.env)) {
    const join = joinBootstrap(context)
      .then(({ bootstrapUrls, joined }) => {
        // Do not cache a failed bootstrap attempt. An isolated relay retries on
        // the very next operation instead of inheriting a recovery backoff.
        if (bootstrapUrls.length === 0 || joined > 0) {
          recentBootstrapJoins.set(context.env, {
            bootstrapKey,
            completedAt: Date.now(),
          });
        }
      })
      .finally(() => joinPromises.delete(context.env));
    joinPromises.set(context.env, join);
  }
  const pending = joinPromises.get(context.env);
  try {
    await withTimeout(pending, SHARED_WAIT_TIMEOUT_MS, 'Kademlia bootstrap');
  } catch (error) {
    // Forget the stuck join so the next operation starts a fresh one; this
    // caller carries on with whatever contacts are already in the table.
    if (joinPromises.get(context.env) === pending) joinPromises.delete(context.env);
  }
}

async function replicateProviderRecord(context, record, wantRecords = false) {
  await storeProviderRecord(context, record);
  const lookup = await iterativeLookup(context, record.key, wantRecords);
  const closest = selectClosestNodes([...lookup.nodes, context.nodeRecord], record.key, DEFAULT_REPLICATION_FACTOR);
  await Promise.all(closest
    .filter((node) => node.node_id !== context.identity.nodeId)
    .map((node) => postRpc(node.url, '/api/v1/kad/store', {
      requester: context.nodeRecord,
      record,
    })));
  return lookup;
}

/**
 * Every relay in the routing table, as a client-facing bootstrap list. A
 * client that reaches any one relay can learn every relay that one has
 * verified, so no relay is a private detour and the hub is not the only
 * place a peer can start from.
 */
export async function listKnownRelays(env, selfUrl, options = {}) {
  const context = await overlayContext(env, selfUrl, options);
  if (!context) return [];
  const known = await listActiveNodeRecords(context);
  const relays = [];
  for (const node of [context.nodeRecord, ...known]) {
    if (typeof node?.url !== 'string' || !node.url) continue;
    relays.push({
      url: node.url,
      name: node.name ?? null,
      node_id: node.node_id,
      connections: Number(node.connections || 0),
      capacity: Number(node.capacity || 0),
    });
  }
  return relays;
}

async function hasLiveContacts(context) {
  const result = await context.db.prepare(
    'SELECT node_id FROM psp_kad_nodes WHERE expires_at_ms > ?1 LIMIT ?2',
  ).bind(Date.now(), 1).all();
  return (result.results || []).length > 0;
}

/**
 * Join the overlay when this relay knows nobody. A relay that already holds a live contact
 * has nothing to refresh on a clock: it learns contacts from the traffic that passes through
 * it, and an operation that needs more joins on demand (ensureRoutingContacts). Without this
 * every isolate the platform starts repeated the join and a walk toward its own id every
 * two minutes, and each repeat was a fan-out of RPCs that the receivers wrote down.
 */
export async function heartbeatKademlia(env, selfUrl, options = {}) {
  const context = await overlayContext(env, selfUrl, options);
  if (!context) return { enabled: false };
  if (await hasLiveContacts(context)) return { enabled: true, node_id: context.identity.nodeId, joined: false };
  await cleanupExpiredOverlay(context);
  await ensureRoutingContacts(context);
  await iterativeLookup(context, context.identity.nodeId, false);
  return { enabled: true, node_id: context.identity.nodeId, joined: true };
}

/**
 * Announce that this relay serves a room. Called on every peer's announce and heartbeat, it
 * publishes at most once a minute per relay and room, whichever peer asks. Which relay holds
 * one particular peer is not published: a sender asks the relays that serve the room, and
 * only the one that holds the peer delivers (see handleRelayForward). `_peerId` stays in the
 * signature for the callers that pass it.
 */
export async function publishPeerProviderRecords(env, selfUrl, network, room, _peerId, options = {}) {
  const context = await overlayContext(env, selfUrl, options);
  if (!context) return false;
  const throttleKey = `${context.identity.nodeId}:${network}:${room}`;
  const now = Date.now();
  if (!markProviderPublish(throttleKey, now)) return true;
  await ensureRoutingContacts(context);

  const scopeRecord = await createSignedProviderRecord(context.identity, {
    url: context.selfUrl,
    connections: options.connections || 0,
    capacity: Number(env.RELAY_CAPACITY || 10_000),
    ttlMs: PROVIDER_RECORD_TTL_MS,
    now,
    kind: SCOPE_PROVIDER_RECORD_KIND,
    key: await scopeRoutingKey(network, room),
  });
  const scopeLookup = await replicateProviderRecord(context, scopeRecord, Boolean(options.returnScopeProviders));
  if (options.returnScopeProviders) {
    const records = [scopeRecord, ...scopeLookup.records]
      .filter((record) => record.kind === SCOPE_PROVIDER_RECORD_KIND && record.key === scopeRecord.key);
    return rankProviderRecords(records, MAX_PROVIDER_RELAYS);
  }
  return true;
}

async function lookupProviders(env, selfUrl, routingKey, kind, options = {}) {
  const context = await overlayContext(env, selfUrl, options);
  if (!context) return [];
  await ensureRoutingContacts(context);
  const lookup = await iterativeLookup(context, routingKey, true);
  const records = [];
  for (const record of lookup.records) {
    if (record.kind !== kind || record.key !== routingKey) continue;
    if (await verifySignedRelayRecord(record, { allowedKinds: new Set([kind]) })) records.push(record);
  }
  return rankProviderRecords(records, MAX_PROVIDER_RELAYS);
}

export async function lookupScopeProviders(env, selfUrl, network, room, options = {}) {
  return lookupProviders(env, selfUrl, await scopeRoutingKey(network, room), SCOPE_PROVIDER_RECORD_KIND, options);
}

/**
 * The relays that serve a room, which is where a message for any peer in it may be waiting.
 * No relay publishes where one peer lives, so a sender asks these, and the one that does not
 * hold the peer says so (handleRelayForward). Concurrent callers share one lookup: an offer
 * and its burst of ICE packets all target the same room.
 */
export async function lookupRoomProviders(env, selfUrl, network, room, options = {}) {
  const routingKey = await scopeRoutingKey(network, room);
  const cacheKey = JSON.stringify([selfUrl, network, room]);
  const now = Date.now();
  const cached = recentPeerProviderLookups.get(cacheKey);
  if (cached?.promise) {
    if (now - cached.startedAt < SHARED_WAIT_TIMEOUT_MS) {
      try {
        return await withTimeout(cached.promise, SHARED_WAIT_TIMEOUT_MS, 'Peer provider lookup');
      } catch {
        // Fall through to a fresh lookup of our own.
      }
    }
    if (recentPeerProviderLookups.get(cacheKey) === cached) recentPeerProviderLookups.delete(cacheKey);
  } else if (cached?.records && cached.expiresAt > now) {
    return cached.records;
  } else if (cached) {
    recentPeerProviderLookups.delete(cacheKey);
  }

  // One WebRTC offer commonly produces an offer plus a burst of ICE packets.
  // They all target the same peer and must share one Kademlia lookup instead of
  // launching an expensive overlay walk per packet. Empty results are not
  // cached so a just-published provider can be found by the next packet.
  const promise = lookupProviders(env, selfUrl, routingKey, SCOPE_PROVIDER_RECORD_KIND, options)
    .then((records) => {
      if (records.length > 0) {
        rememberPeerProviderLookup(cacheKey, {
          records,
          expiresAt: Date.now() + PEER_PROVIDER_LOOKUP_CACHE_MS,
        });
      } else {
        recentPeerProviderLookups.delete(cacheKey);
      }
      return records;
    })
    .catch((error) => {
      recentPeerProviderLookups.delete(cacheKey);
      throw error;
    });
  rememberPeerProviderLookup(cacheKey, { promise, expiresAt: now, startedAt: now });
  return withTimeout(promise, SHARED_WAIT_TIMEOUT_MS * 2, 'Peer provider lookup');
}

export async function handleKademliaRequest(request, env, options = {}) {
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_RPC_BODY_BYTES) return jsonResponse({ ok: false, error: 'Request too large' }, 413);

  const context = await overlayContext(env, options.selfUrl, options);
  if (!context) return jsonResponse({ ok: false, error: 'Kademlia relay identity is not configured' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (!await acceptNodeRecord(context, body?.requester)) {
    return jsonResponse({ ok: false, error: 'Invalid signed requester record' }, 401);
  }

  const path = new URL(request.url).pathname;
  if (path === '/api/v1/kad/ping') {
    return jsonResponse({ ok: true, node: context.nodeRecord });
  }

  if (path === '/api/v1/kad/find') {
    if (!isNodeId(body.target)) return jsonResponse({ ok: false, error: 'Invalid target' }, 400);
    const localNodes = await listActiveNodeRecords(context);
    const nodes = selectClosestNodes([...localNodes, context.nodeRecord], body.target, DEFAULT_K_BUCKET_SIZE)
      .map(signedNodeRecord);
    const records = body.want_records ? await findLocalProviderRecords(context, body.target) : [];
    return jsonResponse({ ok: true, node: context.nodeRecord, nodes, records });
  }

  if (path === '/api/v1/kad/store') {
    if (body.record?.node_id !== body.requester.node_id) {
      return jsonResponse({ ok: false, error: 'A relay may only publish its own provider record' }, 403);
    }
    if (!await storeProviderRecord(context, body.record)) {
      return jsonResponse({ ok: false, error: 'Invalid signed provider record' }, 400);
    }
    return jsonResponse({ ok: true, stored: true });
  }

  return jsonResponse({ ok: false, error: 'Unknown Kademlia endpoint' }, 404);
}
