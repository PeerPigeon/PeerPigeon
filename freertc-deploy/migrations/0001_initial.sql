-- Initial D1 schema for the FreeRTC signaling and federation relay.

CREATE TABLE IF NOT EXISTS psp_announcements (
  network TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  session_id TEXT,
  expires_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (network, peer_id)
);

CREATE INDEX IF NOT EXISTS idx_announcements_network_expires
  ON psp_announcements (network, expires_at_ms);

CREATE TABLE IF NOT EXISTS psp_relay (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network TEXT NOT NULL,
  to_peer_id TEXT NOT NULL,
  type TEXT NOT NULL,
  session_id TEXT,
  message_json TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_relay_lookup
  ON psp_relay (network, to_peer_id, created_at_ms);

CREATE INDEX IF NOT EXISTS idx_relay_lookup_ordered
  ON psp_relay (network, to_peer_id, created_at_ms, id);

CREATE INDEX IF NOT EXISTS idx_relay_expires
  ON psp_relay (expires_at_ms);

CREATE TABLE IF NOT EXISTS psp_relays (
  url TEXT PRIMARY KEY,
  name TEXT,
  registered_at_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_relays_last_seen
  ON psp_relays (last_seen_ms);
