import { Get, Controller } from "@nestjs/common";
import { ApiTags, ApiResponse, ApiOperation } from "@nestjs/swagger";
import type { RaftService } from "./raft.service";
import type { RaftState } from "@usex/raft";

interface RaftStatusResponse {
  nodeId: string;
  state: RaftState;
  isLeader: boolean;
  metrics: any;
}

@ApiTags("Raft")
@Controller("raft")
export class RaftController {
  constructor(private readonly raftService: RaftService) {}

  @Get("status")
  @ApiOperation({ summary: "Get Raft node status" })
  @ApiResponse({
    status: 200,
    description: "Raft status retrieved successfully",
  })
  async getStatus(): Promise<RaftStatusResponse> {
    return {
      nodeId: this.raftService.getNodeId(),
      state: this.raftService.getState(),
      isLeader: this.raftService.isLeader(),
      metrics: this.raftService.getMetrics(),
    };
  }

  @Get("leader")
  @ApiOperation({ summary: "Check if this node is the leader" })
  @ApiResponse({
    status: 200,
    description: "Leader status retrieved successfully",
  })
  async isLeader(): Promise<{ isLeader: boolean }> {
    return { isLeader: this.raftService.isLeader() };
  }

  @Get("metrics")
  @ApiOperation({ summary: "Get Raft metrics" })
  @ApiResponse({ status: 200, description: "Metrics retrieved successfully" })
  async getMetrics(): Promise<any> {
    return this.raftService.getMetrics();
  }
}
