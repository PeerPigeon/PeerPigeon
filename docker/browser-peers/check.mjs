#!/usr/bin/env node
// Readable report on a swarm of browser-peer containers, run in a container on
// the swarm's Docker network so it can reach each one's control endpoint.
//
//   node docker/browser-peers/check.mjs status   the mesh across every peer
//   node docker/browser-peers/check.mjs test     the mesh, then every peer
//                                                broadcasts once and sends one
//                                                direct message
//
// Environment: CONTAINERS (default 10), PREFIX (default pp-swarm),
// CONTROL_PORT (default 5191), MIN_LINKS (default 2), MAX_PEERS (default 10),
// WAIT_S (how long to wait for test messages, default 30).
const MODE = process.argv[2] || 'status';
const CONTAINERS = Number(process.env.CONTAINERS || 10);
const PREFIX = process.env.PREFIX || 'pp-swarm';
const CONTROL_PORT = Number(process.env.CONTROL_PORT || 5191);
const MIN_LINKS = Number(process.env.MIN_LINKS || 2);
const MAX_PEERS = Number(process.env.MAX_PEERS || 10);
const WAIT_S = Number(process.env.WAIT_S || 30);

const names = Array.from({ length: CONTAINERS }, (_, i) => `${PREFIX}-${i + 1}`);
const short = (id) => (id ? id.slice(0, 8) : '--------');
const pad = (value, width) => String(value).padEnd(width);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  return response.json();
}

async function collect() {
  const results = await Promise.all(names.map(async (name) => {
    try {
      return await json(`http://${name}:${CONTROL_PORT}/state`);
    } catch (error) {
      return { container: name, peers: [], error: error.cause?.code || error.message };
    }
  }));
  const peers = [];
  for (const result of results) {
    for (const peer of result.peers) peers.push({ ...peer, container: result.container });
  }
  return { results, peers };
}

function meshReport(results, peers) {
  const known = new Map(peers.filter((p) => p.id).map((p) => [p.id, p]));
  // Undirected links between swarm peers; links to peers outside the swarm
  // (your browser tabs, say) are counted separately.
  const adjacency = new Map([...known.keys()].map((id) => [id, new Set()]));
  let outside = 0;
  let oneSided = 0;
  for (const peer of known.values()) {
    for (const link of peer.links) {
      if (!known.has(link)) { outside += 1; continue; }
      adjacency.get(peer.id).add(link);
      adjacency.get(link).add(peer.id);
      if (!known.get(link).links.includes(peer.id)) oneSided += 1;
    }
  }
  const components = [];
  const seen = new Set();
  for (const id of adjacency.keys()) {
    if (seen.has(id)) continue;
    const component = [];
    const queue = [id];
    seen.add(id);
    while (queue.length) {
      const next = queue.shift();
      component.push(next);
      for (const neighbour of adjacency.get(next)) {
        if (!seen.has(neighbour)) { seen.add(neighbour); queue.push(neighbour); }
      }
    }
    components.push(component);
  }
  components.sort((a, b) => b.length - a.length);
  const degrees = [...adjacency.values()].map((links) => links.size);
  const isolated = [...adjacency.entries()].filter(([, links]) => links.size === 0).map(([id]) => id);
  const below = [...adjacency.entries()].filter(([, links]) => links.size > 0 && links.size < MIN_LINKS).map(([id]) => id);
  const above = [...adjacency.entries()].filter(([, links]) => links.size > MAX_PEERS).map(([id]) => id);
  const expected = results.reduce((sum, r) => sum + (r.peers.length || 0), 0);
  const unreachable = results.filter((r) => r.error);
  const noId = peers.filter((p) => !p.id);

  console.log('');
  console.log(`MESH  ${known.size} peers with an ID, in ${CONTAINERS} containers${unreachable.length ? ` (${unreachable.length} container(s) not answering)` : ''}`);
  if (degrees.length) {
    const avg = (degrees.reduce((a, b) => a + b, 0) / degrees.length).toFixed(1);
    console.log(`      links per peer: min ${Math.min(...degrees)}, avg ${avg}, max ${Math.max(...degrees)} (wanted ${MIN_LINKS}–${MAX_PEERS})`);
  }
  console.log(`      groups: ${components.length === 1 ? 'one mesh' : `${components.length} separate groups`} — sizes ${components.map((c) => c.length).join(', ') || 'none'}`);
  if (outside) console.log(`      ${outside} link(s) to peers outside the swarm`);
  if (oneSided) console.log(`      ${oneSided} link(s) seen by only one side`);
  const ok = known.size === expected && expected > 0 && components.length === 1 && isolated.length === 0 && below.length === 0 && above.length === 0 && !unreachable.length;
  console.log(`      ${ok ? 'OK: one partial mesh containing every peer' : 'NOT FORMED'}`);
  for (const r of unreachable) console.log(`        ${r.container} not answering (${r.error})`);
  if (noId.length) console.log(`        ${noId.length} peer(s) without an ID yet`);
  if (isolated.length) console.log(`        isolated: ${isolated.map(short).join(' ')}`);
  if (below.length) console.log(`        fewer than ${MIN_LINKS} links: ${below.map(short).join(' ')}`);
  if (above.length) console.log(`        more than ${MAX_PEERS} links: ${above.map(short).join(' ')}`);

  console.log('');
  console.log(`${pad('CONTAINER', 13)}PEERS (id:links)`);
  for (const result of results) {
    const cells = result.error
      ? [`not answering (${result.error})`]
      : result.peers.map((p) => `${short(p.id)}:${adjacency.get(p.id)?.size ?? 0}${p.signaling ? '' : '!'}`);
    console.log(`${pad(result.container, 13)}${cells.join('  ')}`);
  }
  console.log(`${pad('', 13)}(! = not connected to signaling)`);
  return { known, adjacency, ok };
}

async function sendAll(messages) {
  return Promise.all(messages.map(async (message) => {
    try {
      const result = await json(`http://${message.container}:${CONTROL_PORT}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
      return { ...message, sent: Boolean(result.ok), error: result.error };
    } catch (error) {
      return { ...message, sent: false, error: error.message };
    }
  }));
}

async function waitForDeliveries(expect) {
  // expect: Map token -> Set of peer ids that should receive it
  const deadline = Date.now() + WAIT_S * 1000;
  let received = new Map();
  while (true) {
    const { peers } = await collect();
    received = new Map();
    for (const peer of peers) for (const token of peer.rx) {
      if (!expect.has(token)) continue;
      if (!received.has(token)) received.set(token, new Set());
      received.get(token).add(peer.id);
    }
    const complete = [...expect.entries()].every(([token, want]) => [...want].every((id) => received.get(token)?.has(id)));
    if (complete || Date.now() >= deadline) return received;
    await sleep(2000);
  }
}

async function test(known) {
  const ids = [...known.keys()].sort();
  const run = Date.now().toString(36);
  if (ids.length < 2) {
    console.log('\nTEST  skipped: fewer than 2 peers');
    return;
  }

  // Broadcast: every peer sends one; every other swarm peer should get it.
  const broadcasts = ids.map((from) => ({ container: known.get(from).container, from, kind: 'broadcast', token: `b:${run}:${from}` }));
  const sentB = await sendAll(broadcasts);
  const expectB = new Map(broadcasts.map((m) => [m.token, new Set(ids.filter((id) => id !== m.from))]));
  const gotB = await waitForDeliveries(expectB);
  let fullB = 0;
  let deliveredB = 0;
  const shortB = [];
  for (const m of broadcasts) {
    const reached = gotB.get(m.token)?.size ?? 0;
    deliveredB += reached;
    if (reached === ids.length - 1) fullB += 1;
    else shortB.push(`${short(m.from)} reached ${reached}/${ids.length - 1}${sentB.find((s) => s.token === m.token)?.sent ? '' : ' (send failed)'}`);
  }
  const totalB = ids.length * (ids.length - 1);
  console.log('');
  console.log(`BROADCAST  ${fullB}/${ids.length} senders reached every other peer; ${deliveredB}/${totalB} deliveries (${((deliveredB / totalB) * 100).toFixed(1)}%)`);
  console.log(`           ${fullB === ids.length ? 'OK' : 'INCOMPLETE'}`);
  // Who missed broadcasts: one peer missing everything means that peer is cut
  // off, not that every sender is broken.
  const missedBy = ids
    .map((id) => ({ id, missed: broadcasts.filter((m) => m.from !== id && !gotB.get(m.token)?.has(id)).length }))
    .filter((r) => r.missed > 0)
    .sort((a, b) => b.missed - a.missed);
  if (missedBy.length) {
    console.log(`           peers that missed broadcasts: ${missedBy.slice(0, 12).map((r) => `${short(r.id)} missed ${r.missed}/${ids.length - 1}`).join(', ')}${missedBy.length > 12 ? `, ...and ${missedBy.length - 12} more` : ''}`);
  }
  for (const line of shortB.slice(0, 8)) console.log(`             ${line}`);
  if (shortB.length > 8) console.log(`             ...and ${shortB.length - 8} more senders short`);

  // Direct: each peer sends one message to the peer halfway round the sorted
  // list, so most go to peers it has no link to and must be routed.
  const directs = ids.map((from, i) => {
    const to = ids[(i + Math.floor(ids.length / 2)) % ids.length];
    return { container: known.get(from).container, from, to, kind: 'direct', token: `d:${run}:${from}:${to}` };
  });
  const sentD = await sendAll(directs);
  const expectD = new Map(directs.map((m) => [m.token, new Set([m.to])]));
  const gotD = await waitForDeliveries(expectD);
  const failedD = directs.filter((m) => !gotD.get(m.token)?.has(m.to));
  const neighbours = directs.filter((m) => known.get(m.from).links.includes(m.to)).length;
  console.log('');
  console.log(`DIRECT     ${directs.length - failedD.length}/${directs.length} delivered (${neighbours} to a linked peer, ${directs.length - neighbours} routed through the mesh)`);
  console.log(`           ${failedD.length === 0 ? 'OK' : 'INCOMPLETE'}`);
  for (const m of failedD.slice(0, 15)) {
    const sent = sentD.find((s) => s.token === m.token);
    console.log(`             ${short(m.from)} -> ${short(m.to)} not delivered${sent?.sent ? '' : ` (send failed: ${sent?.error || 'unknown'})`}`);
  }
  if (failedD.length > 15) console.log(`             ...and ${failedD.length - 15} more`);
}

const { results, peers } = await collect();
const { known } = meshReport(results, peers);
if (MODE === 'test') await test(known);
console.log('');
