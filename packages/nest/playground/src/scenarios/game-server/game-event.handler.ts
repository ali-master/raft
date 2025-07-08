import { Injectable } from "@nestjs/common";
import {
  OnLogReplicated,
  OnLogCommitted,
  OnStateChange,
} from "@usex/raft-nestjs";
import { GameServerService, GameOperation } from "./game-server.service";
import { LoggerService } from "@/shared/services/logger.service";
import { MetricsService } from "@/shared/services/metrics.service";

@Injectable()
export class GameEventHandler {
  constructor(
    private readonly gameServerService: GameServerService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  @OnLogReplicated()
  handleLogReplicated(entry: any) {
    if (this.isGameOperation(entry.data)) {
      this.logger.debug(
        `Applying game operation: ${entry.data.type} ${entry.data.gameId || "new"}`,
        "GameEventHandler",
      );

      const startTime = Date.now();
      this.gameServerService.applyOperation(entry.data);

      this.metrics.observeHistogram(
        "game_operation_apply_duration_seconds",
        (Date.now() - startTime) / 1000,
        {
          node: process.env.NODE_ID || "unknown",
          type: entry.data.type,
        },
      );
    }
  }

  @OnLogCommitted()
  handleLogCommitted(entry: any) {
    if (this.isGameOperation(entry.data)) {
      this.logger.log(
        `Game operation committed: ${entry.data.type} ${entry.data.gameId || "new"}`,
        "GameEventHandler",
      );

      this.metrics.incrementCounter("game_operations_committed_total", {
        node: process.env.NODE_ID || "unknown",
        type: entry.data.type,
      });
    }
  }

  @OnStateChange()
  handleStateChange(data: { from: string; to: string }) {
    this.logger.warn(
      `Game server node state changed from ${data.from} to ${data.to}`,
      "GameEventHandler",
    );

    if (data.to === "leader") {
      this.gameServerService.getStats().then((stats) => {
        this.logger.log(
          `New leader game server stats: ${stats.totalGames} games, ${stats.activePlayers} active players`,
          "GameEventHandler",
        );
      });
    }
  }

  private isGameOperation(data: any): data is GameOperation {
    return (
      data &&
      typeof data.type === "string" &&
      [
        "CREATE_GAME",
        "JOIN_GAME",
        "LEAVE_GAME",
        "START_GAME",
        "UPDATE_PLAYER",
        "UPDATE_WORLD",
        "FINISH_GAME",
        "DELETE_GAME",
      ].includes(data.type) &&
      typeof data.timestamp === "number"
    );
  }
}
