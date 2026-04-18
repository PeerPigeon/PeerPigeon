const { PeerPigeonStorage } = require('./dist/index.cjs');

class FakeGossip {
  constructor(userId) {
    this.userId = userId;
    this.listeners = new Set();
  }
  static peers = new Map();
  
  on(event, cb) {
    if (event === 'messageReceived') this.listeners.add(cb);
  }
  off(event, cb) {
    if (event === 'messageReceived') this.listeners.delete(cb);
  }
  broadcast(data) {
    const id = Math.random().toString(36).substring(7);
    setTimeout(() => {
      for (const [userId, gossip] of FakeGossip.peers) {
        if (userId === this.userId) continue;
        for (const cb of gossip.listeners) {
          cb({ message: { data }, local: false, fromPeer: this.userId });
        }
      }
    }, 10);
    return id;
  }
}

async function run() {
  const syncFilter = (space, key) => space === 'public' && key === 'test';
  const sessionId = 's1';
  const syncSecret = '';

  const gossipA = new FakeGossip('a');
  FakeGossip.peers.set('a', gossipA);
  const a = new PeerPigeonStorage({
    userId: 'a',
    sessionId,
    syncSecret,
    gossip: gossipA,
    syncFilter
  });

  const gossipB = new FakeGossip('b');
  FakeGossip.peers.set('b', gossipB);
  const b = new PeerPigeonStorage({
    userId: 'b',
    sessionId,
    syncSecret,
    gossip: gossipB,
    syncFilter
  });

  const bEvents = [];
  b.on('change', (event) => {
    bEvents.push(event);
  });

  await a.init();
  await b.init();

  await a.put('public', 'test', 'v1');
  await new Promise(r => setTimeout(r, 200));
  
  console.log('--- After v1 ---');
  console.log('B Events:', JSON.stringify(bEvents, null, 2));
  console.log('B Get:', await b.get('public', 'test'));

  await a.put('public', 'test', 'v2');
  await new Promise(r => setTimeout(r, 200));

  console.log('--- After v2 ---');
  console.log('B Events:', JSON.stringify(bEvents, null, 2));
  console.log('B Get:', await b.get('public', 'test'));
}

run().catch(console.error);
