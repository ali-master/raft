# @usex/kv-server

## Overview

`@usex/kv-server` is a distributed, fault-tolerant Key-Value (KV) server. It is built using the [NestJS](https://nestjs.com/) framework (with the Fastify adapter for performance) and leverages the [`@usex/raft`](../raft/README.md) library to achieve consensus and data replication across multiple nodes.

This server provides an HTTP API for basic GET, PUT, and DELETE operations on key-value pairs. It emphasizes robustness and data security through features like value encryption and a clear separation of concerns using the CQRS pattern for write operations. It is designed with enterprise considerations in mind, providing a foundation for a reliable distributed KV store.

## Features

*   **Distributed KV Store:** Utilizes the Raft consensus algorithm via `@usex/raft` for strong consistency and fault tolerance across a cluster of nodes.
*   **Value Encryption:** All values are encrypted at rest using AES-256-GCM, ensuring data confidentiality within the Raft log and state machine.
*   **CQRS for Writes:** Employs the Command Query Responsibility Segregation (CQRS) pattern for handling write operations (SET, DELETE), promoting a clean architecture.
*   **HTTP API:** Exposes a simple and intuitive HTTP interface (using Fastify) for key-value operations.
*   **Health Check Endpoints:** Includes `/health`, `/live`, and `/ready` endpoints for monitoring service status and integration with orchestration platforms like Kubernetes.
*   **Configurable:** Easily configured through environment variables for ports, Raft settings, encryption keys, and more.

## Prerequisites

*   **Node.js:** Version 18.x or higher recommended.
*   **pnpm:** (Recommended) Or npm/yarn for dependency management.
*   **Redis:** Required by the underlying `@usex/raft` library for its persistence layer (e.g., storing Raft log metadata, snapshots if not purely file-based in Raft) and potentially for peer discovery mechanisms.
*   **@usex/raft Package:** This server depends on the local `@usex/raft` package. Ensure it is built and accessible within the monorepo (e.g., via `pnpm install` which should link workspace packages).

## Getting Started / Setup

1.  **Clone Repository:** If you haven't already, clone the main repository containing this package.
2.  **Navigate to Package:** Change directory to `packages/kv-server`.
3.  **Install Dependencies:**
    ```bash
    pnpm install
    ```
    (Or `npm install` / `yarn install` if you are using those package managers). This will also link the local `@usex/raft` package.

4.  **Environment Configuration:**
    The server is configured using environment variables. You can set these directly in your shell or create a `.env` file in the `packages/kv-server` directory.
    Refer to the `.env.example` file in this package for a comprehensive list of all required and optional variables.

    **Crucial variables to configure:**
    *   `PORT`: The HTTP port for the KV server API (e.g., `3000`).
    *   `RAFT_NODE_ID`: A unique ID for each node in the Raft cluster (e.g., `kvnode1`, `kvnode2`).
    *   `RAFT_HTTP_PORT`: The internal port used by the Raft library for communication between nodes (e.g., `4001`, `4002`). **Must be unique per node.**
    *   `RAFT_PEERS`: A comma-separated list of other Raft nodes in the cluster, in `host:RAFT_HTTP_PORT` format (e.g., `"kvnode2:4002,kvnode3:4003"`). Leave empty for a single-node setup.
    *   `RAFT_DATA_DIR`: Path to a directory where the Raft log, snapshots, and other persistent data will be stored. **Must be unique per node.** (e.g., `./data/kvnode1`).
    *   `REDIS_HOST`: Hostname for your Redis instance.
    *   `KV_ENCRYPTION_KEY`: A 32-byte secret key for encrypting and decrypting values. This can be a 32-character UTF-8 string or a 64-character hexadecimal string. **Must be the same for all nodes in the cluster.**

5.  **Building the Server:**
    To create a production build:
    ```bash
    pnpm run build
    ```
    Output will be in the `dist` directory.

6.  **Running the Server:**
    *   For development with auto-reloading:
        ```bash
        pnpm run start:dev
        ```
    *   To run the production build:
        ```bash
        pnpm run start
        ```

## Running a Local Cluster (Example)

To run a 3-node Raft cluster locally, you'll need three separate terminals. Each instance requires a unique `PORT` (for its API), `RAFT_NODE_ID`, `RAFT_HTTP_PORT` (for Raft communication), and `RAFT_DATA_DIR`. The `KV_ENCRYPTION_KEY` must be identical for all nodes. `RAFT_PEERS` should list the *other* nodes in the cluster.

**Terminal 1 (Node 1):**
```bash
export PORT=3000
export RAFT_NODE_ID=kvnode1
export RAFT_HTTP_PORT=4001
export RAFT_PEERS="localhost:4002,localhost:4003" # Points to Raft ports of node2 and node3
export RAFT_DATA_DIR=./data/kvnode1
export KV_ENCRYPTION_KEY="your_super_secret_32_byte_key_!!" # Must be 32 bytes
export REDIS_HOST=localhost # Assuming a shared Redis instance for local development
# Set other REDIS variables if needed (REDIS_PORT, REDIS_PASSWORD)

pnpm run start:dev
```

**Terminal 2 (Node 2):**
```bash
export PORT=3001
export RAFT_NODE_ID=kvnode2
export RAFT_HTTP_PORT=4002
export RAFT_PEERS="localhost:4001,localhost:4003" # Points to Raft ports of node1 and node3
export RAFT_DATA_DIR=./data/kvnode2
export KV_ENCRYPTION_KEY="your_super_secret_32_byte_key_!!" # Same key
export REDIS_HOST=localhost

pnpm run start:dev
```

**Terminal 3 (Node 3):**
```bash
export PORT=3002
export RAFT_NODE_ID=kvnode3
export RAFT_HTTP_PORT=4003
export RAFT_PEERS="localhost:4001,localhost:4002" # Points to Raft ports of node1 and node2
export RAFT_DATA_DIR=./data/kvnode3
export KV_ENCRYPTION_KEY="your_super_secret_32_byte_key_!!" # Same key
export REDIS_HOST=localhost

pnpm run start:dev
```

Ensure that the `RAFT_DATA_DIR` paths are unique for each node to prevent data corruption. The `KV_ENCRYPTION_KEY` must be identical across all nodes that form the same KV cluster.

## API Endpoints

### Set/Update Key-Value Pair
*   **Endpoint:** `PUT /kv/:key`
*   **Description:** Sets or updates the value for a given key. The provided value is encrypted before being stored in the distributed log.
*   **Request Body:** `application/json`
    ```json
    {
      "value": "your string value"
    }
    ```
*   **Responses:**
    *   `204 No Content`: On successful acceptance of the command by the Raft leader.
    *   `400 Bad Request`: If the key format is invalid or the request body is malformed (e.g., missing `value`).
    *   `421 Misdirected Request` / `503 Service Unavailable`: If the contacted node is not the Raft leader, or if the Raft cluster is unable to process the request at this time.

### Get Key-Value Pair
*   **Endpoint:** `GET /kv/:key`
*   **Description:** Retrieves the decrypted value for a specified key. Reads are performed from the local state machine of the queried node, providing eventually consistent data (or strongly consistent if the node is the leader and has recently confirmed its leadership).
*   **Responses:**
    *   `200 OK`: With a JSON body:
        ```json
        {
          "key": "yourkey",
          "value": "decrypted string value"
        }
        ```
    *   `404 Not Found`: If the key does not exist in the store.

### Delete Key-Value Pair
*   **Endpoint:** `DELETE /kv/:key`
*   **Description:** Deletes a key and its associated value from the store. This operation is replicated via the Raft log.
*   **Responses:**
    *   `204 No Content`: On successful acceptance of the command by the Raft leader.
    *   `400 Bad Request`: If the key format is invalid.
    *   `421 Misdirected Request` / `503 Service Unavailable`: If the contacted node is not the Raft leader, or if the Raft cluster is unable to process the request.

### Health Checks
*   **`GET /health`**: Provides a comprehensive health status of the node, including Raft-specific details. Returns HTTP `200` if `overallStatus` is 'HEALTHY', otherwise `503`.
*   **`GET /live`**: A liveness probe, typically indicating if the server process is running and the Raft node is initialized. Returns HTTP `200` or `503`.
*   **`GET /ready`**: A readiness probe, indicating if the server is ready to accept traffic (e.g., Raft node is part of a quorum). Returns HTTP `200` or `503`.

## Architecture Overview (Brief)

*   **Framework:** Built with [NestJS](https://nestjs.com/) using the [Fastify](https://www.fastify.io/) adapter for high-performance HTTP handling.
*   **Consensus:** Uses the [`@usex/raft`](../raft/README.md) library for distributed consensus. The `KvStoreService` implements the `StateMachine` interface required by the Raft library, applying committed log entries to an in-memory store.
*   **CQRS:** Write operations (SET, DELETE) follow the Command Query Responsibility Segregation pattern. Commands are dispatched via a `CommandBus` to dedicated handlers, which then interact with the `RaftIntegrationService` to propose changes to the Raft log. Read operations (GET) directly query the local `KvStoreService`.
*   **Encryption:** Values are encrypted at rest within the Raft log and state machine using AES-256-GCM via the `EncryptionService`.

## Encryption

Values stored in the KV server are encrypted using the AES-256-GCM algorithm. This ensures that the data is confidential even if the underlying storage (Raft logs, snapshots) is accessed directly.

*   **Algorithm:** AES-256-GCM
*   **Key Management:** The encryption key is specified via the `KV_ENCRYPTION_KEY` environment variable.
    *   It **must** be a 32-byte secret. This can be provided as a 32-character UTF-8 string or a 64-character hexadecimal string.
    *   This key **must be identical** across all nodes forming the KV cluster to ensure data can be correctly replicated and recovered.
    *   **Security Note:** Proper management and protection of this encryption key are critical. Using a dedicated secrets management system is recommended for production environments.
*   **Implementation:** An Initialization Vector (IV) is randomly generated for each encryption operation. The IV and the GCM authentication tag are stored alongside the ciphertext (typically in a format like `iv:authtag:ciphertext`) to enable decryption.

## Configuration Details

The server uses environment variables for configuration, managed via `@nestjs/config`. Refer to the `.env.example` file in this package for a complete list of configurable parameters, including those for Raft, Redis, server ports, and encryption.

## Development

*   **Running Tests:**
    ```bash
    pnpm run test
    ```
    This will execute unit and E2E tests for the `kv-server`.

## License

This project is licensed under the MIT License. (Assuming MIT, update if different).
