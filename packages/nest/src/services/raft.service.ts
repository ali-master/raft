import { Injectable, Inject } from "@nestjs/common";
import type { RaftNode, RaftEngine } from "@usex/raft";
import { RaftState } from "@usex/raft";
import { RAFT_NODE, RAFT_ENGINE } from "../constants";

@Injectable()
export class RaftService {
  constructor(
    @Inject(RAFT_ENGINE) private readonly engine: RaftEngine,
    @Inject(RAFT_NODE) private readonly defaultNode: RaftNode,
  ) {}

  /**
   * Get the current Raft node
   */
  getNode(nodeId?: string): RaftNode | undefined {
    if (nodeId) {
      return this.engine.getNode(nodeId);
    }
    return this.defaultNode;
  }

  /**
   * Get the current state of a node
   */
  getState(nodeId?: string): RaftState | undefined {
    const node = this.getNode(nodeId);
    return node?.getState();
  }

  /**
   * Check if a node is the leader
   */
  isLeader(nodeId?: string): boolean {
    return this.getState(nodeId) === RaftState.LEADER;
  }

  /**
   * Check if a node is a follower
   */
  isFollower(nodeId?: string): boolean {
    return this.getState(nodeId) === RaftState.FOLLOWER;
  }

  /**
   * Check if a node is a candidate
   */
  isCandidate(nodeId?: string): boolean {
    return this.getState(nodeId) === RaftState.CANDIDATE;
  }

  /**
   * Get the current leader ID
   */
  getLeaderId(_nodeId?: string): string | null {
    // TODO: Implement getLeaderId in RaftNode
    return null;
  }

  /**
   * Get the current term
   */
  getCurrentTerm(nodeId?: string): number {
    const node = this.getNode(nodeId);
    return node?.getCurrentTerm() || 0;
  }

  /**
   * Get all nodes in the cluster
   */
  getAllNodes(): RaftNode[] {
    const nodesMap = this.engine.getAllNodes();
    return Array.from(nodesMap.values());
  }

  /**
   * Get cluster nodes information
   */
  getClusterNodes(): Array<{
    nodeId: string;
    state: string;
    term: number;
    isLeader: boolean;
    peers: string[];
  }> {
    const nodes = this.getAllNodes();
    return nodes.map((node) => ({
      nodeId: node.getNodeId(),
      state: node.getState().toString(),
      term: node.getCurrentTerm(),
      isLeader: this.isLeader(node.getNodeId()),
      peers: node.getPeers(),
    }));
  }

  /**
   * Propose a value to the cluster
   */
  async propose(_value: any, _nodeId?: string): Promise<void> {
    // TODO: Implement propose in RaftNode
    throw new Error("Method not implemented yet");
  }

  /**
   * Get metrics for a node
   */
  getMetrics(nodeId?: string): any {
    const node = this.getNode(nodeId);
    return node?.getMetrics();
  }

  /**
   * Add a peer to the cluster
   */
  async addPeer(_peerId: string, _nodeId?: string): Promise<void> {
    // TODO: Implement addPeer in RaftNode
    throw new Error("Method not implemented yet");
  }

  /**
   * Remove a peer from the cluster
   */
  async removePeer(_peerId: string, _nodeId?: string): Promise<void> {
    // TODO: Implement removePeer in RaftNode
    throw new Error("Method not implemented yet");
  }

  /**
   * Get the list of peers
   */
  getPeers(nodeId?: string): string[] {
    const node = this.getNode(nodeId);
    return node?.getPeers() || [];
  }

  /**
   * Force an election
   */
  async forceElection(_nodeId?: string): Promise<void> {
    // TODO: Implement forceElection in RaftNode
    throw new Error("Method not implemented yet");
  }

  /**
   * Create a snapshot
   */
  async createSnapshot(_nodeId?: string): Promise<void> {
    // TODO: Implement createSnapshot in RaftNode
    throw new Error("Method not implemented yet");
  }
}
