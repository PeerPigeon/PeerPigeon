use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Space {
    Public,
    User,
    Frozen,
    Private,
    EPublic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Record {
    pub space: Space,
    pub key: String,
    pub value: Value,
    pub owner_id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeOrigin {
    Local,
    Remote,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeEvent {
    pub origin: ChangeOrigin,
    pub op: String,
    pub record: Option<Record>,
    pub space: Space,
    pub key: String,
    pub actor_id: String,
}

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("storage is closed")]
    Closed,
    #[error("permission denied for key {0}")]
    PermissionDenied(String),
    #[error("invalid mutation payload")]
    InvalidMutation,
}

#[derive(Clone)]
pub struct StorageOptions {
    pub user_id: String,
    pub session_id: String,
    pub sync_secret: String,
}

impl Default for StorageOptions {
    fn default() -> Self {
        Self {
            user_id: "user".to_string(),
            session_id: "default-session".to_string(),
            sync_secret: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StorageMutation {
    #[serde(rename = "__ppType")]
    pp_type: String,
    #[serde(rename = "opId")]
    op_id: String,
    op: String,
    space: Space,
    key: String,
    #[serde(rename = "actorId")]
    actor_id: String,
    timestamp: i64,
    record: Option<Record>,
}

type ChangeHandler = Arc<dyn Fn(ChangeEvent) + Send + Sync>;

pub struct PeerPigeonStorage {
    user_id: String,
    _session_id: String,
    _sync_secret: String,
    closed: Mutex<bool>,
    records: Mutex<HashMap<(Space, String), Record>>,
    listeners: Mutex<Vec<(usize, ChangeHandler)>>,
    seen_mutations: Mutex<HashMap<String, i64>>,
    next_listener_id: AtomicUsize,
}

impl PeerPigeonStorage {
    pub fn new(opts: StorageOptions) -> Result<Self, StorageError> {
        Ok(Self {
            user_id: opts.user_id,
            _session_id: opts.session_id,
            _sync_secret: opts.sync_secret,
            closed: Mutex::new(false),
            records: Mutex::new(HashMap::new()),
            listeners: Mutex::new(Vec::new()),
            seen_mutations: Mutex::new(HashMap::new()),
            next_listener_id: AtomicUsize::new(1),
        })
    }

    pub fn close(&self) {
        *self.closed.lock().expect("closed lock poisoned") = true;
    }

    pub fn on_change(&self, handler: impl Fn(ChangeEvent) + Send + Sync + 'static) -> usize {
        let id = self.next_listener_id.fetch_add(1, Ordering::Relaxed);
        self.listeners
            .lock()
            .expect("listeners lock poisoned")
            .push((id, Arc::new(handler)));
        id
    }

    pub fn off_change(&self, id: usize) {
        self.listeners
            .lock()
            .expect("listeners lock poisoned")
            .retain(|(handler_id, _)| *handler_id != id);
    }

    pub fn put(&self, space: Space, key: &str, value: Value) -> Result<Record, StorageError> {
        self.ensure_open()?;
        self.ensure_can_write(space, key)?;

        let now = now_ms();
        let k = (space, key.to_string());

        let mut records = self.records.lock().expect("records lock poisoned");
        let next_version = records
            .get(&k)
            .and_then(|r| r.version.parse::<u64>().ok())
            .unwrap_or(0)
            + 1;

        let record = Record {
            space,
            key: key.to_string(),
            value,
            owner_id: self.user_id.clone(),
            created_at: records.get(&k).map(|r| r.created_at).unwrap_or(now),
            updated_at: now,
            version: next_version.to_string(),
        };
        records.insert(k, record.clone());
        drop(records);

        self.fire_change(ChangeEvent {
            origin: ChangeOrigin::Local,
            op: "upsert".to_string(),
            record: Some(record.clone()),
            space,
            key: key.to_string(),
            actor_id: self.user_id.clone(),
        });

        Ok(record)
    }

    pub fn get(&self, space: Space, key: &str) -> Result<Option<Record>, StorageError> {
        self.ensure_open()?;
        Ok(self
            .records
            .lock()
            .expect("records lock poisoned")
            .get(&(space, key.to_string()))
            .cloned())
    }

    pub fn delete(&self, space: Space, key: &str) -> Result<bool, StorageError> {
        self.ensure_open()?;
        self.ensure_can_write(space, key)?;

        let removed = self
            .records
            .lock()
            .expect("records lock poisoned")
            .remove(&(space, key.to_string()))
            .is_some();

        if removed {
            self.fire_change(ChangeEvent {
                origin: ChangeOrigin::Local,
                op: "delete".to_string(),
                record: None,
                space,
                key: key.to_string(),
                actor_id: self.user_id.clone(),
            });
        }

        Ok(removed)
    }

    pub fn list(&self, space: Space) -> Result<Vec<Record>, StorageError> {
        self.ensure_open()?;
        let mut out: Vec<Record> = self
            .records
            .lock()
            .expect("records lock poisoned")
            .values()
            .filter(|record| record.space == space)
            .cloned()
            .collect();
        out.sort_by(|a, b| a.key.cmp(&b.key));
        Ok(out)
    }

    pub fn make_local_mutation_payload(&self, op: &str, record: Option<Record>, space: Space, key: &str) -> Value {
        let mutation = StorageMutation {
            pp_type: "pp-storage-op-v1".to_string(),
            op_id: random_id("op"),
            op: op.to_string(),
            space,
            key: key.to_string(),
            actor_id: self.user_id.clone(),
            timestamp: now_ms(),
            record,
        };

        serde_json::to_value(mutation).unwrap_or_else(|_| json!({}))
    }

    pub fn apply_remote_mutation(&self, payload: &Value) -> Result<bool, StorageError> {
        self.ensure_open()?;

        let mutation: StorageMutation = serde_json::from_value(payload.clone())
            .map_err(|_| StorageError::InvalidMutation)?;

        if mutation.pp_type != "pp-storage-op-v1" {
            return Err(StorageError::InvalidMutation);
        }

        let mut seen = self
            .seen_mutations
            .lock()
            .expect("seen_mutations lock poisoned");
        if seen.contains_key(&mutation.op_id) {
            return Ok(false);
        }
        seen.insert(mutation.op_id.clone(), mutation.timestamp);
        drop(seen);

        match mutation.op.as_str() {
            "upsert" => {
                let Some(record) = mutation.record.clone() else {
                    return Err(StorageError::InvalidMutation);
                };

                self.records
                    .lock()
                    .expect("records lock poisoned")
                    .insert((mutation.space, mutation.key.clone()), record.clone());

                self.fire_change(ChangeEvent {
                    origin: ChangeOrigin::Remote,
                    op: mutation.op,
                    record: Some(record),
                    space: mutation.space,
                    key: mutation.key,
                    actor_id: mutation.actor_id,
                });
                Ok(true)
            }
            "delete" => {
                self.records
                    .lock()
                    .expect("records lock poisoned")
                    .remove(&(mutation.space, mutation.key.clone()));

                self.fire_change(ChangeEvent {
                    origin: ChangeOrigin::Remote,
                    op: mutation.op,
                    record: None,
                    space: mutation.space,
                    key: mutation.key,
                    actor_id: mutation.actor_id,
                });
                Ok(true)
            }
            _ => Err(StorageError::InvalidMutation),
        }
    }

    fn ensure_open(&self) -> Result<(), StorageError> {
        if *self.closed.lock().expect("closed lock poisoned") {
            return Err(StorageError::Closed);
        }
        Ok(())
    }

    fn ensure_can_write(&self, space: Space, key: &str) -> Result<(), StorageError> {
        if space == Space::Private && !key.starts_with("private:") {
            return Err(StorageError::PermissionDenied(key.to_string()));
        }
        Ok(())
    }

    fn fire_change(&self, event: ChangeEvent) {
        let listeners = self
            .listeners
            .lock()
            .expect("listeners lock poisoned")
            .clone();

        for (_, listener) in listeners {
            listener(event.clone());
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before unix epoch")
        .as_millis() as i64
}

fn random_id(prefix: &str) -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("{prefix}-{}", hex_encode(&bytes))
}

fn hex_encode(data: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(data.len() * 2);
    for b in data {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}
