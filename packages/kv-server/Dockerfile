FROM oven/bun:1.4.3 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/raft/package.json ./packages/raft/
COPY packages/nest/package.json ./packages/nest/
COPY packages/kv-server/package.json ./packages/kv-server/
COPY packages/kv-server-sdk/package.json ./packages/kv-server-sdk/
COPY packages/raft/playground/package.json ./packages/raft/playground/
COPY packages/nest/playground/package.json ./packages/nest/playground/

FROM base AS builder
RUN bun install --frozen-lockfile
COPY . .
RUN bun run --filter @usex/raft build && bun run --filter @usex/raft-kv-server build

FROM base AS production-dependencies
RUN bun install --production --frozen-lockfile --ignore-scripts --filter '@usex/raft-kv-server...'

FROM production-dependencies AS production
COPY --from=builder /app/packages/raft/dist ./packages/raft/dist
COPY --from=builder /app/packages/kv-server/dist ./packages/kv-server/dist
ENV PORT=3000
RUN mkdir -p /app/data/raft && chown -R bun:bun /app/data
ENV NODE_ENV=production
USER bun
EXPOSE 3000
CMD ["bun", "packages/kv-server/dist/main.js"]
