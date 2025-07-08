import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from "@nestjs/swagger";
import { GameServerService } from "./game-server.service";

class CreateGameDto {
  name: string;
  maxPlayers?: number;
  settings?: any;
}

class JoinGameDto {
  playerId: string;
  playerName: string;
}

class UpdatePlayerDto {
  position?: { x: number; y: number };
  health?: number;
  score?: number;
}

class UpdateWorldDto {
  objects?: any[];
  powerups?: any[];
  events?: any[];
  time?: number;
}

@ApiTags("game-server")
@Controller("games")
export class GameServerController {
  constructor(private readonly gameServerService: GameServerService) {}

  @Get("stats")
  @ApiOperation({ summary: "Get game server statistics" })
  @ApiResponse({ status: 200, description: "Server statistics" })
  async getStats() {
    return this.gameServerService.getStats();
  }

  @Get()
  @ApiOperation({ summary: "List active games" })
  @ApiResponse({ status: 200, description: "Array of active games" })
  async getActiveGames() {
    const games = this.gameServerService.getActiveGames();
    return games.map((game) => ({
      id: game.id,
      name: game.name,
      state: game.state,
      playerCount: game.players.size,
      maxPlayers: game.maxPlayers,
      createdAt: game.createdAt,
      startedAt: game.startedAt,
    }));
  }

  @Get("player/:playerId")
  @ApiOperation({ summary: "Get game for player" })
  @ApiResponse({ status: 200, description: "Game details" })
  @ApiResponse({ status: 404, description: "Player not in any game" })
  async getPlayerGame(@Param("playerId") playerId: string) {
    const game = this.gameServerService.getPlayerGames(playerId);
    if (!game) {
      return { found: false, game: null };
    }

    return {
      found: true,
      game: {
        id: game.id,
        name: game.name,
        state: game.state,
        players: Array.from(game.players.values()),
        worldState: game.worldState,
        settings: game.settings,
      },
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get game details" })
  @ApiResponse({ status: 200, description: "Game details" })
  @ApiResponse({ status: 404, description: "Game not found" })
  async getGame(@Param("id") id: string) {
    const game = this.gameServerService.getGame(id);
    if (!game) {
      return { found: false, game: null };
    }

    return {
      found: true,
      game: {
        id: game.id,
        name: game.name,
        state: game.state,
        players: Array.from(game.players.values()),
        maxPlayers: game.maxPlayers,
        createdAt: game.createdAt,
        startedAt: game.startedAt,
        finishedAt: game.finishedAt,
        winner: game.winner,
        settings: game.settings,
        worldState: game.worldState,
      },
    };
  }

  @Post()
  @ApiOperation({ summary: "Create a new game" })
  @ApiBody({ type: CreateGameDto })
  @ApiResponse({ status: 201, description: "Game created" })
  @ApiResponse({ status: 400, description: "Not the leader node" })
  async createGame(@Body() dto: CreateGameDto) {
    const game = await this.gameServerService.createGame(
      dto.name,
      dto.maxPlayers,
      dto.settings,
    );

    return {
      id: game.id,
      name: game.name,
      state: game.state,
      maxPlayers: game.maxPlayers,
      createdAt: game.createdAt,
    };
  }

  @Post(":id/join")
  @ApiOperation({ summary: "Join a game" })
  @ApiBody({ type: JoinGameDto })
  @ApiResponse({ status: 200, description: "Joined game" })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 404, description: "Game not found" })
  async joinGame(@Param("id") id: string, @Body() dto: JoinGameDto) {
    const player = await this.gameServerService.joinGame(
      id,
      dto.playerId,
      dto.playerName,
    );
    return player;
  }

  @Post(":id/leave/:playerId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Leave a game" })
  @ApiResponse({ status: 204, description: "Left game" })
  @ApiResponse({ status: 400, description: "Not the leader node" })
  async leaveGame(
    @Param("id") id: string,
    @Param("playerId") playerId: string,
  ) {
    await this.gameServerService.leaveGame(id, playerId);
  }

  @Post(":id/start")
  @ApiOperation({ summary: "Start a game" })
  @ApiResponse({ status: 200, description: "Game started" })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 404, description: "Game not found" })
  async startGame(@Param("id") id: string) {
    await this.gameServerService.startGame(id);
    return { success: true };
  }

  @Put(":id/player/:playerId")
  @ApiOperation({ summary: "Update player state" })
  @ApiBody({ type: UpdatePlayerDto })
  @ApiResponse({ status: 200, description: "Player updated" })
  @ApiResponse({ status: 400, description: "Not the leader node" })
  async updatePlayer(
    @Param("id") id: string,
    @Param("playerId") playerId: string,
    @Body() dto: UpdatePlayerDto,
  ) {
    await this.gameServerService.updatePlayerState(id, playerId, dto);
    return { success: true };
  }

  @Put(":id/world")
  @ApiOperation({ summary: "Update world state" })
  @ApiBody({ type: UpdateWorldDto })
  @ApiResponse({ status: 200, description: "World updated" })
  @ApiResponse({ status: 400, description: "Not the leader node" })
  async updateWorld(@Param("id") id: string, @Body() dto: UpdateWorldDto) {
    await this.gameServerService.updateWorldState(id, dto);
    return { success: true };
  }

  @Post(":id/finish")
  @ApiOperation({ summary: "Finish a game" })
  @ApiBody({ schema: { properties: { winnerId: { type: "string" } } } })
  @ApiResponse({ status: 200, description: "Game finished" })
  @ApiResponse({ status: 400, description: "Not the leader node" })
  async finishGame(
    @Param("id") id: string,
    @Body("winnerId") winnerId?: string,
  ) {
    await this.gameServerService.finishGame(id, winnerId);
    return { success: true };
  }
}
