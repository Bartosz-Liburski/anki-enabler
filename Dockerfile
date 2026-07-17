# Node 22 — matches the starter's .nvmrc (v22.14.0) and Astro 6's engine floor (>=22.12).
# Building/running here means the host's local Node version is irrelevant.
FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies first so this layer is cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci

# App source. In dev this is overlaid by a bind mount (see docker-compose.yml),
# but copying it keeps the image self-contained for build/preview without a mount.
COPY . .

# Astro dev server default port.
EXPOSE 4321

# Default command: dev server bound to all interfaces so it's reachable from the host.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
