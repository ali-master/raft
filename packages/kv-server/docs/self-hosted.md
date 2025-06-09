<div style="display: flex; justify-content: space-between; align-items: center;">
  <h1>Self-Hosting the Raft KV Server</h1>
  <img src="../../../assets/kv-server-logo.svg" alt="KV Server Logo" width="120" align="right" />
</div>

## Overview

The Raft KV Server is designed for easy self-hosting in any environment—local, Docker, or Kubernetes. This guide covers best practices for running your own distributed, secure, and highly available key-value store.

## 1. Local Self-Hosting

- Follow the [Installation Guide](./installation.md) to run locally with Node.js and pnpm.
- Use `.env` for configuration.
- Suitable for development, testing, and small-scale deployments.

## 2. Docker Self-Hosting

- Build and run the Docker image as described in the [Installation Guide](./installation.md).
- Use Docker Compose for multi-node clusters.
- Recommended for most production and staging environments.

## 3. Kubernetes Self-Hosting

- See [deployment.md](./deployment.md) for a full production-grade setup.
- Use StatefulSets for stable network identities and persistent storage.
- Integrate with Kubernetes secrets for secure key management.

## 4. Production Best Practices

- **Security:**
  - Use strong, unique `ENCRYPTION_KEY` values.
  - Restrict API access with firewalls or ingress rules.
  - Enable HTTPS/SSL termination at the load balancer or ingress.
- **Scaling:**
  - Deploy at least 3 nodes for Raft consensus.
  - Use health checks and readiness probes for orchestration.
- **Monitoring:**
  - Enable Prometheus metrics (see [development.md](./development.md)).
  - Use centralized logging (e.g., ELK, Loki).
- **Backups:**
  - Regularly snapshot persistent volumes (Kubernetes) or bind mounts (Docker).

## 5. Branding & Customization

- The KV Server logo and brand assets are available in the `assets/` directory.
- You may use the logo in your dashboards, documentation, or internal tools.

---

For advanced deployment scenarios, see the [deployment guide](./deployment.md) and [architecture docs](./architecture.md).
