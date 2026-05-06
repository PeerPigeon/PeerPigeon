use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub struct ConnectedEvent {
    pub client_id: String,
    pub requested_client_id: String,
    pub previous_client_id: String,
}

#[derive(Debug, Clone)]
pub struct JoinedEvent {
    pub session_id: String,
    pub clients: Vec<String>,
}

pub struct Adapter {
    pub url: String,
    pub network_id: String,
    pub peer_id: String,
    connected_handlers: Mutex<Vec<Arc<dyn Fn(ConnectedEvent) + Send + Sync>>>,
}

impl Adapter {
    pub fn new(url: impl Into<String>, network_id: impl Into<String>, peer_id: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            network_id: network_id.into(),
            peer_id: peer_id.into(),
            connected_handlers: Mutex::new(Vec::new()),
        }
    }

    pub fn on_connected(&self, handler: impl Fn(ConnectedEvent) + Send + Sync + 'static) {
        self.connected_handlers
            .lock()
            .expect("handlers lock poisoned")
            .push(Arc::new(handler));
    }

    pub fn connect(&self) {
        let event = ConnectedEvent {
            client_id: self.peer_id.clone(),
            requested_client_id: self.peer_id.clone(),
            previous_client_id: String::new(),
        };

        let handlers = self
            .connected_handlers
            .lock()
            .expect("handlers lock poisoned")
            .clone();

        for handler in handlers {
            handler(event.clone());
        }
    }

    pub fn join_session(&self, _session_id: &str) {}
    pub fn disconnect(&self) {}
}
