import { Injectable } from "@nestjs/common";
import { RaftService } from "@usex/raft-nestjs";
import { EventBusService } from "@/shared/services/event-bus.service";
import { LoggerService } from "@/shared/services/logger.service";

export interface NodeInfo {
  id: string;
  state: string;
  isLeader: boolean;
  endpoint: string;
  lastSeen: Date;
  status: "online" | "offline" | "unknown";
}

export interface ClusterInfo {
  clusterId: string;
  nodes: NodeInfo[];
  leaderId: string | null;
  term: number;
  commitIndex: number;
  lastApplied: number;
}

@Injectable()
export class ClusterService {
  private readonly nodeId: string;
  private nodeEndpoints: Map<string, string> = new Map();

  constructor(
    private readonly raftService: RaftService,
    private readonly eventBus: EventBusService,
    private readonly logger: LoggerService,
  ) {
    this.nodeId = process.env.NODE_ID || "unknown";
    this.initializeNodeEndpoints();
  }

  private initializeNodeEndpoints() {
    // Initialize from environment or configuration
    const nodes = this.raftService.getClusterNodes();
    nodes.forEach((nodeId, index) => {
      const port = 3000 + index;
      this.nodeEndpoints.set(nodeId, `http://localhost:${port}`);
    });
  }

  getClusterInfo(): ClusterInfo {
    const nodes = this.raftService.getClusterNodes();
    const leaderId = this.raftService.getLeaderId();

    return {
      clusterId: process.env.CLUSTER_ID || "playground-cluster",
      nodes: nodes.map((nodeId) => this.getNodeInfo(nodeId)),
      leaderId,
      term: 0, // Would come from Raft implementation
      commitIndex: 0, // Would come from Raft implementation
      lastApplied: 0, // Would come from Raft implementation
    };
  }

  getNodeInfo(nodeId: string): NodeInfo {
    const isCurrentNode = nodeId === this.nodeId;
    const isLeader = nodeId === this.raftService.getLeaderId();

    return {
      id: nodeId,
      state: isCurrentNode ? this.raftService.getState() : "unknown",
      isLeader,
      endpoint: this.nodeEndpoints.get(nodeId) || "unknown",
      lastSeen: new Date(), // In real implementation, track heartbeats
      status: isCurrentNode ? "online" : "unknown",
    };
  }

  async addNode(nodeId: string, endpoint: string): Promise<void> {
    this.logger.log(`Adding node ${nodeId} at ${endpoint}`, "ClusterService");
    this.nodeEndpoints.set(nodeId, endpoint);

    // In real implementation, would reconfigure Raft cluster
    this.eventBus.emit({
      type: "cluster.node_added",
      nodeId: this.nodeId,
      timestamp: new Date(),
      data: { addedNodeId: nodeId, endpoint },
    });
  }

  async removeNode(nodeId: string): Promise<void> {
    this.logger.log(`Removing node ${nodeId}`, "ClusterService");
    this.nodeEndpoints.delete(nodeId);

    // In real implementation, would reconfigure Raft cluster
    this.eventBus.emit({
      type: "cluster.node_removed",
      nodeId: this.nodeId,
      timestamp: new Date(),
      data: { removedNodeId: nodeId },
    });
  }

  getNodeEndpoint(nodeId: string): string | undefined {
    return this.nodeEndpoints.get(nodeId);
  }

  isHealthy(): boolean {
    // Check if cluster has a leader and enough nodes
    const leaderId = this.raftService.getLeaderId();
    const nodes = this.raftService.getClusterNodes();

    return !!leaderId && nodes.length >= 3; // Minimum 3 nodes for fault tolerance
  }
}
