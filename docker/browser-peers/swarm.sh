#!/usr/bin/env bash
# Start PeerPigeon browser peers in containers, each container on its own
# Docker network (its own bridge and NAT). Default: 50 peers across 10
# networks, 5 per network, all in one PeerPigeon network/room.
#
#   docker/browser-peers/swarm.sh up      build the image if needed, start the swarm
#   docker/browser-peers/swarm.sh status  each container's latest status line
#   docker/browser-peers/swarm.sh logs N  follow container N's log
#   docker/browser-peers/swarm.sh down    stop and remove the containers and networks
#
# Settings (environment):
#   CONTAINERS=10           containers, each on its own Docker network
#   PEERS_PER_CONTAINER=5   browser peers inside each container (one Chromium, one tab each)
#   NETWORK=network:test    PeerPigeon network
#   ROOM=room-vsmtj78m      PeerPigeon room
#   SIGNALING_SERVER=auto   or wss://decentralize.ooo/ws, or ws://host.docker.internal:8788/ws
#   MAX_PEERS=10            each peer's connection limit
#   MB_PER_PEER=220         memory per browser tab, for the resource check
#   MB_PER_CONTAINER=300    memory per container (Chromium itself + Node), for the check
#   SEPARATE_ROOMS=1        put each container's peers in their own PeerPigeon
#                           network instead (NETWORK-1, NETWORK-2, ...)
#   FORCE=1                 start even if the resource check says no
set -euo pipefail

IMAGE=peerpigeon-browser-peers
PREFIX=pp-swarm
CONTAINERS=${CONTAINERS:-10}
PEERS_PER_CONTAINER=${PEERS_PER_CONTAINER:-5}
NETWORK=${NETWORK:-network:test}
ROOM=${ROOM:-room-vsmtj78m}
SIGNALING_SERVER=${SIGNALING_SERVER:-auto}
MAX_PEERS=${MAX_PEERS:-10}
MB_PER_PEER=${MB_PER_PEER:-220}
MB_PER_CONTAINER=${MB_PER_CONTAINER:-300}
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

need_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "Docker isn't running. Start Docker Desktop (or OrbStack/Colima) and try again." >&2
    exit 1
  fi
}

# Memory macOS could hand out now: free, inactive, speculative and purgeable pages.
mac_available_mb() {
  vm_stat 2>/dev/null | awk '
    /page size of/ { size = $8 }
    /Pages free/ || /Pages inactive/ || /Pages speculative/ || /Pages purgeable/ { gsub(/\./, "", $NF); pages += $NF }
    END { if (size) printf "%d", pages * size / 1048576; else print 0 }'
}

check_resources() {
  local total_peers=$((CONTAINERS * PEERS_PER_CONTAINER))
  local need_mb=$((total_peers * MB_PER_PEER + CONTAINERS * MB_PER_CONTAINER))
  local docker_mb=$(( $(docker info --format '{{.MemTotal}}') / 1024 / 1024 ))
  local docker_cpus
  docker_cpus=$(docker info --format '{{.NCPU}}')
  local mac_mb=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 / 1024 ))
  local mac_free_mb
  mac_free_mb=$(mac_available_mb)
  echo "Swarm: ${CONTAINERS} containers x ${PEERS_PER_CONTAINER} peer(s) = ${total_peers} browser peers, about ${need_mb} MB."
  echo "This Mac: ${mac_mb} MB total, ${mac_free_mb} MB available now."
  echo "Docker:   ${docker_mb} MB and ${docker_cpus} CPUs. Containers can't use more than this, whatever the Mac has free."
  if [ "${FORCE:-0}" = "1" ]; then return; fi
  if [ "$need_mb" -gt $((docker_mb * 85 / 100)) ]; then
    local fits=$(( (docker_mb * 85 / 100) / (MB_PER_PEER + MB_PER_CONTAINER / PEERS_PER_CONTAINER) ))
    local want_gb=$(( (need_mb * 100 / 85 + 1023) / 1024 ))
    echo >&2
    echo "Docker's ${docker_mb} MB fits about ${fits} of these peers." >&2
    if [ "$mac_free_mb" -gt 0 ] && [ $((want_gb * 1024)) -le $((docker_mb + mac_free_mb)) ]; then
      echo "This Mac has room: set Docker Desktop > Settings > Resources > Memory limit to ${want_gb} GB, Apply & restart, then run this again." >&2
    else
      echo "The Mac doesn't have ${want_gb} GB free for Docker right now. Close apps, or run fewer peers, e.g. CONTAINERS=$(( fits / PEERS_PER_CONTAINER > 0 ? fits / PEERS_PER_CONTAINER : 1 ))." >&2
    fi
    echo "Or set FORCE=1 to start anyway (peers may be killed when Docker runs out)." >&2
    exit 1
  fi
  if [ "$total_peers" -gt $((docker_cpus * 4)) ]; then
    echo "Note: ${total_peers} peers on ${docker_cpus} CPUs; WebRTC handshakes may be slow."
  fi
}

up() {
  need_docker
  check_resources
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1 || [ "${REBUILD:-0}" = "1" ]; then
    echo "Building $IMAGE (first time takes a few minutes)..."
    docker build -t "$IMAGE" -f "$REPO_ROOT/docker/browser-peers/Dockerfile" "$REPO_ROOT"
  fi
  for i in $(seq 1 "$CONTAINERS"); do
    local name="${PREFIX}-${i}"
    local pp_network="$NETWORK"
    [ "${SEPARATE_ROOMS:-0}" = "1" ] && pp_network="${NETWORK}-${i}"
    docker network inspect "${name}-net" >/dev/null 2>&1 || docker network create "${name}-net" >/dev/null
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker run -d --name "$name" --network "${name}-net" \
      --add-host host.docker.internal:host-gateway \
      --shm-size=1g \
      -e PEERS="$PEERS_PER_CONTAINER" -e NETWORK="$pp_network" -e ROOM="$ROOM" \
      -e SIGNALING_SERVER="$SIGNALING_SERVER" -e MAX_PEERS="$MAX_PEERS" \
      "$IMAGE" >/dev/null
    echo "started $name on Docker network ${name}-net: ${PEERS_PER_CONTAINER} peers in ${pp_network} / ${ROOM}"
  done
  echo
  echo "Watch them:  $0 status   (or: $0 logs 1)"
  echo "Stop them:   $0 down"
}

status() {
  need_docker
  for name in $(docker ps -a --filter "name=^${PREFIX}-[0-9]+$" --format '{{.Names}}' | sort -t- -k3 -n); do
    local state line
    state=$(docker inspect -f '{{.State.Status}}' "$name")
    line=$(docker logs --tail 50 "$name" 2>&1 | grep -E 'connected|error|unavailable' | tail -n "$PEERS_PER_CONTAINER" | sed 's/^ *//' | paste -sd ';' -)
    echo "$name [$state] ${line:-starting...}"
  done
  docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' $(docker ps -q --filter "name=^${PREFIX}-") 2>/dev/null | sort -t- -k3 -n | sed 's/^/  /'
}

logs() {
  need_docker
  docker logs -f "${PREFIX}-${1:-1}"
}

down() {
  need_docker
  docker rm -f $(docker ps -aq --filter "name=^${PREFIX}-[0-9]+$") >/dev/null 2>&1 || true
  docker network rm $(docker network ls -q --filter "name=^${PREFIX}-[0-9]+-net$") >/dev/null 2>&1 || true
  echo "swarm stopped and removed"
}

case "${1:-up}" in
  up) up ;;
  status) status ;;
  logs) logs "${2:-1}" ;;
  down) down ;;
  *) echo "usage: $0 up|status|logs N|down" >&2; exit 2 ;;
esac
