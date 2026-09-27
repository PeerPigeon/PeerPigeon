import {
  DEFAULT_K_BUCKET_SIZE,
  DEFAULT_LOOKUP_ALPHA,
  DEFAULT_REPLICATION_FACTOR,
  bucketIndex,
  isNodeId,
  peerRoutingKey,
  rankProviderRecords,
  scopeRoutingKey,
  selectClosestNodes,
} from './kademlia.js';
import {
  PEER_PROVIDER_RECORD_KIND,
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
const BOOTSTRAP_REFRESH_INTERVAL_MS = 5_000;
const PROVIDER_PUBLISH_INTERVAL_MS = 20_000;
const PROVIDER_RECORD_TTL_MS = 45_000;
const MAX_RECENT_PROVIDER_PUBLISHES = 20_000;
const PEER_PROVIDER_LOOKUP_CACHE_MS = 5_000;
const MAX_RECENT_PEER_PROVIDER_LOOKUPS = 2_000;

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

function configuredBootstrapUrls(env) {
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
  await context.db.prepare(`
    INSERT INTO psp_kad_nodes
      (node_id, bucket_index, url, record_json, expires_at_ms, last_seen_ms)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(node_id) DO UPDATE SET
      bucket_index = excluded.bucket_index,
      url = excluded.url,
      record_json = excluded.record_json,
      expires_at_ms = excluded.expires_at_ms,
      last_seen_ms = excluded.last_seen_ms
  `).bind(
    record.node_id,
    index,
    record.url,
    JSON.stringify(record),
    record.expires_at_ms,
    now,
  ).run();

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

async function acceptNodeRecord(context, record) {
  const valid = await verifySignedRelayRecord(record, { allowedKinds: new Set([RELAY_NODE_RECORD_KIND]) });
  if (!valid) return false;
  await upsertNodeRecord(context, record);
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

async function joinBootstrap(context) {
  const bootstrapUrls = configuredBootstrapUrls(context.env).filter((url) => url !== context.selfUrl);
  const responses = await Promise.all(bootstrapUrls.map((url) => postRpc(url, '/api/v1/kad/find', {
    target: context.identity.nodeId,
    want_records: false,
    requester: context.nodeRecord,
  })));
  const records = new Map();
  let joined = 0;
  for (const response of responses) {
    if (response?.ok) joined += 1;
    await acceptLookupResponse(context, response, context.identity.nodeId, records);
  }
  return { bootstrapUrls, joined };
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
  await joinPromises.get(context.env);
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

export async function heartbeatKademlia(env, selfUrl, options = {}) {
  const context = await overlayContext(env, selfUrl, options);
  if (!context) return { enabled: false };
  await cleanupExpiredOverlay(context);
  await ensureRoutingContacts(context);
  await iterativeLookup(context, context.identity.nodeId, false);
  return { enabled: true, node_id: context.identity.nodeId };
}

export async function publishPeerProviderRecords(env, selfUrl, network, room, peerId, options = {}) {
  const context = await overlayContext(env, selfUrl, options);
  if (!context) return false;
  const throttleKey = `${context.identity.nodeId}:${network}:${room}:${peerId}`;
  const now = Date.now();
  if (!markProviderPublish(throttleKey, now)) return true;
  await ensureRoutingContacts(context);

  const shared = {
    url: context.selfUrl,
    connections: options.connections || 0,
    capacity: Number(env.RELAY_CAPACITY || 10_000),
    ttlMs: PROVIDER_RECORD_TTL_MS,
    now,
  };
  const [scopeRecord, peerRecord] = await Promise.all([
    createSignedProviderRecord(context.identity, {
      ...shared,
      kind: SCOPE_PROVIDER_RECORD_KIND,
      key: await scopeRoutingKey(network, room),
    }),
    createSignedProviderRecord(context.identity, {
      ...shared,
      kind: PEER_PROVIDER_RECORD_KIND,
      key: await peerRoutingKey(network, room, peerId),
    }),
  ]);
  const [scopeLookup] = await Promise.all([
    replicateProviderRecord(context, scopeRecord, Boolean(options.returnScopeProviders)),
    replicateProviderRecord(context, peerRecord),
  ]);
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

export async function lookupPeerProviders(env, selfUrl, network, room, peerId, options = {}) {
  const routingKey = await peerRoutingKey(network, room, peerId);
  const cacheKey = JSON.stringify([selfUrl, network, room, peerId]);
  const now = Date.now();
  const cached = recentPeerProviderLookups.get(cacheKey);
  if (cached?.promise) return cached.promise;
  if (cached?.records && cached.expiresAt > now) return cached.records;
  if (cached) recentPeerProviderLookups.delete(cacheKey);

  // One WebRTC offer commonly produces an offer plus a burst of ICE packets.
  // They all target the same peer and must share one Kademlia lookup instead of
  // launching an expensive overlay walk per packet. Empty results are not
  // cached so a just-published provider can be found by the next packet.
  const promise = lookupProviders(env, selfUrl, routingKey, PEER_PROVIDER_RECORD_KIND, options)
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
  rememberPeerProviderLookup(cacheKey, { promise, expiresAt: now });
  return promise;
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
    const nodes = selectClosestNodes([...localNodes, context.nodeRecord], body.target, DEFAULT_K_BUCKET_SIZE);
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
