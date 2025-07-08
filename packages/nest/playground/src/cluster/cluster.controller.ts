import { Controller, Get, Post, Delete, Param, Body } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from "@nestjs/swagger";
import { ClusterService } from "./cluster.service";
import { RaftService } from "@usex/raft-nestjs";

class AddNodeDto {
  nodeId: string;
  endpoint: string;
}

@ApiTags("cluster")
@Controller("cluster")
export class ClusterController {
  constructor(
    private readonly clusterService: ClusterService,
    private readonly raftService: RaftService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Get cluster information" })
  @ApiResponse({ status: 200, description: "Cluster information" })
  getClusterInfo() {
    return this.clusterService.getClusterInfo();
  }

  @Get("nodes")
  @ApiOperation({ summary: "List all cluster nodes" })
  @ApiResponse({ status: 200, description: "List of nodes" })
  getNodes() {
    const nodes = this.raftService.getClusterNodes();
    return nodes.map((node) => this.clusterService.getNodeInfo(node.nodeId));
  }

  @Get("nodes/:id")
  @ApiOperation({ summary: "Get specific node information" })
  @ApiResponse({ status: 200, description: "Node information" })
  @ApiResponse({ status: 404, description: "Node not found" })
  getNode(@Param("id") id: string) {
    const nodes = this.raftService.getClusterNodes();
    if (!nodes.find((node) => node.nodeId === id)) {
      return { found: false, node: null };
    }

    return {
      found: true,
      node: this.clusterService.getNodeInfo(id),
    };
  }

  @Get("leader")
  @ApiOperation({ summary: "Get current leader information" })
  @ApiResponse({ status: 200, description: "Leader information" })
  getLeader() {
    const leaderId = this.raftService.getLeaderId();

    if (!leaderId) {
      return { hasLeader: false, leader: null };
    }

    return {
      hasLeader: true,
      leader: this.clusterService.getNodeInfo(leaderId),
    };
  }

  @Get("health")
  @ApiOperation({ summary: "Check cluster health" })
  @ApiResponse({ status: 200, description: "Cluster health status" })
  getHealth() {
    const isHealthy = this.clusterService.isHealthy();
    const leaderId = this.raftService.getLeaderId();
    const nodes = this.raftService.getClusterNodes();

    return {
      healthy: isHealthy,
      hasLeader: !!leaderId,
      nodeCount: nodes.length,
      minimumNodes: 3,
      status: isHealthy ? "operational" : "degraded",
    };
  }

  @Post("nodes")
  @ApiOperation({ summary: "Add a new node to the cluster" })
  @ApiBody({ type: AddNodeDto })
  @ApiResponse({ status: 201, description: "Node added" })
  @ApiResponse({ status: 400, description: "Invalid request" })
  async addNode(@Body() dto: AddNodeDto) {
    await this.clusterService.addNode(dto.nodeId, dto.endpoint);
    return { success: true, nodeId: dto.nodeId };
  }

  @Delete("nodes/:id")
  @ApiOperation({ summary: "Remove a node from the cluster" })
  @ApiResponse({ status: 204, description: "Node removed" })
  @ApiResponse({ status: 400, description: "Cannot remove node" })
  async removeNode(@Param("id") id: string) {
    await this.clusterService.removeNode(id);
    return { success: true };
  }
}
