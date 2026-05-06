#[derive(Debug, Clone, Default)]
pub struct Options {
    pub initiator: bool,
    pub trickle_ice: bool,
}

#[derive(Debug, Clone)]
pub struct Signal {
    pub kind: String,
    pub payload: String,
}

pub struct RtcPeer {
    pub options: Options,
}

impl RtcPeer {
    pub fn new(options: Options) -> Self {
        Self { options }
    }

    pub fn signal(&self, _signal: Signal) -> Result<(), String> {
        Ok(())
    }

    pub fn send(&self, _data: &[u8]) -> Result<(), String> {
        Ok(())
    }

    pub fn destroy(&self) {}
}
