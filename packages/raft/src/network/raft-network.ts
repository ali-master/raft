import type Redis from "ioredis";
import { performance } from "node:perf_hooks";
import CircuitBreaker from "opossum";
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
import type { RetryStrategy } from "../utils";
import type { RaftLogger, PeerDiscoveryService } from "../services";
import type { RaftMetricsCollector } from "../monitoring";

export class RaftNetwork {
  private readonly circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private readonly config: RaftConfiguration;
  private readonly retry: RetryStrategy;
  private readonly logger: RaftLogger;
  private readonly peerDiscovery: PeerDiscoveryService;
  private readonly metrics: RaftMetricsCollector;
  private readonly redis: Redis;

  constructor(
    config: RaftConfiguration,
    retry: RetryStrategy,
    logger: RaftLogger,
    peerDiscovery: PeerDiscoveryService,
    metrics: RaftMetricsCollector,
    redis: Redis,
  ) {
    this.config = config;
    this.retry = retry;
    this.logger = logger;
    this.peerDiscovery = peerDiscovery;
    this.metrics = metrics;
    this.redis = redis;
  }

  public initializeCircuitBreakers(): void {
    const options = {
      timeout: this.config.circuitBreaker?.timeout ?? 5000, // Default timeout if not configured
      errorThresholdPercentage:
        this.config.circuitBreaker?.errorThresholdPercentage ?? 50, // Default threshold if not configured
      resetTimeout: this.config.circuitBreaker?.resetTimeout ?? 30000, // Default reset timeout if not configured
    };

    for (const peer of this.peerDiscovery.getPeers()) {
      const breaker = new CircuitBreaker(this.sendMessage.bind(this), options);
      breaker.on("open", () => {
        this.logger.warn("Circuit breaker opened", { peer });
      });
      breaker.on("halfOpen", () => {
        this.logger.info("Circuit breaker half-open", { peer });
      });
      breaker.on("close", () => {
        this.logger.info("Circuit breaker closed", { peer });
      });

      this.circuitBreakers.set(peer, breaker);
    }
  }

  public async sendVoteRequest(
    targetNodeId: string,
    request: VoteRequest,
  ): Promise<VoteResponse> {
    return this.sendRequestWithRetry(
      targetNodeId,
      MessageType.VOTE_REQUEST,
      request,
    );
  }

  public async sendTimeoutNowRequest(
    targetNodeId: string,
    request: TimeoutNowRequest,
  ): Promise<void> {
    // Assuming no specific response, or a generic ack not strictly needed by caller
    await this.sendRequestWithRetry<void>( // Type T is void if no meaningful response expected
      targetNodeId,
      MessageType.TIMEOUT_NOW_REQUEST, // Assuming this type will be added
      request,
    );
  }

  public async sendPreVoteRequest(
    targetNodeId: string,
    request: PreVoteRequest,
  ): Promise<PreVoteResponse> {
    return this.sendRequestWithRetry(
      targetNodeId,
      MessageType.PRE_VOTE_REQUEST, // Assuming this type will be added to MessageType enum
      request,
    );
  }

  public async sendInstallSnapshot(
    targetNodeId: string,
    request: InstallSnapshotRequest,
  ): Promise<InstallSnapshotResponse> {
    return this.sendRequestWithRetry(
      targetNodeId,
      MessageType.INSTALL_SNAPSHOT,
      request,
    );
  }

  public async sendAppendEntries(
    targetNodeId: string,
    request: AppendEntriesRequest,
  ): Promise<AppendEntriesResponse> {
    return this.sendRequestWithRetry(
      targetNodeId,
      MessageType.APPEND_ENTRIES,
      request,
    );
  }

  private async sendRequestWithRetry<T>(
    targetNodeId: string,
    messageType: MessageType,
    request: object,
  ): Promise<T> {
    let breaker = this.circuitBreakers.get(targetNodeId);
    if (!breaker) {
      // Initialize circuit breaker for new peer
      const options = {
        timeout: this.config.circuitBreaker?.timeout ?? 5000, // Default timeout if not configured
        errorThresholdPercentage:
          this.config.circuitBreaker?.errorThresholdPercentage ?? 50, // Default threshold if not configured
        resetTimeout: this.config.circuitBreaker?.resetTimeout ?? 30000, // Default reset timeout if not configured
      };
      breaker = new CircuitBreaker(this.sendMessage.bind(this), options);
      this.circuitBreakers.set(targetNodeId, breaker);
    }

    return this.retry.execute<T>(async () => {
      return breaker!.fire(targetNodeId, messageType, request) as Promise<T>;
    }, `${messageType} to ${targetNodeId}`);
  }

  private async sendMessage(
    targetNodeId: string,
    messageType: MessageType,
    payload: object,
  ): Promise<unknown> {
    const startTime = performance.now();

    try {
      const peerInfo = this.peerDiscovery.getPeerInfo(targetNodeId);
      if (!peerInfo) {
        throw new RaftNetworkException(`Peer not found: ${targetNodeId}`);
      }

      const response = await this.sendRedisRequest(
        targetNodeId,
        messageType,
        payload,
      );

      const latency = performance.now() - startTime;

      // Record network latency metrics
      this.metrics.observeHistogram(
        "raft_network_latency_seconds",
        {
          node_id: this.config.nodeId,
          cluster_id: this.config.clusterId,
          target_node: targetNodeId,
        },
        latency / 1000,
      );

      this.logger.debug("Message sent successfully", {
        targetNodeId,
        messageType,
        latency,
        nodeId: this.config.nodeId,
      });

      return response;
    } catch (error) {
      const latency = performance.now() - startTime;
      this.logger.error("Failed to send message", {
        targetNodeId,
        messageType,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        latency,
        nodeId: this.config.nodeId,
      });
      throw new RaftNetworkException(`Network error: ${error}`);
    }
  }

  private async sendRedisRequest(
    targetNodeId: string,
    messageType: MessageType,
    payload: object,
  ): Promise<unknown> {
    const requestId = `${this.config.nodeId}-${Date.now()}-${Math.random()}`;
    // Commenting out requestKey for now as it's not used in current implementation
    // const requestKey = `raft:cluster:${this.config.clusterId}:messages:${targetNodeId}:${requestId}`;
    const responseKey = `raft:cluster:${this.config.clusterId}:responses:${this.config.nodeId}:${requestId}`;

    const message = {
      from: this.config.nodeId,
      to: targetNodeId,
      type: messageType,
      payload,
      requestId,
      timestamp: Date.now(),
    };

    try {
      // Send the message to the target node's queue
      await this.redis.lpush(
        `raft:cluster:${this.config.clusterId}:queue:${targetNodeId}`,
        JSON.stringify(message),
      );

      // Wait for response with timeout
      const timeout = this.config.circuitBreaker?.timeout ?? 5000;
      const result = await this.redis.brpop(
        responseKey,
        Math.floor(timeout / 1000),
      );

      if (!result) {
        throw new Error("Request timeout - no response received");
      }

      const responseData = JSON.parse(result[1]);
      return responseData.payload;
    } catch (error) {
      throw new Error(`Redis request failed: ${error}`);
    }
  }

  public updateCircuitBreakers(): void {
    const currentPeers = new Set(this.peerDiscovery.getPeers());
    const existingPeers = new Set(this.circuitBreakers.keys());

    // Add circuit breakers for new peers
    for (const peer of Array.from(currentPeers)) {
      if (!existingPeers.has(peer)) {
        const options = {
          timeout: this.config.circuitBreaker?.timeout ?? 5000, // Default timeout if not configured
          errorThresholdPercentage:
            this.config.circuitBreaker?.errorThresholdPercentage ?? 50,
          resetTimeout: this.config.circuitBreaker?.resetTimeout ?? 30000, // Default reset timeout if not configured
        };

        const breaker = new CircuitBreaker(
          this.sendMessage.bind(this),
          options,
        );
        this.circuitBreakers.set(peer, breaker);
      }
    }

    // Remove circuit breakers for lost peers
    for (const peer of Array.from(existingPeers)) {
      if (!currentPeers.has(peer)) {
        this.circuitBreakers.delete(peer);
      }
    }
  }

  public resetCircuitBreakers(): void {
    this.logger.info("Resetting all circuit breakers", {
      nodeId: this.config.nodeId,
      count: this.circuitBreakers.size,
    });

    // Reset all circuit breakers to closed state
    for (const [peerId, breaker] of this.circuitBreakers) {
      if (breaker.opened) {
        breaker.close();
        this.logger.debug("Reset circuit breaker", {
          peerId,
          nodeId: this.config.nodeId,
        });
      }
    }
  }
}
