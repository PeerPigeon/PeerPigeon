use peerpigeon_rs::gossip::{GossipProtocol, Options as GossipOptions};
use peerpigeon_rs::mesh::InProcessNetwork;
use peerpigeon_rs::storage::{PeerPigeonStorage, Space, StorageOptions};
use serde_json::json;
use std::sync::Arc;

fn main() -> anyhow::Result<()> {
    let network = InProcessNetwork::new();
    let mesh_a = network.create_mesh("peer-a");
    let mesh_b = network.create_mesh("peer-b");
    network.connect("peer-a", "peer-b").map_err(anyhow::Error::msg)?;

    let gossip_a = Arc::new(GossipProtocol::new(
        Arc::new(mesh_a.clone()),
        GossipOptions {
            max_hops: 6,
            max_direct_hops: 20,
        },
    ));
    let gossip_b = Arc::new(GossipProtocol::new(
        Arc::new(mesh_b.clone()),
        GossipOptions {
            max_hops: 6,
            max_direct_hops: 20,
        },
    ));

    {
        let gossip_a_clone = Arc::clone(&gossip_a);
        mesh_a.on_data(move |from, data| {
            gossip_a_clone.handle_raw(&from, &data);
        });
    }
    {
        let gossip_b_clone = Arc::clone(&gossip_b);
        mesh_b.on_data(move |from, data| {
            gossip_b_clone.handle_raw(&from, &data);
        });
    }

    gossip_a.on_message_received(|event| {
        println!(
            "[a] message {} from {} local={} data={}",
            event.message.id, event.message.sender, event.local, event.message.data
        );
    });
    gossip_b.on_message_received(|event| {
        println!(
            "[b] message {} from {} local={} data={}",
            event.message.id, event.message.sender, event.local, event.message.data
        );
    });

    let storage_a = PeerPigeonStorage::new(StorageOptions {
        user_id: "rust-user-a".to_string(),
        session_id: "peerpigeon-example-rust".to_string(),
        sync_secret: "example-secret-change-me".to_string(),
    })?;

    storage_a.on_change(|event| {
        println!(
            "[storage-a] origin={:?} op={} key={}",
            event.origin, event.op, event.key
        );
    });

    let record = storage_a.put(Space::Public, "heartbeat", json!({"count": 1, "from": "peer-a"}))?;
    let payload = storage_a.make_local_mutation_payload(
        "upsert",
        Some(record),
        Space::Public,
        "heartbeat",
    );

    gossip_a.broadcast(payload, None);
    gossip_a.broadcast(json!("hello from rust peer-a"), None);
    gossip_b.send_direct("peer-a", json!({"dm": "hi from peer-b"}));

    Ok(())
}
