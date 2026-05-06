use crate::mesh::MeshLike;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub timestamp: i64,
    pub hops: i32,
    #[serde(rename = "maxHops")]
    pub max_hops: i32,
    pub sender: String,
    pub data: Value,
    pub metadata: Map<String, Value>,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectMessage {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub from: String,
    pub to: String,
    pub data: Value,
    pub hops: i32,
    #[serde(rename = "maxHops")]
    pub max_hops: i32,
    pub timestamp: i64,
}

#[derive(Debug, Clone)]
pub struct MessageReceivedEvent {
    pub message: Message,
    pub local: bool,
    pub from_peer: String,
}

#[derive(Debug, Clone, Default)]
pub struct Options {
    pub max_hops: i32,
    pub max_direct_hops: i32,
}

type MessageHandler = Arc<dyn Fn(MessageReceivedEvent) + Send + Sync>;
type DirectHandler = Arc<dyn Fn(DirectMessage) + Send + Sync>;

pub struct GossipProtocol {
    mesh: Arc<dyn MeshLike>,
    max_hops: i32,
    max_direct_hops: i32,
    message_log: Mutex<HashMap<String, i64>>,
    seen_direct: Mutex<HashSet<String>>,
    message_handlers: Mutex<Vec<(usize, MessageHandler)>>,
    direct_handlers: Mutex<Vec<(usize, DirectHandler)>>,
    next_handler_id: AtomicUsize,
}

impl GossipProtocol {
    pub fn new(mesh: Arc<dyn MeshLike>, opts: Options) -> Self {
        Self {
            mesh,
            max_hops: if opts.max_hops <= 0 { 5 } else { opts.max_hops },
            max_direct_hops: if opts.max_direct_hops <= 0 {
                20
            } else {
                opts.max_direct_hops
            },
            message_log: Mutex::new(HashMap::new()),
            seen_direct: Mutex::new(HashSet::new()),
            message_handlers: Mutex::new(Vec::new()),
            direct_handlers: Mutex::new(Vec::new()),
            next_handler_id: AtomicUsize::new(1),
        }
    }

    pub fn on_message_received(
        &self,
        handler: impl Fn(MessageReceivedEvent) + Send + Sync + 'static,
    ) -> usize {
        let id = self.next_handler_id.fetch_add(1, Ordering::Relaxed);
        self.message_handlers
            .lock()
            .expect("message handler lock poisoned")
            .push((id, Arc::new(handler)));
        id
    }

    pub fn off_message_received(&self, id: usize) {
        self.message_handlers
            .lock()
            .expect("message handler lock poisoned")
            .retain(|(handler_id, _)| *handler_id != id);
    }

    pub fn on_direct_message_received(
        &self,
        handler: impl Fn(DirectMessage) + Send + Sync + 'static,
    ) -> usize {
        let id = self.next_handler_id.fetch_add(1, Ordering::Relaxed);
        self.direct_handlers
            .lock()
            .expect("direct handler lock poisoned")
            .push((id, Arc::new(handler)));
        id
    }

    pub fn broadcast(&self, data: Value, metadata: Option<Map<String, Value>>) -> String {
        let sender = self.mesh.client_id();
        let mut max_hops = self.max_hops;
        let network_size = self.mesh.connected_peers().len().max(1) as i32;
        max_hops = max_hops.max(network_size * 2);

        let msg = Message {
            id: random_id("msg"),
            timestamp: now_ms(),
            hops: 0,
            max_hops,
            sender,
            data,
            metadata: metadata.unwrap_or_default(),
            kind: "gossip".to_string(),
        };

        self.message_log
            .lock()
            .expect("message log lock poisoned")
            .insert(msg.id.clone(), msg.timestamp);

        self.fire_message_handlers(MessageReceivedEvent {
            message: msg.clone(),
            local: true,
            from_peer: self.mesh.client_id(),
        });

        self.propagate_message(&msg, None);
        msg.id
    }

    pub fn send_direct(&self, target_peer_id: &str, data: Value) -> String {
        let msg = DirectMessage {
            id: random_id("direct"),
            kind: "direct".to_string(),
            from: self.mesh.client_id(),
            to: target_peer_id.to_string(),
            data,
            hops: 0,
            max_hops: self.max_direct_hops,
            timestamp: now_ms(),
        };

        let bytes = serde_json::to_vec(&msg).expect("serialize direct message");

        if self.mesh.connected_peers().iter().any(|p| p == target_peer_id) {
            let _ = self.mesh.send(target_peer_id, &bytes);
        } else {
            for peer in self.mesh.connected_peers() {
                let _ = self.mesh.send(&peer, &bytes);
            }
        }

        msg.id
    }

    pub fn handle_raw(&self, from_peer: &str, payload: &[u8]) {
        let value: Value = match serde_json::from_slice(payload) {
            Ok(v) => v,
            Err(_) => return,
        };

        let kind = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();

        if kind == "gossip" {
            self.handle_gossip_message(from_peer, value);
            return;
        }

        if kind == "direct" {
            self.handle_direct_message(from_peer, value);
        }
    }

    pub fn destroy(&self) {
        self.message_handlers
            .lock()
            .expect("message handler lock poisoned")
            .clear();
        self.direct_handlers
            .lock()
            .expect("direct handler lock poisoned")
            .clear();
    }

    fn handle_gossip_message(&self, from_peer: &str, value: Value) {
        let mut msg: Message = match serde_json::from_value(value) {
            Ok(msg) => msg,
            Err(_) => return,
        };

        let already_seen = self
            .message_log
            .lock()
            .expect("message log lock poisoned")
            .contains_key(&msg.id);

        if already_seen {
            return;
        }

        self.message_log
            .lock()
            .expect("message log lock poisoned")
            .insert(msg.id.clone(), now_ms());

        self.fire_message_handlers(MessageReceivedEvent {
            message: msg.clone(),
            local: false,
            from_peer: from_peer.to_string(),
        });

        if msg.hops >= msg.max_hops {
            return;
        }

        msg.hops += 1;
        self.propagate_message(&msg, Some(from_peer));
    }

    fn handle_direct_message(&self, _from_peer: &str, value: Value) {
        let mut msg: DirectMessage = match serde_json::from_value(value) {
            Ok(msg) => msg,
            Err(_) => return,
        };

        let mut seen = self.seen_direct.lock().expect("seen_direct lock poisoned");
        if seen.contains(&msg.id) {
            return;
        }
        seen.insert(msg.id.clone());
        drop(seen);

        if msg.to == self.mesh.client_id() {
            self.fire_direct_handlers(msg);
            return;
        }

        if msg.hops >= msg.max_hops {
            return;
        }

        msg.hops += 1;
        let bytes = serde_json::to_vec(&msg).expect("serialize direct message");
        for peer in self.mesh.connected_peers() {
            let _ = self.mesh.send(&peer, &bytes);
        }
    }

    fn propagate_message(&self, msg: &Message, except_peer: Option<&str>) {
        let bytes = serde_json::to_vec(msg).expect("serialize gossip message");
        for peer_id in self.mesh.connected_peers() {
            if except_peer.is_some_and(|p| p == peer_id) {
                continue;
            }
            let _ = self.mesh.send(&peer_id, &bytes);
        }
    }

    fn fire_message_handlers(&self, event: MessageReceivedEvent) {
        let handlers = self
            .message_handlers
            .lock()
            .expect("message handler lock poisoned")
            .clone();

        for (_, handler) in handlers {
            handler(event.clone());
        }
    }

    fn fire_direct_handlers(&self, msg: DirectMessage) {
        let handlers = self
            .direct_handlers
            .lock()
            .expect("direct handler lock poisoned")
            .clone();

        for (_, handler) in handlers {
            handler(msg.clone());
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
