FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json biome.json ./
COPY src ./src
RUN npm ci
RUN npm run build

FROM node:24-bookworm-slim
# Use the npm-distributed CLI for multi-arch compatibility (arm64/amd64).
RUN npm install -g @bitwarden/cli@2026.1.0

# Use the `node` user that already exists in the base image (uid/gid 1000).
RUN mkdir -p /app /data \
  && chown -R node:node /app /data
USER node
WORKDIR /app
ENV HOME=/data
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
CMD ["node", "dist/server.js"]
