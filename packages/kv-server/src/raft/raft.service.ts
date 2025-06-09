import type { OnModuleDestroy } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { RaftNode } from "@usex/raft";
import { RaftState } from "@usex/raft";
import { ConfigHelper } from "../shared";

@Injectable()
export class RaftService implements OnModuleDestroy {
  private readonly nodeId: string;

  constructor(
    private readonly raftNode: RaftNode,
    private readonly configService: ConfigService,
  ) {
    this.nodeId = ConfigHelper.getNodeId(this.configService);
  }

  async onModuleDestroy() {
    await this.raftNode.stop();
  }

  isLeader(): boolean {
    return this.raftNode.getState() === RaftState.LEADER;
  }

  getNodeId(): string {
    return this.nodeId;
  }

  getState(): RaftState {
    return this.raftNode.getState();
  }

  getMetrics(): any {
    return this.raftNode.getMetrics();
  }

  async apply(command: any): Promise<void> {
    if (!this.isLeader()) {
      throw new Error("Only the leader can accept write operations");
    }
    await this.raftNode.appendLog(command);
  }
}
