# Headless Chromium PeerPigeon peers for testing a network and room.
#
#   docker build -t peerpigeon-browser-peers -f docker/browser-peers/Dockerfile .
#   docker run --rm -e PEERS=4 peerpigeon-browser-peers
#
# Each peer is a real browser tab running the vue3 example in its own browser
# context (its own storage, so its own peer ID), started with autostart.
# The image tag must match the @playwright/test version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.59.1-noble

# The lockfiles fetch freertc over git+ssh; a container has no SSH keys, so
# fetch GitHub over HTTPS instead.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
 && git config --global --add url."https://github.com/".insteadOf "git@github.com:"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
# Build PeerPigeon itself, then the example that imports it (file:../..).
# The tools run directly so the build uses the freertc pinned in the lockfile
# instead of re-syncing to freertc's head.
RUN npx tsup src/index.ts --format esm,cjs --dts
RUN cd examples/vue3 && npm ci --ignore-scripts --no-audit --no-fund && npx vite build

ENV PEERS=4 \
    NETWORK=network:test \
    ROOM=room-vsmtj78m \
    SIGNALING_SERVER=auto \
    MAX_PEERS=10 \
    PORT=5190 \
    STATUS_EVERY_S=10

CMD ["node", "docker/browser-peers/run.mjs"]
