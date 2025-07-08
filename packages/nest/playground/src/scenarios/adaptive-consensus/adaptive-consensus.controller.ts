import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpStatus,
  HttpException,
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  AdaptiveConsensusService,
  type AdaptiveConsensusServiceConfig,
} from "@usex/raft-nestjs";
import type { AdaptiveParameters } from "@usex/raft";

/**
 * DTO for updating adaptive consensus configuration
 */
export class UpdateAdaptiveConfigDto {
  enabled?: boolean;
  adaptationInterval?: number;
  latencyThreshold?: number;
  throughputThreshold?: number;
  learningRate?: number;
  minElectionTimeout?: number;
  maxElectionTimeout?: number;
  minHeartbeatInterval?: number;
  maxHeartbeatInterval?: number;
  networkQualityWeight?: number;
  throughputWeight?: number;
  stabilityWeight?: number;
  performanceDegradationThreshold?: number;
}

/**
 * DTO for forcing adaptation
 */
export class ForceAdaptationDto {
  reason?: string;
  immediate?: boolean;
}

/**
 * Response DTO for adaptive parameters
 */
export interface AdaptiveParametersResponse {
  nodeId: string;
  parameters: AdaptiveParameters;
  lastUpdated: Date;
  adaptationCount: number;
}

/**
 * Response DTO for adaptation statistics
 */
export interface AdaptationStatsResponse {
  nodeId: string;
  totalAdaptations: number;
  averagePerformanceScore: number;
  recentAdaptations: Array<{
    timestamp: number;
    performanceScore: number;
    parameters: AdaptiveParameters;
  }>;
  effectiveness: Record<string, number>;
}

/**
 * Response DTO for performance summary
 */
export interface PerformanceSummaryResponse {
  cluster: {
    totalNodes: number;
    averagePerformanceScore: number;
    totalAdaptations: number;
    nodesWithDegradedPerformance: number;
    adaptationFrequency: number;
  };
  nodes: Record<
    string,
    {
      performanceScore: number;
      adaptationCount: number;
      lastAdaptation: Date | null;
      status: "healthy" | "degraded" | "unknown";
    }
  >;
  timestamp: Date;
}

/**
 * REST API Controller for Adaptive Consensus management
 *
 * Provides HTTP endpoints for configuring, monitoring, and controlling
 * the adaptive consensus algorithms across Raft cluster nodes.
 */
@ApiTags("Adaptive Consensus")
@Controller("adaptive-consensus")
@ApiBearerAuth()
export class AdaptiveConsensusController {
  private readonly logger = new Logger(AdaptiveConsensusController.name);

  constructor(
    private readonly adaptiveConsensusService: AdaptiveConsensusService,
    private readonly _eventEmitter: EventEmitter2,
  ) {}

  /**
   * Get adaptive consensus status and configuration
   */
  @Get("status")
  @ApiOperation({
    summary: "Get adaptive consensus status",
    description:
      "Returns the current status and configuration of the adaptive consensus system",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Adaptive consensus status retrieved successfully",
  })
  getStatus(): {
    enabled: boolean;
    configuration: AdaptiveConsensusServiceConfig;
    summary: any;
  } {
    const enabled = this.adaptiveConsensusService.isEnabled();
    const configuration = this.adaptiveConsensusService.getConfiguration();
    const summary = this.adaptiveConsensusService.getPerformanceSummary();

    return {
      enabled,
      configuration,
      summary,
    };
  }

  /**
   * Update adaptive consensus configuration
   */
  @Put("configuration")
  @ApiOperation({
    summary: "Update adaptive consensus configuration",
    description:
      "Updates the configuration for the adaptive consensus algorithms",
  })
  @ApiBody({ type: UpdateAdaptiveConfigDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Configuration updated successfully",
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid configuration provided",
  })
  async updateConfiguration(
    @Body() updateDto: UpdateAdaptiveConfigDto,
  ): Promise<{
    success: boolean;
    message: string;
    newConfiguration: AdaptiveConsensusServiceConfig;
  }> {
    try {
      // Validate configuration
      this.validateConfiguration(updateDto);

      await this.adaptiveConsensusService.updateConfiguration(updateDto);
      const newConfiguration = this.adaptiveConsensusService.getConfiguration();

      this.logger.log("Adaptive consensus configuration updated via API");

      return {
        success: true,
        message: "Configuration updated successfully",
        newConfiguration,
      };
    } catch (error) {
      this.logger.error(
        "Failed to update adaptive consensus configuration:",
        error,
      );
      throw new HttpException(
        `Failed to update configuration: ${error.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Get current adaptive parameters for all nodes
   */
  @Get("parameters")
  @ApiOperation({
    summary: "Get adaptive parameters for all nodes",
    description:
      "Returns the current adaptive parameters for all cluster nodes",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Adaptive parameters retrieved successfully",
  })
  getAllParameters(): Record<string, AdaptiveParameters | null> {
    const stats = this.adaptiveConsensusService.getAllAdaptationStats();
    const parameters: Record<string, AdaptiveParameters | null> = {};

    Object.keys(stats).forEach((nodeId) => {
      parameters[nodeId] =
        this.adaptiveConsensusService.getCurrentParameters(nodeId) || null;
    });

    return parameters;
  }

  /**
   * Get adaptive parameters for a specific node
   */
  @Get("parameters/:nodeId")
  @ApiOperation({
    summary: "Get adaptive parameters for a specific node",
    description:
      "Returns the current adaptive parameters for the specified node",
  })
  @ApiParam({
    name: "nodeId",
    description: "The ID of the node to get parameters for",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Node parameters retrieved successfully",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Node not found",
  })
  getNodeParameters(
    @Param("nodeId") nodeId: string,
  ): AdaptiveParametersResponse {
    const parameters =
      this.adaptiveConsensusService.getCurrentParameters(nodeId);
    if (!parameters) {
      throw new HttpException(
        `Node not found or adaptive consensus not enabled: ${nodeId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const stats = this.adaptiveConsensusService.getAdaptationStats(nodeId);

    return {
      nodeId,
      parameters,
      lastUpdated: new Date(), // Would track this in real implementation
      adaptationCount: stats?.totalAdaptations || 0,
    };
  }

  /**
   * Get adaptation statistics for all nodes
   */
  @Get("statistics")
  @ApiOperation({
    summary: "Get adaptation statistics for all nodes",
    description: "Returns detailed adaptation statistics for all cluster nodes",
  })
  @ApiQuery({
    name: "detailed",
    required: false,
    description: "Include detailed historical data",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Statistics retrieved successfully",
  })
  getAllStatistics(@Query("detailed") detailed?: boolean): Record<string, any> {
    const stats = this.adaptiveConsensusService.getAllAdaptationStats();

    if (!detailed) {
      // Return summary statistics only
      const summary: Record<string, any> = {};
      Object.entries(stats).forEach(([nodeId, nodeStats]) => {
        summary[nodeId] = {
          totalAdaptations: (nodeStats as any)?.totalAdaptations || 0,
          averagePerformanceScore:
            (nodeStats as any)?.averagePerformanceScore || 0,
        };
      });
      return summary;
    }

    return stats;
  }

  /**
   * Get adaptation statistics for a specific node
   */
  @Get("statistics/:nodeId")
  @ApiOperation({
    summary: "Get adaptation statistics for a specific node",
    description:
      "Returns detailed adaptation statistics for the specified node",
  })
  @ApiParam({
    name: "nodeId",
    description: "The ID of the node to get statistics for",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Node statistics retrieved successfully",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Node not found",
  })
  getNodeStatistics(@Param("nodeId") nodeId: string): AdaptationStatsResponse {
    const stats = this.adaptiveConsensusService.getAdaptationStats(nodeId);
    if (!stats) {
      throw new HttpException(
        `Node not found or adaptive consensus not enabled: ${nodeId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      nodeId,
      totalAdaptations: stats.totalAdaptations,
      averagePerformanceScore: stats.averagePerformanceScore,
      recentAdaptations: stats.parameterHistory.slice(-10).map((entry) => ({
        timestamp: entry.timestamp,
        performanceScore: 0, // Would calculate from metrics in real implementation
        parameters: entry.parameters,
      })),
      effectiveness: Object.fromEntries(stats.currentEffectiveness),
    };
  }

  /**
   * Get performance summary across the cluster
   */
  @Get("performance")
  @ApiOperation({
    summary: "Get cluster performance summary",
    description:
      "Returns a comprehensive performance summary across all cluster nodes",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Performance summary retrieved successfully",
  })
  getPerformanceSummary(): PerformanceSummaryResponse {
    const clusterSummary =
      this.adaptiveConsensusService.getPerformanceSummary();
    const allStats = this.adaptiveConsensusService.getAllAdaptationStats();

    const nodes: Record<string, any> = {};
    Object.entries(allStats).forEach(([nodeId, stats]) => {
      const nodeStats = stats as any;
      nodes[nodeId] = {
        performanceScore: nodeStats?.averagePerformanceScore || 0,
        adaptationCount: nodeStats?.totalAdaptations || 0,
        lastAdaptation:
          nodeStats?.parameterHistory?.length > 0
            ? new Date(
                nodeStats.parameterHistory[
                  nodeStats.parameterHistory.length - 1
                ].timestamp,
              )
            : null,
        status:
          (nodeStats?.averagePerformanceScore || 1) >= 0.7
            ? "healthy"
            : "degraded",
      };
    });

    return {
      cluster: clusterSummary,
      nodes,
      timestamp: new Date(),
    };
  }

  /**
   * Force adaptation for a specific node
   */
  @Post("adapt/:nodeId")
  @ApiOperation({
    summary: "Force adaptation for a specific node",
    description: "Triggers immediate adaptation cycle for the specified node",
  })
  @ApiParam({
    name: "nodeId",
    description: "The ID of the node to force adaptation for",
  })
  @ApiBody({ type: ForceAdaptationDto, required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Adaptation triggered successfully",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Node not found",
  })
  async forceNodeAdaptation(
    @Param("nodeId") nodeId: string,
    @Body() forceDto?: ForceAdaptationDto,
  ): Promise<{
    success: boolean;
    message: string;
    nodeId: string;
    timestamp: Date;
  }> {
    try {
      await this.adaptiveConsensusService.forceAdaptation(nodeId);

      this.logger.log(`Forced adaptation for node: ${nodeId}`, {
        reason: forceDto?.reason || "manual_trigger",
        immediate: forceDto?.immediate || false,
      });

      return {
        success: true,
        message: `Adaptation triggered for node ${nodeId}`,
        nodeId,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to force adaptation for node ${nodeId}:`,
        error,
      );
      throw new HttpException(
        `Failed to force adaptation: ${error.message}`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * Force adaptation for all nodes
   */
  @Post("adapt")
  @ApiOperation({
    summary: "Force adaptation for all nodes",
    description: "Triggers immediate adaptation cycle for all cluster nodes",
  })
  @ApiBody({ type: ForceAdaptationDto, required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Adaptation triggered for all nodes successfully",
  })
  async forceAllAdaptation(@Body() forceDto?: ForceAdaptationDto): Promise<{
    success: boolean;
    message: string;
    affectedNodes: number;
    timestamp: Date;
  }> {
    try {
      await this.adaptiveConsensusService.forceAdaptationAll();
      const summary = this.adaptiveConsensusService.getPerformanceSummary();

      this.logger.log("Forced adaptation for all nodes", {
        reason: forceDto?.reason || "manual_trigger",
        immediate: forceDto?.immediate || false,
        nodeCount: summary.totalNodes,
      });

      return {
        success: true,
        message: "Adaptation triggered for all nodes",
        affectedNodes: summary.totalNodes,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error("Failed to force adaptation for all nodes:", error);
      throw new HttpException(
        `Failed to force adaptation: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Reset learning state for a specific node
   */
  @Delete("learning/:nodeId")
  @ApiOperation({
    summary: "Reset learning state for a specific node",
    description:
      "Resets the learning state and historical data for the specified node",
  })
  @ApiParam({
    name: "nodeId",
    description: "The ID of the node to reset learning state for",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Learning state reset successfully",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Node not found",
  })
  resetNodeLearningState(@Param("nodeId") nodeId: string): {
    success: boolean;
    message: string;
    nodeId: string;
    timestamp: Date;
  } {
    try {
      this.adaptiveConsensusService.resetLearningState(nodeId);

      this.logger.log(`Reset learning state for node: ${nodeId}`);

      return {
        success: true,
        message: `Learning state reset for node ${nodeId}`,
        nodeId,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to reset learning state for node ${nodeId}:`,
        error,
      );
      throw new HttpException(
        `Failed to reset learning state: ${error.message}`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * Reset learning state for all nodes
   */
  @Delete("learning")
  @ApiOperation({
    summary: "Reset learning state for all nodes",
    description:
      "Resets the learning state and historical data for all cluster nodes",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Learning state reset for all nodes successfully",
  })
  resetAllLearningStates(): {
    success: boolean;
    message: string;
    affectedNodes: number;
    timestamp: Date;
  } {
    this.adaptiveConsensusService.resetAllLearningStates();
    const summary = this.adaptiveConsensusService.getPerformanceSummary();

    this.logger.log("Reset learning state for all nodes");

    return {
      success: true,
      message: "Learning state reset for all nodes",
      affectedNodes: summary.totalNodes,
      timestamp: new Date(),
    };
  }

  /**
   * Validate configuration update request
   */
  private validateConfiguration(config: UpdateAdaptiveConfigDto): void {
    // Validate learning rate
    if (
      config.learningRate !== undefined &&
      (config.learningRate < 0 || config.learningRate > 1)
    ) {
      throw new Error("Learning rate must be between 0 and 1");
    }

    // Validate weights sum to approximately 1
    if (
      config.networkQualityWeight !== undefined &&
      config.throughputWeight !== undefined &&
      config.stabilityWeight !== undefined
    ) {
      const sum =
        config.networkQualityWeight +
        config.throughputWeight +
        config.stabilityWeight;
      if (Math.abs(sum - 1.0) > 0.01) {
        throw new Error("Weights must sum to 1.0");
      }
    }

    // Validate timeout bounds
    if (
      config.minElectionTimeout !== undefined &&
      config.maxElectionTimeout !== undefined &&
      config.minElectionTimeout >= config.maxElectionTimeout
    ) {
      throw new Error("Minimum election timeout must be less than maximum");
    }

    if (
      config.minHeartbeatInterval !== undefined &&
      config.maxHeartbeatInterval !== undefined &&
      config.minHeartbeatInterval >= config.maxHeartbeatInterval
    ) {
      throw new Error("Minimum heartbeat interval must be less than maximum");
    }

    // Validate positive values
    const positiveFields = [
      "adaptationInterval",
      "latencyThreshold",
      "throughputThreshold",
      "minElectionTimeout",
      "maxElectionTimeout",
      "minHeartbeatInterval",
      "maxHeartbeatInterval",
    ] as const;

    for (const field of positiveFields) {
      if (config[field] !== undefined && config[field]! <= 0) {
        throw new Error(`${field} must be positive`);
      }
    }
  }
}
