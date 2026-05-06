use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, Weak};

pub trait MeshLike: Send + Sync {
    fn client_id(&self) -> String;
    fn connected_peers(&self) -> Vec<String>;
    fn send(&self, peer_id: &str, data: &[u8]) -> Result<(), String>;
}

type DataHandler = Arc<dyn Fn(String, Vec<u8>) + Send + Sync>;

struct InProcessMeshInner {
    client_id: String,
    connections: Mutex<HashSet<String>>,
    handlers: Mutex<Vec<DataHandler>>,
    network: Arc<InProcessNetworkInner>,
}

#[derive(Clone)]
pub struct InProcessMesh {
    inner: Arc<InProcessMeshInner>,
}

struct InProcessNetworkInner {
    peers: Mutex<HashMap<String, Weak<InProcessMeshInner>>>,
}

#[derive(Clone, Default)]
pub struct InProcessNetwork {
    inner: Arc<InProcessNetworkInner>,
}

impl Default for InProcessNetworkInner {
    fn default() -> Self {
        Self {
            peers: Mutex::new(HashMap::new()),
        }
    }
}

impl InProcessNetwork {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create_mesh(&self, client_id: impl Into<String>) -> InProcessMesh {
        let client_id = client_id.into();
        let mesh = InProcessMesh {
            inner: Arc::new(InProcessMeshInner {
                client_id: client_id.clone(),
                connections: Mutex::new(HashSet::new()),
                handlers: Mutex::new(Vec::new()),
                network: Arc::clone(&self.inner),
            }),
        };

        self.inner
            .peers
            .lock()
            .expect("network lock poisoned")
            .insert(client_id, Arc::downgrade(&mesh.inner));

        mesh
    }

    pub fn connect(&self, a: &str, b: &str) -> Result<(), String> {
        let peers = self.inner.peers.lock().map_err(|_| "network lock poisoned")?;
        let a_peer = peers
            .get(a)
            .and_then(Weak::upgrade)
            .ok_or_else(|| format!("unknown peer: {a}"))?;
        let b_peer = peers
            .get(b)
            .and_then(Weak::upgrade)
            .ok_or_else(|| format!("unknown peer: {b}"))?;
        drop(peers);

        a_peer
            .connections
            .lock()
            .map_err(|_| "peer lock poisoned")?
            .insert(b.to_string());
        b_peer
            .connections
            .lock()
            .map_err(|_| "peer lock poisoned")?
            .insert(a.to_string());

        Ok(())
    }
}

impl InProcessMesh {
    pub fn on_data(&self, handler: impl Fn(String, Vec<u8>) + Send + Sync + 'static) {
        self.inner
            .handlers
            .lock()
            .expect("handler lock poisoned")
            .push(Arc::new(handler));
    }

    fn deliver_from(&self, from: &str, bytes: &[u8]) {
        let handlers = self
            .inner
            .handlers
            .lock()
            .expect("handler lock poisoned")
            .clone();

        for handler in handlers {
            handler(from.to_string(), bytes.to_vec());
        }
    }
}

impl MeshLike for InProcessMesh {
    fn client_id(&self) -> String {
        self.inner.client_id.clone()
    }

    fn connected_peers(&self) -> Vec<String> {
        self.inner
            .connections
            .lock()
            .expect("connections lock poisoned")
            .iter()
            .cloned()
            .collect()
    }

    fn send(&self, peer_id: &str, data: &[u8]) -> Result<(), String> {
        let is_connected = self
            .inner
            .connections
            .lock()
            .map_err(|_| "connections lock poisoned")?
            .contains(peer_id);

        if !is_connected {
            return Err(format!("{peer_id} is not connected"));
        }

        let peers = self
            .inner
            .network
            .peers
            .lock()
            .map_err(|_| "network lock poisoned")?;

        let target = peers
            .get(peer_id)
            .and_then(Weak::upgrade)
            .ok_or_else(|| format!("peer not found: {peer_id}"))?;

        let target_mesh = InProcessMesh { inner: target };
        target_mesh.deliver_from(&self.inner.client_id, data);
        Ok(())
    }
}
