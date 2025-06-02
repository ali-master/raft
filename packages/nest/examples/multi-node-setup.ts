import { Module, Injectable } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  RaftModule,
  RaftService,
  OnLeaderElected,
  RaftNode,
  InjectRaftEngine,
} from "@usex/raft-nestjs";
import { RaftEngine } from "@usex/raft";

// Service that manages multiple Raft nodes
@Injectable()
export class MultiNodeManager {
  constructor(
    @InjectRaftEngine() private readonly engine: RaftEngine,
    private readonly raftService: RaftService,
  ) {}

  async createAdditionalNode(nodeId: string, port: number) {
    const config = RaftEngine.createDefaultConfiguration(nodeId, "my-cluster");
    config.httpPort = port;

    const node = await this.engine.createNode(config);
    await this.engine.startNode(nodeId);

    return node;
  }

  async getNodeStatus(nodeId: string) {
    const node = this.engine.getNode(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    return {
      nodeId,
      state: node.getState(),
      isLeader: node.getState() === "leader",
      leaderId: node.getLeaderId(),
      currentTerm: node.getCurrentTerm(),
      peers: node.getPeers(),
    };
  }

  async getAllNodesStatus() {
    const nodes = this.engine.getAllNodes();
    const statuses = [];

    for (const [nodeId, node] of nodes) {
      statuses.push({
        nodeId,
        state: node.getState(),
        isLeader: node.getState() === "leader",
        currentTerm: node.getCurrentTerm(),
      });
    }

    return statuses;
  }
}

// Event handler for specific nodes
@Injectable()
@RaftNode("node-2") // This handler is specifically for node-2
export class Node2EventHandler {
  @OnLeaderElected()
  handleLeaderElected(event: any) {
    console.log("Node 2: Leader elected event received", event);
  }
}

// Generic event handler for all nodes
@Injectable()
@RaftNode() // No specific node ID means it handles events from all nodes
export class GenericEventHandler {
  @OnLeaderElected()
  handleLeaderElected(event: any) {
    console.log(
      `Generic handler: Leader elected on node ${event.nodeId}`,
      event,
    );
  }
}

// Module configuration for multi-node setup
@Module({
  imports: [
    RaftModule.forRoot({
      nodeId: "node-1",
      clusterId: "my-cluster",
      httpPort: 3001,
      isGlobal: true,
      electionTimeout: [150, 300],
      heartbeatInterval: 50,
      redis: {
        host: "localhost",
        port: 6379,
        keyPrefix: "raft:cluster:",
      },
    }),
  ],
  providers: [MultiNodeManager, Node2EventHandler, GenericEventHandler],
})
export class MultiNodeModule {}

// Bootstrap application with multiple nodes
async function bootstrap() {
  const app = await NestFactory.create(MultiNodeModule);

  // Get the multi-node manager
  const multiNodeManager = app.get(MultiNodeManager);

  // Create additional nodes
  await multiNodeManager.createAdditionalNode("node-2", 3002);
  await multiNodeManager.createAdditionalNode("node-3", 3003);

  // Start the application
  await app.listen(3000);

  console.log("🚀 Multi-node Raft cluster is running");
  console.log("📊 Node statuses:", await multiNodeManager.getAllNodesStatus());

  // Periodically log cluster status
  setInterval(async () => {
    const statuses = await multiNodeManager.getAllNodesStatus();
    console.log("📊 Cluster status update:", statuses);
  }, 10000);
}

bootstrap();
