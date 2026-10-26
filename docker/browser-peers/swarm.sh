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
#   FORCE=1                 skip the up-front estimate; start containers one at a
#                           time and stop when the next one would not fit
#   MAC_RESERVE_MB=4096     with FORCE=1: memory to keep free on the Mac for other things
#   SETTLE_S=15             with FORCE=1: longest wait for a container's peers to
#                           load before measuring it (it moves on as soon as they report)
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
MAC_RESERVE_MB=${MAC_RESERVE_MB:-4096}
SETTLE_S=${SETTLE_S:-15}
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

need_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "Docker isn't running. Start Docker Desktop (or OrbStack/Colima) and try again." >&2
    exit 1
  fi
}

# Memory macOS could hand out now, as macOS itself counts it: the
# "System-wide memory free percentage" behind Activity Monitor's memory
# pressure, which includes cache it frees on demand. (Counting only free and
# inactive pages said 4.4 GB on a 24 GB Mac that had far more to give.)
mac_available_mb() {
  local total_mb pct
  total_mb=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 / 1024 ))
  pct=$(memory_pressure 2>/dev/null | awk -F: '/free percentage/ { gsub(/[ %]/, "", $2); print $2 }')
  if [ -n "$pct" ] && [ "$total_mb" -gt 0 ]; then
    echo $((total_mb * pct / 100))
    return
  fi
  vm_stat 2>/dev/null | awk '
    /page size of/ { size = $8 }
    /Pages free/ || /Pages inactive/ || /Pages speculative/ || /Pages purgeable/ || /File-backed pages/ { gsub(/\./, "", $NF); pages += $NF }
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
      local fit_containers=$((fits / PEERS_PER_CONTAINER))
      if [ "$fit_containers" -lt 1 ]; then fit_containers=1; fi
      echo "The Mac doesn't have ${want_gb} GB free for Docker right now. Close apps, or run fewer peers, e.g. CONTAINERS=${fit_containers}." >&2
    fi
    echo "Or set FORCE=1 to start anyway (peers may be killed when Docker runs out)." >&2
    exit 1
  fi
  if [ "$total_peers" -gt $((docker_cpus * 4)) ]; then
    echo "Note: ${total_peers} peers on ${docker_cpus} CPUs; WebRTC handshakes may be slow."
  fi
}

# Memory the running swarm containers use now, in MB.
swarm_used_mb() {
  local ids
  ids=$(docker ps -q --filter "name=^${PREFIX}-[0-9]+$")
  [ -z "$ids" ] && { echo 0; return; }
  # shellcheck disable=SC2086
  docker stats --no-stream --format '{{.MemUsage}}' $ids | awk '
    { v = $1; n = v + 0; u = v; sub(/^[0-9.]+/, "", u)
      if (u == "GiB") n *= 1024; else if (u == "KiB") n /= 1024; else if (u == "B") n /= 1048576
      total += n }
    END { printf "%d", total }'
}

# With FORCE=1: may one more container start? Uses what the running ones
# really use, keeping Docker under 90% and MAC_RESERVE_MB free on the Mac.
room_for_another() {
  local started=$1 docker_mb=$2
  local used per docker_left mac_left
  used=$(swarm_used_mb)
  # (No ?: here: macOS's bash 3.2 evaluates both branches, and used / 0 fails.)
  per=$((PEERS_PER_CONTAINER * MB_PER_PEER + MB_PER_CONTAINER))
  if [ "$started" -gt 0 ] && [ $((used / started)) -ge 100 ]; then
    per=$((used / started))
  fi
  docker_left=$(( docker_mb * 90 / 100 - used ))
  mac_left=$(mac_available_mb)
  echo "  swarm uses ${used} MB (${per} MB per container); Docker has ${docker_left} MB to spare, the Mac ${mac_left} MB available"
  if [ "$per" -gt "$docker_left" ]; then
    echo "  stopping: another container (~${per} MB) would push Docker past 90% of its ${docker_mb} MB"
    return 1
  fi
  if [ "$mac_left" -gt 0 ] && [ $((mac_left - per)) -lt "$MAC_RESERVE_MB" ]; then
    echo "  stopping: another container would leave the Mac less than ${MAC_RESERVE_MB} MB free"
    return 1
  fi
  return 0
}

# Wait until a container's peers have loaded (its first status report) or
# SETTLE_S seconds pass, whichever is first.
wait_for_peers() {
  local name=$1 waited=0
  while [ "$waited" -lt "$SETTLE_S" ]; do
    if docker logs "$name" 2>&1 | grep -q 'connected '; then
      echo "  ${name}'s peers are up (${waited}s)"
      return
    fi
    if [ "$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null)" != "running" ]; then
      echo "  ${name} stopped: $(docker logs --tail 3 "$name" 2>&1 | tr '\n' ' ')"
      return
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "  ${name}'s peers haven't reported after ${SETTLE_S}s; measuring anyway"
}

up() {
  need_docker
  local docker_mb
  docker_mb=$(( $(docker info --format '{{.MemTotal}}') / 1024 / 1024 ))
  if [ "${FORCE:-0}" = "1" ]; then
    echo "FORCE=1: starting up to ${CONTAINERS} containers of ${PEERS_PER_CONTAINER} peers one at a time, while Docker (${docker_mb} MB) has room and the Mac keeps ${MAC_RESERVE_MB} MB free"
  else
    check_resources
  fi
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1 || [ "${REBUILD:-0}" = "1" ]; then
    echo "Building $IMAGE (first time takes a few minutes)..."
    docker build -t "$IMAGE" -f "$REPO_ROOT/docker/browser-peers/Dockerfile" "$REPO_ROOT"
  fi
  local started=0
  for i in $(seq 1 "$CONTAINERS"); do
    if [ "${FORCE:-0}" = "1" ]; then
      if [ "$started" -gt 0 ]; then
        wait_for_peers "${PREFIX}-$((i - 1))"
      fi
      room_for_another "$started" "$docker_mb" || break
    fi
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
    started=$((started + 1))
  done
  echo
  echo "Running ${started} container(s), $((started * PEERS_PER_CONTAINER)) peers."
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
