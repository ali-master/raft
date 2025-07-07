import { EventEmitter } from "node:events";
import type Redis from "ioredis";
import * as os from "node:os";
import type {
  SystemMetricsSnapshot,
  RaftConfiguration,
  PeerInfo,
} from "../types";
import { RaftState, RaftEventType } from "../constants";
import { RaftPeerDiscoveryException } from "../exceptions";
import { SystemMetrics } from "../utils";
import type { RaftLogger } from "./logger";

export class PeerDiscoveryService extends EventEmitter {
  private readonly redis: Redis;
  private readonly config: RaftConfiguration;
  private readonly logger: RaftLogger;
  private readonly peers: Map<string, PeerInfo> = new Map();
  private registrationTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private currentMetrics: SystemMetricsSnapshot;

  constructor(redis: Redis, config: RaftConfiguration, logger: RaftLogger) {
    super();
    this.redis = redis;
    this.config = config;
    this.logger = logger;
    this.currentMetrics = {
      cpuUsage: 0,
      memoryUsage: 0,
      diskUsage: 0,
      networkLatency: 0,
      loadAverage: [0, 0, 0],
      uptime: 0,
    };
  }

  public async start(): Promise<void> {
    await this.updateSystemMetrics();
    await this.registerSelf();
    await this.discoverPeers();

    this.registrationTimer = setInterval(() => {
      this.registerSelf().catch((error) =>
        this.logger.error("Failed to register self", {
          error,
          nodeId: this.config.nodeId,
        }),
      );
    }, this.config.peerDiscovery?.registrationInterval ?? 5000);

    this.healthCheckTimer = setInterval(() => {
      Promise.all([
        this.updateSystemMetrics(),
        this.discoverPeers(),
        this.cleanupStaleNodes(),
      ]).catch((error) =>
        this.logger.error("Health check failed", {
          error,
          nodeId: this.config.nodeId,
        }),
      );
    }, this.config.peerDiscovery?.healthCheckInterval ?? 10000);

    this.logger.info("Peer discovery service started", {
      nodeId: this.config.nodeId,
    });
  }

  public async stop(): Promise<void> {
    if (this.registrationTimer) {
      clearInterval(this.registrationTimer);
      this.registrationTimer = null;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    await this.deregisterSelf();
    this.logger.info("Peer discovery service stopped", {
      nodeId: this.config.nodeId,
    });
  }

  public getPeers(): string[] {
    return Array.from(this.peers.keys()).filter(
      (nodeId) => nodeId !== this.config.nodeId,
    );
  }

  public getPeerInfo(nodeId: string): PeerInfo | undefined {
    return this.peers.get(nodeId);
  }

  public getAllPeers(): Map<string, PeerInfo> {
    return new Map(this.peers);
  }

  public getCurrentMetrics(): SystemMetricsSnapshot {
    return { ...this.currentMetrics };
  }

  private async updateSystemMetrics(): Promise<void> {
    try {
      this.currentMetrics = {
        cpuUsage: await SystemMetrics.getCpuUsage(),
        memoryUsage: SystemMetrics.getMemoryUsage(),
        diskUsage: await SystemMetrics.getDiskUsage(),
        networkLatency: 0, // Will be calculated per peer
        loadAverage: SystemMetrics.getLoadAverage(),
        uptime: SystemMetrics.getUptime(),
      };
    } catch (error) {
      this.logger.warn("Failed to update system metrics", {
        error,
        nodeId: this.config.nodeId,
      });
    }
  }

  private async registerSelf(): Promise<void> {
    const selfInfo: PeerInfo = {
      nodeId: this.config.nodeId,
      clusterId: this.config.clusterId,
      httpHost: this.getLocalIpAddress(),
      httpPort: this.config.httpPort,
      state: RaftState.FOLLOWER, // Initial state
      term: 0,
      lastSeen: new Date(),
      weight: this.config.voting.defaultWeight,
      metrics: this.currentMetrics,
    };

    const key = `raft:cluster:${this.config.clusterId}:node:${this.config.nodeId}`;
    const ttl = Math.floor(
      (this.config.peerDiscovery?.peerTimeout ?? 30_000) / 1000,
    );

    try {
      await this.redis.setex(key, ttl, JSON.stringify(selfInfo));
      this.logger.debug("Self registered", { nodeId: this.config.nodeId, key });
    } catch (error) {
      this.logger.error("Failed to register self", {
        error,
        nodeId: this.config.nodeId,
      });
      throw new RaftPeerDiscoveryException(`Failed to register self: ${error}`);
    }
  }

  private async deregisterSelf(): Promise<void> {
    const key = `raft:cluster:${this.config.clusterId}:node:${this.config.nodeId}`;

    try {
      await this.redis.del(key);
      this.logger.debug("Self deregistered", { nodeId: this.config.nodeId });
    } catch (error) {
      this.logger.warn("Failed to deregister self", {
        error,
        nodeId: this.config.nodeId,
      });
    }
  }

  private async discoverPeers(): Promise<void> {
    const pattern = `raft:cluster:${this.config.clusterId}:node:*`;

    try {
      const keys = await this.redis.keys(pattern);
      const previousPeers = new Set(this.peers.keys());
      const currentPeers = new Set<string>();

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const peerInfo: PeerInfo = JSON.parse(data);
          currentPeers.add(peerInfo.nodeId);

          const existingPeer = this.peers.get(peerInfo.nodeId);
          if (!existingPeer) {
            this.logger.info("New peer discovered", {
              peerId: peerInfo.nodeId,
              peerHost: peerInfo.httpHost,
              peerPort: peerInfo.httpPort,
            });
            this.emit(RaftEventType.PEER_DISCOVERED, peerInfo);
          }

          this.peers.set(peerInfo.nodeId, peerInfo);
        }
      }

      // Detect lost peers
      for (const peerId of previousPeers) {
        if (!currentPeers.has(peerId)) {
          const lostPeer = this.peers.get(peerId);
          this.peers.delete(peerId);
          this.logger.info("Peer lost", { peerId });
          this.emit(RaftEventType.PEER_LOST, lostPeer);
        }
      }
    } catch (error) {
      this.logger.error("Failed to discover peers", {
        error,
        nodeId: this.config.nodeId,
      });
    }
  }

  private async cleanupStaleNodes(): Promise<void> {
    const now = new Date();
    const staleThreshold = this.config.peerDiscovery?.peerTimeout ?? 30000;

    for (const [nodeId, peerInfo] of this.peers) {
      const timeSinceLastSeen = now.getTime() - peerInfo.lastSeen.getTime();

      if (timeSinceLastSeen > staleThreshold) {
        this.peers.delete(nodeId);
        this.logger.warn("Removed stale peer", {
          nodeId,
          lastSeen: peerInfo.lastSeen,
          timeSinceLastSeen,
        });
        this.emit(RaftEventType.PEER_LOST, peerInfo);
      }
    }
  }

  private getLocalIpAddress(): string {
    const interfaces = os.networkInterfaces();

    for (const interfaceName of Object.keys(interfaces)) {
      const networkInterface = interfaces[interfaceName];
      if (networkInterface) {
        for (const alias of networkInterface) {
          if (alias.family === "IPv4" && !alias.internal) {
            return alias.address;
          }
        }
      }
    }

    return "127.0.0.1"; // Fallback to localhost
  }

  public async updatePeerState(
    nodeId: string,
    state: RaftState,
    term: number,
  ): Promise<void> {
    const peer = this.peers.get(nodeId);
    if (peer) {
      peer.state = state;
      peer.term = term;
      peer.lastSeen = new Date();
    }
  }
}
