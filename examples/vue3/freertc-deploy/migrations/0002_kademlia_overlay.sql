-- Bounded Kademlia relay routing table and replicated provider records.

CREATE TABLE IF NOT EXISTS psp_kad_nodes (
  node_id TEXT PRIMARY KEY,
  bucket_index INTEGER NOT NULL,
  url TEXT NOT NULL,
  record_json TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kad_nodes_bucket_seen
  ON psp_kad_nodes (bucket_index, last_seen_ms DESC);

CREATE INDEX IF NOT EXISTS idx_kad_nodes_expires
  ON psp_kad_nodes (expires_at_ms);

CREATE TABLE IF NOT EXISTS psp_kad_records (
  routing_key TEXT NOT NULL,
  owner_node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  record_json TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (routing_key, owner_node_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_kad_records_lookup
  ON psp_kad_records (routing_key, expires_at_ms, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_kad_records_expires
  ON psp_kad_records (expires_at_ms);
