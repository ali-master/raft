import type Redis from "ioredis";
import { performance } from "node:perf_hooks";
import type {
  VoteResponse,
  VoteRequest,
  TimeoutNowRequest,
  RaftConfiguration,
  PreVoteResponse,
  PreVoteRequest,
  InstallSnapshotResponse,
  InstallSnapshotRequest,
  AppendEntriesResponse,
  AppendEntriesRequest,
} from "../types";
import { MessageType } from "../constants";
import { RaftNetworkException } from "../exceptions";
import type { RaftLogger, PeerDiscoveryService } from "../services";
import type { RaftMetricsCollector } from "../monitoring";

type CircuitBreakerState = "closed" | "open" | "half-open";

interface PeerHealth {
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  state: CircuitBreakerState;
  adaptiveTimeout: number;
}

export class RaftNetwork {
  private readonly config: RaftConfiguration;
  private readonly logger: RaftLogger;
  private readonly peerDiscovery: PeerDiscoveryService;
  private readonly metrics: RaftMetricsCollector;
  private readonly redis: Redis;
  private isShutdown = false;
  private shutdownCallbacks: Set<() => void> = new Set();
  private readonly peerHealth = new Map<string, PeerHealth>();

  private static readonly BASE_TIMEOUT_MS = 2000;
  private static readonly MAX_ADAPTIVE_TIMEOUT_MS = 10000;
  private static readonly DEAD_PEER_FAILURE_MULTIPLIER = 3;

  constructor(
    config: RaftConfiguration,
    _retry: unknown,
    logger: RaftLogger,
    peerDiscovery: PeerDiscoveryService,
    metrics: RaftMetricsCollector,
    redis: Redis,
  ) {
    this.config = config;
    this.logger = logger;
    this.peerDiscovery = peerDiscovery;
    this.metrics = metrics;
    this.redis = redis;
  }

  public initializeCircuitBreakers(): void {
    const peerIds = this.peerDiscovery.getPeers();
    for (const peerId of peerIds) {
      if (!this.peerHealth.has(peerId)) {
        this.peerHealth.set(peerId, this.createDefaultHealth());
      }
    }
    this.logger.info("Circuit breakers initialized", {
      peerCount: peerIds.length,
      nodeId: this.config.nodeId,
    });
  }

  public async sendVoteRequest(
    targetNodeId: string,
    request: VoteRequest,
  ): Promise<VoteResponse> {
    return this.sendMessage(targetNodeId, MessageType.VOTE_REQUEST, request);
  }

  public async sendTimeoutNowRequest(
    targetNodeId: string,
    request: TimeoutNowRequest,
  ): Promise<void> {
    await this.sendMessage(
      targetNodeId,
      MessageType.TIMEOUT_NOW_REQUEST,
      request,
    );
  }

  public async sendPreVoteRequest(
    targetNodeId: string,
    request: PreVoteRequest,
  ): Promise<PreVoteResponse> {
    return this.sendMessage(
      targetNodeId,
      MessageType.PRE_VOTE_REQUEST,
      request,
    );
  }

  public async sendInstallSnapshot(
    targetNodeId: string,
    request: InstallSnapshotRequest,
  ): Promise<InstallSnapshotResponse> {
    return this.sendMessage(
      targetNodeId,
      MessageType.INSTALL_SNAPSHOT,
      request,
    );
  }

  public async sendAppendEntries(
    targetNodeId: string,
    request: AppendEntriesRequest,
  ): Promise<AppendEntriesResponse> {
    return this.sendMessage(targetNodeId, MessageType.APPEND_ENTRIES, request);
  }

  private async sendMessage<T>(
    targetNodeId: string,
    messageType: MessageType,
    payload: object,
  ): Promise<T> {
    if (this.isShutdown) {
      throw new RaftNetworkException("Network is shut down");
    }

    // Fast-fail if circuit breaker is open for this peer
    this.checkCircuitBreaker(targetNodeId);

    const startTime = performance.now();
    let shutdownCb: (() => void) | undefined;

    try {
      // Check if target exists
      const peerInfo = this.peerDiscovery.getPeerInfo(targetNodeId);
      if (!peerInfo) {
        throw new Error(`Peer not found: ${targetNodeId}`);
      }

      const requestId = `${this.config.nodeId}-${Date.now()}-${Math.random()}`;
      const responseKey = `raft:cluster:${this.config.clusterId}:responses:${this.config.nodeId}:${requestId}`;
      const targetQueueKey = `raft:cluster:${this.config.clusterId}:queue:${targetNodeId}`;

      const message = {
        from: this.config.nodeId,
        to: targetNodeId,
        type: messageType,
        payload,
        requestId,
        timestamp: Date.now(),
      };

      this.logger.info("NETWORK: Sending message", {
        from: this.config.nodeId,
        to: targetNodeId,
        type: messageType,
        requestId,
        targetQueue: targetQueueKey,
        responseKey,
      });

      // Send a message to target queue
      await this.redis.lpush(targetQueueKey, JSON.stringify(message));
      await this.redis.expire(targetQueueKey, 60);

      if (this.isShutdown) {
        throw new RaftNetworkException("Network is shut down");
      }

      this.logger.info("NETWORK: Message queued, waiting for response", {
        from: this.config.nodeId,
        to: targetNodeId,
        requestId,
      });

      // Create a shutdown-cancellable brpop: race between the actual brpop
      // and a shutdown signal so pending sends resolve immediately on stop
      const shutdownPromise = new Promise<null>((resolve) => {
        if (this.isShutdown) {
          resolve(null);
          return;
        }
        shutdownCb = () => resolve(null);
        this.shutdownCallbacks.add(shutdownCb);
      });

      const result = await Promise.race([
        this.redis.brpop(responseKey, 2),
        shutdownPromise,
      ]);

      if (this.isShutdown) {
        await this.redis.del(responseKey).catch(() => {});
        throw new RaftNetworkException("Network is shut down");
      }

      if (!result) {
        this.logger.error("NETWORK: Timeout waiting for response", {
          from: this.config.nodeId,
          to: targetNodeId,
          type: messageType,
          requestId,
          timeout: 2000,
        });
        throw new Error(
          `Request timeout - no response from ${targetNodeId} after 2s`,
        );
      }

      const responseData = JSON.parse(result[1]);

      this.logger.info("NETWORK: Response received", {
        from: this.config.nodeId,
        to: targetNodeId,
        type: messageType,
        requestId,
        latency: performance.now() - startTime,
        response: responseData.payload,
      });

      // Clean up response key
      await this.redis.del(responseKey).catch(() => {});

      const latency = performance.now() - startTime;

      // Record metrics
      this.metrics.observeHistogram(
        "raft_network_latency_seconds",
        {
          node_id: this.config.nodeId,
          cluster_id: this.config.clusterId,
          target_node: targetNodeId,
        },
        latency / 1000,
      );

      // Track successful communication
      this.recordSuccess(targetNodeId);

      return responseData.payload;
    } catch (error) {
      if (this.isShutdown) {
        throw new RaftNetworkException("Network is shut down");
      }

      // Track failure for circuit breaker
      this.recordFailure(targetNodeId);

      const latency = performance.now() - startTime;

      this.logger.error("NETWORK: Message send failed", {
        targetNodeId,
        messageType,
        error: error instanceof Error ? error.message : String(error),
        latency,
        nodeId: this.config.nodeId,
      });

      throw new RaftNetworkException(`Network error: ${error}`);
    } finally {
      if (shutdownCb) {
        this.shutdownCallbacks.delete(shutdownCb);
      }
    }
  }

  public updateCircuitBreakers(): void {
    const peerIds = this.peerDiscovery.getPeers();
    const activePeerIds = new Set(peerIds);

    // Add entries for newly discovered peers
    for (const peerId of peerIds) {
      if (!this.peerHealth.has(peerId)) {
        this.peerHealth.set(peerId, this.createDefaultHealth());
      }
    }

    // Remove entries for peers no longer in discovery
    for (const peerId of this.peerHealth.keys()) {
      if (!activePeerIds.has(peerId)) {
        this.peerHealth.delete(peerId);
      }
    }
  }

  public resetCircuitBreakers(): void {
    for (const peerId of this.peerHealth.keys()) {
      this.peerHealth.set(peerId, this.createDefaultHealth());
    }
    this.logger.info("All circuit breakers reset", {
      peerCount: this.peerHealth.size,
      nodeId: this.config.nodeId,
    });
  }

  public getConnectionHealth(peerId: string): {
    isHealthy: boolean;
    consecutiveFailures: number;
    adaptiveTimeout: number;
  } {
    const health = this.peerHealth.get(peerId);
    if (!health) {
      return {
        isHealthy: true,
        consecutiveFailures: 0,
        adaptiveTimeout: RaftNetwork.BASE_TIMEOUT_MS,
      };
    }
    return {
      isHealthy: health.state === "closed",
      consecutiveFailures: health.consecutiveFailures,
      adaptiveTimeout: health.adaptiveTimeout,
    };
  }

  public markPeerAsRecovered(peerId: string): void {
    const health = this.peerHealth.get(peerId);
    if (health) {
      health.consecutiveFailures = 0;
      health.state = "closed";
      health.adaptiveTimeout = RaftNetwork.BASE_TIMEOUT_MS;
      health.lastSuccessTime = Date.now();
      this.logger.info("Peer marked as recovered", {
        peerId,
        nodeId: this.config.nodeId,
      });
    }
  }

  public getDeadPeers(): string[] {
    const threshold = this.config.network.circuitBreakerThreshold;
    const deadThreshold = threshold * RaftNetwork.DEAD_PEER_FAILURE_MULTIPLIER;
    const resetTimeout = this.config.network.circuitBreakerTimeout;
    const now = Date.now();
    const deadPeers: string[] = [];

    for (const [peerId, health] of this.peerHealth) {
      if (
        health.state === "open" &&
        health.consecutiveFailures >= deadThreshold &&
        now - health.lastFailureTime > resetTimeout
      ) {
        deadPeers.push(peerId);
      }
    }

    return deadPeers;
  }

  public removePeer(peerId: string): void {
    this.peerHealth.delete(peerId);
    this.logger.info("Peer removed from network tracking", {
      peerId,
      nodeId: this.config.nodeId,
    });
  }

  private checkCircuitBreaker(targetNodeId: string): void {
    const health = this.peerHealth.get(targetNodeId);
    if (!health || health.state === "closed") return;

    if (health.state === "open") {
      const resetTimeout = this.config.network.circuitBreakerTimeout;
      if (Date.now() - health.lastFailureTime >= resetTimeout) {
        health.state = "half-open";
        this.logger.info("Circuit breaker half-open, allowing probe request", {
          targetNodeId,
          consecutiveFailures: health.consecutiveFailures,
          nodeId: this.config.nodeId,
        });
        return;
      }
      throw new RaftNetworkException(
        `Circuit breaker open for ${targetNodeId} (${health.consecutiveFailures} consecutive failures)`,
      );
    }
    // half-open: allow through as a probe request
  }

  private recordSuccess(targetNodeId: string): void {
    const health = this.getOrCreateHealth(targetNodeId);
    health.totalSuccesses++;
    health.consecutiveFailures = 0;
    health.lastSuccessTime = Date.now();
    health.adaptiveTimeout = Math.max(
      RaftNetwork.BASE_TIMEOUT_MS,
      health.adaptiveTimeout * 0.8,
    );

    if (health.state === "half-open") {
      health.state = "closed";
      this.logger.info("Circuit breaker closed after successful probe", {
        targetNodeId,
        nodeId: this.config.nodeId,
      });
    }
  }

  private recordFailure(targetNodeId: string): void {
    const health = this.getOrCreateHealth(targetNodeId);
    health.totalFailures++;
    health.consecutiveFailures++;
    health.lastFailureTime = Date.now();
    health.adaptiveTimeout = Math.min(
      RaftNetwork.MAX_ADAPTIVE_TIMEOUT_MS,
      health.adaptiveTimeout * 1.5,
    );

    const threshold = this.config.network.circuitBreakerThreshold;
    if (health.consecutiveFailures >= threshold && health.state !== "open") {
      health.state = "open";
      this.logger.warn("Circuit breaker opened", {
        targetNodeId,
        consecutiveFailures: health.consecutiveFailures,
        threshold,
        nodeId: this.config.nodeId,
      });
    }
  }

  private getOrCreateHealth(peerId: string): PeerHealth {
    let health = this.peerHealth.get(peerId);
    if (!health) {
      health = this.createDefaultHealth();
      this.peerHealth.set(peerId, health);
    }
    return health;
  }

  private createDefaultHealth(): PeerHealth {
    return {
      consecutiveFailures: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
      state: "closed",
      adaptiveTimeout: RaftNetwork.BASE_TIMEOUT_MS,
    };
  }

  public shutdown(): void {
    this.isShutdown = true;
    // Resolve all pending send operations so they fail fast instead of
    // blocking on brpop until timeout
    for (const cb of this.shutdownCallbacks) {
      cb();
    }
    this.shutdownCallbacks.clear();
  }
}
