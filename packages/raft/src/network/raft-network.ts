import * as http from "node:http";
import { performance } from "node:perf_hooks";
import CircuitBreaker from "opossum";
import type {
  VoteResponse,
  VoteRequest,
  RaftConfiguration,
  PeerInfo,
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

  constructor(
    config: RaftConfiguration,
    retry: RetryStrategy,
    logger: RaftLogger,
    peerDiscovery: PeerDiscoveryService,
    metrics: RaftMetricsCollector,
  ) {
    this.config = config;
    this.retry = retry;
    this.logger = logger;
    this.peerDiscovery = peerDiscovery;
    this.metrics = metrics;
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
    request: any,
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
    payload: any,
  ): Promise<any> {
    const startTime = performance.now();

    try {
      const peerInfo = this.peerDiscovery.getPeerInfo(targetNodeId);
      if (!peerInfo) {
        throw new RaftNetworkException(`Peer not found: ${targetNodeId}`);
      }

      const response = await this.sendHttpRequest(
        peerInfo,
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
        error,
        latency,
        nodeId: this.config.nodeId,
      });
      throw new RaftNetworkException(`Network error: ${error}`);
    }
  }

  private async sendHttpRequest(
    peerInfo: PeerInfo,
    messageType: MessageType,
    payload: any,
  ): Promise<any> {
    const url = `http://${peerInfo.httpHost}:${peerInfo.httpPort}/raft/${messageType}`;

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(payload);
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
        timeout: this.config.circuitBreaker?.timeout ?? 5000, // Default timeout if not configured
      };

      const req = http.request(url, options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const response = JSON.parse(data);
            resolve(response);
          } catch (error) {
            reject(
              new Error(`Invalid JSON response: ${data}`, {
                cause: error,
              }),
            );
          }
        });
      });

      req.on("error", reject);
      req.on("timeout", () => reject(new Error("Request timeout")));
      req.write(postData);
      req.end();
    });
  }

  public updateCircuitBreakers(): void {
    const currentPeers = new Set(this.peerDiscovery.getPeers());
    const existingPeers = new Set(this.circuitBreakers.keys());

    // Add circuit breakers for new peers
    for (const peer of currentPeers) {
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
    for (const peer of existingPeers) {
      if (!currentPeers.has(peer)) {
        this.circuitBreakers.delete(peer);
      }
    }
  }
}
