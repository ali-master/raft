# Build stage
FROM node:23.11-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY packages/kv-server/package.json ./packages/kv-server/
COPY packages/raft/package.json ./packages/raft/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm --filter @usex/raft-kv-server build

# Production stage
FROM node:23.11-alpine AS production

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# Set working directory
WORKDIR /app

# Copy package files and built assets
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/kv-server/package.json ./packages/kv-server/
COPY --from=builder /app/packages/raft/package.json ./packages/raft/
COPY --from=builder /app/packages/kv-server/dist ./packages/kv-server/dist
COPY --from=builder /app/packages/raft/dist ./packages/raft/dist

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "packages/kv-server/dist/main"]
