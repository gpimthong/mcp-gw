FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ libvips-dev \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN npm run build && npm prune --omit=dev

# Download the embedding model into the image at build time
# so the container works on isolated networks with no internet access.
RUN MODEL_CACHE_DIR=/app/model-cache node scripts/download-model.mjs

FROM node:22-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/model-cache ./model-cache
COPY package.json ./
COPY public ./public
COPY config ./config
EXPOSE 3000
ENV NODE_ENV=production
# Point the embedder at the baked-in model cache.
# The runtime data dir (RAG stores) still goes to the mounted ./data volume.
ENV MODEL_CACHE_DIR=/app/model-cache
CMD ["node", "dist/index.js"]
