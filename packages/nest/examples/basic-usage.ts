import { Module, Injectable, Get, Controller } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { RaftService } from "@usex/raft-nestjs";
import {
  RaftNode,
  RaftModule,
  OnStateChange,
  OnPeerLost,
  OnPeerDiscovered,
  OnLeaderElected,
  OnErrorOccurred,
} from "@usex/raft-nestjs";

// Example service that handles Raft events
@Injectable()
@RaftNode() // Mark this as a Raft node handler
export class ClusterEventHandler {
  constructor(private readonly raftService: RaftService) {}

  @OnLeaderElected()
  async handleLeaderElected(event: any) {
    console.log("🎉 New leader elected:", event);
    // Perform leader-specific initialization
  }

  @OnStateChange()
  async handleStateChange(event: any) {
    console.log("📊 State changed:", event);
    // Update application state based on Raft state
  }

  @OnErrorOccurred()
  async handleError(event: any) {
    console.error("❌ Raft error occurred:", event);
    // Handle errors appropriately
  }

  @OnPeerDiscovered()
  async handlePeerDiscovered(event: any) {
    console.log("👋 New peer discovered:", event);
    // Update peer list or perform peer-specific setup
  }

  @OnPeerLost()
  async handlePeerLost(event: any) {
    console.log("👻 Peer lost:", event);
    // Clean up peer resources
  }
}

// Example controller using RaftService
@Controller("cluster")
export class ClusterController {
  constructor(private readonly raftService: RaftService) {}

  @Get("state")
  getState() {
    return {
      state: this.raftService.getState(),
      isLeader: this.raftService.isLeader(),
      leaderId: this.raftService.getLeaderId(),
      currentTerm: this.raftService.getCurrentTerm(),
      peers: this.raftService.getPeers(),
    };
  }

  @Get("metrics")
  getMetrics() {
    return this.raftService.getMetrics();
  }
}

// Application module
@Module({
  imports: [
    RaftModule.forRoot({
      nodeId: "node-1",
      clusterId: "my-cluster",
      isGlobal: true,
      // Override default configurations
      httpPort: 3001,
      electionTimeout: [150, 300],
      heartbeatInterval: 50,
      redis: {
        host: "localhost",
        port: 6379,
      },
    }),
  ],
  controllers: [ClusterController],
  providers: [ClusterEventHandler],
})
export class AppModule {}

// Bootstrap the application
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
  console.log("🚀 Application is running on: http://localhost:3000");
}

bootstrap();
