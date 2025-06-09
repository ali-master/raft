# Installation Guide: Raft KV Server

## Prerequisites

- **Node.js** >= 18.12.0
- **pnpm** >= 10.11.1
- **Docker** (optional, for containerized deployment)
- **Kubernetes** (optional, for orchestration)

## 1. Local Installation

### Clone the Repository

```bash
git clone https://github.com/ali-master/raft.git
cd raft/packages/kv-server
```

### Install Dependencies

```bash
pnpm install
```

### Configure Environment

Create a `.env` file in the root of `packages/kv-server`:

```env
PORT=3000
NODE_ENV=development
ENCRYPTION_KEY=your-secure-encryption-key
CORS_ORIGIN=*
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
```

### Build and Start

```bash
pnpm build
pnpm start:dev # For development
# or
pnpm start:prod # For production
```

## 2. Docker Installation

### Build Docker Image

```bash
docker build -t raft-kv-server .
```

### Run Container

```bash
docker run -p 3000:3000 --env-file .env raft-kv-server
```

### Docker Compose (Multi-Node Example)

See the `README.md` for a sample `docker-compose.yml`.

## 3. Kubernetes Installation

See [`deployment.md`](./deployment.md) for a full Kubernetes deployment guide.

## Troubleshooting

- Ensure all environment variables are set correctly.
- Check logs for errors: `pnpm start:dev` or `docker logs <container>`
- For port conflicts, change the `PORT` in your `.env` file.

---

For advanced configuration, see the [Configuration section](../README.md#configuration).
