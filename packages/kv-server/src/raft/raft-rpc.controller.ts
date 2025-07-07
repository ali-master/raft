import { Post, Controller, Body } from "@nestjs/common";
import { ApiTags, ApiResponse, ApiOperation } from "@nestjs/swagger";
import type {
  VoteResponse,
  VoteRequest,
  TimeoutNowRequest,
  RaftNode,
  PreVoteResponse,
  PreVoteRequest,
  InstallSnapshotResponse,
  InstallSnapshotRequest,
  AppendEntriesResponse,
  AppendEntriesRequest,
} from "@usex/raft";

@ApiTags("Raft RPC")
@Controller("raft/rpc")
export class RaftRpcController {
  constructor(private readonly raftNode: RaftNode) {}

  @Post("vote-request")
  @ApiOperation({ summary: "Handle vote request from candidate" })
  @ApiResponse({
    status: 200,
    description: "Vote response returned successfully",
  })
  async handleVoteRequest(@Body() request: VoteRequest): Promise<VoteResponse> {
    return this.raftNode.handleVoteRequest(request);
  }

  @Post("append-entries")
  @ApiOperation({ summary: "Handle append entries request from leader" })
  @ApiResponse({
    status: 200,
    description: "Append entries response returned successfully",
  })
  async handleAppendEntries(
    @Body() request: AppendEntriesRequest,
  ): Promise<AppendEntriesResponse> {
    return this.raftNode.handleAppendEntries(request);
  }

  @Post("pre-vote")
  @ApiOperation({ summary: "Handle pre-vote request from candidate" })
  @ApiResponse({
    status: 200,
    description: "Pre-vote response returned successfully",
  })
  async handlePreVote(
    @Body() request: PreVoteRequest,
  ): Promise<PreVoteResponse> {
    return this.raftNode.handlePreVoteRequest(request);
  }

  @Post("install-snapshot")
  @ApiOperation({ summary: "Handle install snapshot request from leader" })
  @ApiResponse({
    status: 200,
    description: "Install snapshot response returned successfully",
  })
  async handleInstallSnapshot(
    @Body() request: InstallSnapshotRequest,
  ): Promise<InstallSnapshotResponse> {
    return this.raftNode.handleInstallSnapshot(request);
  }

  @Post("timeout-now")
  @ApiOperation({
    summary: "Handle timeout now request for leadership transfer",
  })
  @ApiResponse({
    status: 200,
    description: "Timeout now request handled successfully",
  })
  async handleTimeoutNow(@Body() request: TimeoutNowRequest): Promise<void> {
    return this.raftNode.handleTimeoutNowRequest(request);
  }
}
