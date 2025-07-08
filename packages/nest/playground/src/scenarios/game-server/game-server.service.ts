import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { RaftService } from "@usex/raft-nestjs";
import { EventBusService } from "@/shared/services/event-bus.service";
import { LoggerService } from "@/shared/services/logger.service";

export enum GameState {
  WAITING = "WAITING",
  STARTING = "STARTING",
  IN_PROGRESS = "IN_PROGRESS",
  PAUSED = "PAUSED",
  FINISHED = "FINISHED",
}

export interface Player {
  id: string;
  name: string;
  score: number;
  position: { x: number; y: number };
  health: number;
  joinedAt: Date;
  lastSeen: Date;
  isActive: boolean;
}

export interface Game {
  id: string;
  name: string;
  state: GameState;
  players: Map<string, Player>;
  maxPlayers: number;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  winner?: string;
  settings: any;
  worldState: any;
}

export interface GameOperation {
  type:
    | "CREATE_GAME"
    | "JOIN_GAME"
    | "LEAVE_GAME"
    | "START_GAME"
    | "UPDATE_PLAYER"
    | "UPDATE_WORLD"
    | "FINISH_GAME"
    | "DELETE_GAME";
  gameId?: string;
  game?: Partial<Game>;
  playerId?: string;
  player?: Partial<Player>;
  data?: any;
  timestamp: number;
}

@Injectable()
export class GameServerService {
  private games = new Map<string, Game>();
  private playerToGame = new Map<string, string>();
  private readonly nodeId: string;
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly raftService: RaftService,
    private readonly eventBus: EventBusService,
    private readonly logger: LoggerService,
  ) {
    this.nodeId = process.env.NODE_ID || "unknown";
    this.startCleanupWorker();
  }

  async createGame(
    name: string,
    maxPlayers: number = 4,
    settings: any = {},
  ): Promise<Game> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can create games. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const game: Game = {
      id: this.generateGameId(),
      name,
      state: GameState.WAITING,
      players: new Map(),
      maxPlayers,
      createdAt: new Date(),
      settings,
      worldState: this.initializeWorldState(settings),
    };

    const operation: GameOperation = {
      type: "CREATE_GAME",
      game: {
        ...game,
        players: undefined, // Will be handled in applyOperation
      },
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log(`Game created: ${game.id} (${name})`, "GameServer");

    return game;
  }

  async joinGame(
    gameId: string,
    playerId: string,
    playerName: string,
  ): Promise<Player> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can manage games. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const game = this.games.get(gameId);
    if (!game) {
      throw new NotFoundException(`Game ${gameId} not found`);
    }

    if (
      game.state !== GameState.WAITING &&
      game.state !== GameState.IN_PROGRESS
    ) {
      throw new BadRequestException(`Game ${gameId} is not accepting players`);
    }

    if (game.players.size >= game.maxPlayers) {
      throw new BadRequestException(`Game ${gameId} is full`);
    }

    if (this.playerToGame.has(playerId)) {
      throw new BadRequestException(`Player ${playerId} is already in a game`);
    }

    const player: Player = {
      id: playerId,
      name: playerName,
      score: 0,
      position: this.getSpawnPosition(game),
      health: 100,
      joinedAt: new Date(),
      lastSeen: new Date(),
      isActive: true,
    };

    const operation: GameOperation = {
      type: "JOIN_GAME",
      gameId,
      player,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log(`Player ${playerId} joined game ${gameId}`, "GameServer");

    return player;
  }

  async leaveGame(gameId: string, playerId: string): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can manage games. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const operation: GameOperation = {
      type: "LEAVE_GAME",
      gameId,
      playerId,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log(`Player ${playerId} left game ${gameId}`, "GameServer");
  }

  async startGame(gameId: string): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can start games. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const game = this.games.get(gameId);
    if (!game) {
      throw new NotFoundException(`Game ${gameId} not found`);
    }

    if (game.state !== GameState.WAITING) {
      throw new BadRequestException(`Game ${gameId} is already started`);
    }

    if (game.players.size < 2) {
      throw new BadRequestException(`Game ${gameId} needs at least 2 players`);
    }

    const operation: GameOperation = {
      type: "START_GAME",
      gameId,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log(`Game ${gameId} started`, "GameServer");
  }

  async updatePlayerState(
    gameId: string,
    playerId: string,
    update: Partial<Player>,
  ): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can update game state. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const operation: GameOperation = {
      type: "UPDATE_PLAYER",
      gameId,
      playerId,
      data: update,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
  }

  async updateWorldState(gameId: string, worldUpdate: any): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can update world state. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const operation: GameOperation = {
      type: "UPDATE_WORLD",
      gameId,
      data: worldUpdate,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
  }

  async finishGame(gameId: string, winnerId?: string): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can finish games. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const operation: GameOperation = {
      type: "FINISH_GAME",
      gameId,
      data: { winnerId },
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log(
      `Game ${gameId} finished. Winner: ${winnerId || "none"}`,
      "GameServer",
    );
  }

  getGame(gameId: string): Game | undefined {
    return this.games.get(gameId);
  }

  getActiveGames(): Game[] {
    return Array.from(this.games.values()).filter(
      (game) => game.state !== GameState.FINISHED,
    );
  }

  getPlayerGames(playerId: string): Game | undefined {
    const gameId = this.playerToGame.get(playerId);
    return gameId ? this.games.get(gameId) : undefined;
  }

  async getStats() {
    const games = Array.from(this.games.values());
    const activePlayers = new Set<string>();

    for (const game of games) {
      if (game.state === GameState.IN_PROGRESS) {
        game.players.forEach((player) => {
          if (player.isActive) {
            activePlayers.add(player.id);
          }
        });
      }
    }

    return {
      nodeId: this.nodeId,
      isLeader: this.raftService.isLeader(),
      totalGames: games.length,
      gamesByState: {
        waiting: games.filter((g) => g.state === GameState.WAITING).length,
        starting: games.filter((g) => g.state === GameState.STARTING).length,
        inProgress: games.filter((g) => g.state === GameState.IN_PROGRESS)
          .length,
        paused: games.filter((g) => g.state === GameState.PAUSED).length,
        finished: games.filter((g) => g.state === GameState.FINISHED).length,
      },
      totalPlayers: this.playerToGame.size,
      activePlayers: activePlayers.size,
      averageGameDuration: this.calculateAverageGameDuration(games),
      popularGame: this.findMostPopularGame(games),
    };
  }

  // Internal method called by event handler
  applyOperation(operation: GameOperation) {
    switch (operation.type) {
      case "CREATE_GAME":
        this.applyCreateGame(operation);
        break;
      case "JOIN_GAME":
        this.applyJoinGame(operation);
        break;
      case "LEAVE_GAME":
        this.applyLeaveGame(operation);
        break;
      case "START_GAME":
        this.applyStartGame(operation);
        break;
      case "UPDATE_PLAYER":
        this.applyUpdatePlayer(operation);
        break;
      case "UPDATE_WORLD":
        this.applyUpdateWorld(operation);
        break;
      case "FINISH_GAME":
        this.applyFinishGame(operation);
        break;
      case "DELETE_GAME":
        this.applyDeleteGame(operation);
        break;
    }
  }

  private applyCreateGame(operation: GameOperation) {
    const gameData = operation.game!;
    const game: Game = {
      ...(gameData as Game),
      players: new Map(),
    };

    this.games.set(game.id, game);
    this.eventBus.emitGameEvent("created", {
      gameId: game.id,
      name: game.name,
    });
    this.logger.debug(`Game created: ${game.id}`, "GameServer");
  }

  private applyJoinGame(operation: GameOperation) {
    const game = this.games.get(operation.gameId!);
    if (!game) return;

    const player = operation.player!;
    game.players.set(player.id, player as Player);
    this.playerToGame.set(player.id, game.id);

    this.eventBus.emitGameEvent("player_joined", {
      gameId: game.id,
      playerId: player.id,
      playerName: player.name,
    });
    this.logger.debug(
      `Player ${player.id} joined game ${game.id}`,
      "GameServer",
    );
  }

  private applyLeaveGame(operation: GameOperation) {
    const game = this.games.get(operation.gameId!);
    if (!game) return;

    const player = game.players.get(operation.playerId!);
    if (!player) return;

    game.players.delete(operation.playerId!);
    this.playerToGame.delete(operation.playerId!);

    this.eventBus.emitGameEvent("player_left", {
      gameId: game.id,
      playerId: operation.playerId,
    });

    // If game is empty, mark for cleanup
    if (game.players.size === 0 && game.state !== GameState.FINISHED) {
      game.state = GameState.FINISHED;
      game.finishedAt = new Date();
    }

    this.logger.debug(
      `Player ${operation.playerId} left game ${game.id}`,
      "GameServer",
    );
  }

  private applyStartGame(operation: GameOperation) {
    const game = this.games.get(operation.gameId!);
    if (!game) return;

    game.state = GameState.IN_PROGRESS;
    game.startedAt = new Date();

    this.eventBus.emitGameEvent("started", { gameId: game.id });
    this.logger.debug(`Game ${game.id} started`, "GameServer");
  }

  private applyUpdatePlayer(operation: GameOperation) {
    const game = this.games.get(operation.gameId!);
    if (!game) return;

    const player = game.players.get(operation.playerId!);
    if (!player) return;

    Object.assign(player, operation.data);
    player.lastSeen = new Date();

    this.eventBus.emitGameEvent("player_updated", {
      gameId: game.id,
      playerId: player.id,
      update: operation.data,
    });
  }

  private applyUpdateWorld(operation: GameOperation) {
    const game = this.games.get(operation.gameId!);
    if (!game) return;

    Object.assign(game.worldState, operation.data);

    this.eventBus.emitGameEvent("world_updated", {
      gameId: game.id,
      update: operation.data,
    });
  }

  private applyFinishGame(operation: GameOperation) {
    const game = this.games.get(operation.gameId!);
    if (!game) return;

    game.state = GameState.FINISHED;
    game.finishedAt = new Date();
    game.winner = operation.data?.winnerId;

    // Remove all players from tracking
    game.players.forEach((player) => {
      this.playerToGame.delete(player.id);
    });

    this.eventBus.emitGameEvent("finished", {
      gameId: game.id,
      winner: game.winner,
    });
    this.logger.debug(`Game ${game.id} finished`, "GameServer");
  }

  private applyDeleteGame(operation: GameOperation) {
    const game = this.games.get(operation.gameId!);
    if (!game) return;

    // Remove all players from tracking
    game.players.forEach((player) => {
      this.playerToGame.delete(player.id);
    });

    this.games.delete(operation.gameId!);
    this.eventBus.emitGameEvent("deleted", { gameId: operation.gameId });
    this.logger.debug(`Game ${operation.gameId} deleted`, "GameServer");
  }

  private initializeWorldState(settings: any): any {
    return {
      map: settings.map || "default",
      objects: [],
      powerups: [],
      events: [],
      time: 0,
    };
  }

  private getSpawnPosition(game: Game): { x: number; y: number } {
    // Simple spawn position logic
    const spawnPoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];

    const usedPositions = Array.from(game.players.values()).map(
      (p) => p.position,
    );

    for (const point of spawnPoints) {
      const isUsed = usedPositions.some(
        (pos) => pos.x === point.x && pos.y === point.y,
      );
      if (!isUsed) {
        return point;
      }
    }

    // Fallback: random position
    return {
      x: Math.floor(Math.random() * 100),
      y: Math.floor(Math.random() * 100),
    };
  }

  private calculateAverageGameDuration(games: Game[]): number {
    const finishedGames = games.filter(
      (g) => g.state === GameState.FINISHED && g.startedAt && g.finishedAt,
    );

    if (finishedGames.length === 0) return 0;

    const totalDuration = finishedGames.reduce((sum, game) => {
      const duration = game.finishedAt!.getTime() - game.startedAt!.getTime();
      return sum + duration;
    }, 0);

    return totalDuration / finishedGames.length / 1000; // Return in seconds
  }

  private findMostPopularGame(games: Game[]): Game | null {
    const activeGames = games.filter((g) => g.state === GameState.IN_PROGRESS);

    if (activeGames.length === 0) return null;

    return activeGames.reduce((most, game) =>
      game.players.size > most.players.size ? game : most,
    );
  }

  private generateGameId(): string {
    return `game-${this.nodeId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private startCleanupWorker() {
    this.cleanupInterval = setInterval(() => {
      if (!this.raftService.isLeader()) return;

      const now = Date.now();
      const gamesToDelete: string[] = [];

      // Find finished games older than 30 minutes
      for (const [gameId, game] of this.games.entries()) {
        if (
          game.state === GameState.FINISHED &&
          game.finishedAt &&
          now - game.finishedAt.getTime() > 1800000 // 30 minutes
        ) {
          gamesToDelete.push(gameId);
        }
      }

      // Delete old games
      gamesToDelete.forEach((gameId) => {
        this.raftService.propose({
          type: "DELETE_GAME",
          gameId,
          timestamp: Date.now(),
        });
      });

      if (gamesToDelete.length > 0) {
        this.logger.log(
          `Cleaning up ${gamesToDelete.length} old games`,
          "GameServer",
        );
      }
    }, 300000); // Run every 5 minutes
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
