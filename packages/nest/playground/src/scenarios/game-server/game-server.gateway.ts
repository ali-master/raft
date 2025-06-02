import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { GameServerService } from "./game-server.service";
import { EventBusService } from "@/shared/services/event-bus.service";
import { LoggerService } from "@/shared/services/logger.service";
import { UseFilters } from "@nestjs/common";
import { WsExceptionFilter } from "@/shared/filters/ws-exception.filter";

@WebSocketGateway({
  namespace: "/game",
  cors: {
    origin: "*",
  },
})
@UseFilters(new WsExceptionFilter())
export class GameServerGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private connectedClients = new Map<
    string,
    { playerId?: string; gameId?: string }
  >();

  constructor(
    private readonly gameServerService: GameServerService,
    private readonly eventBus: EventBusService,
    private readonly logger: LoggerService,
  ) {
    this.subscribeToGameEvents();
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`, "GameGateway");
    this.connectedClients.set(client.id, {});

    // Send current game state
    const games = this.gameServerService.getActiveGames();
    client.emit(
      "games_list",
      games.map((game) => ({
        id: game.id,
        name: game.name,
        state: game.state,
        playerCount: game.players.size,
        maxPlayers: game.maxPlayers,
      })),
    );
  }

  handleDisconnect(client: Socket) {
    const clientInfo = this.connectedClients.get(client.id);

    if (clientInfo?.playerId && clientInfo?.gameId) {
      // Auto-leave game on disconnect
      this.gameServerService
        .leaveGame(clientInfo.gameId, clientInfo.playerId)
        .catch((err) =>
          this.logger.error(
            `Failed to auto-leave: ${err.message}`,
            err.stack,
            "GameGateway",
          ),
        );
    }

    this.connectedClients.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`, "GameGateway");
  }

  @SubscribeMessage("join_game")
  async handleJoinGame(
    @MessageBody()
    data: { gameId: string; playerId: string; playerName: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const player = await this.gameServerService.joinGame(
        data.gameId,
        data.playerId,
        data.playerName,
      );

      // Track client's game
      const clientInfo = this.connectedClients.get(client.id);
      if (clientInfo) {
        clientInfo.playerId = data.playerId;
        clientInfo.gameId = data.gameId;
      }

      // Join socket room
      client.join(`game:${data.gameId}`);

      // Send success response
      client.emit("joined_game", { player, gameId: data.gameId });

      // Notify other players
      client.to(`game:${data.gameId}`).emit("player_joined", {
        playerId: player.id,
        playerName: player.name,
      });

      // Send current game state
      const game = this.gameServerService.getGame(data.gameId);
      if (game) {
        client.emit("game_state", {
          gameId: game.id,
          state: game.state,
          players: Array.from(game.players.values()),
          worldState: game.worldState,
        });
      }
    } catch (error: any) {
      client.emit("error", { message: error.message });
    }
  }

  @SubscribeMessage("leave_game")
  async handleLeaveGame(
    @MessageBody() data: { gameId: string; playerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.gameServerService.leaveGame(data.gameId, data.playerId);

      // Update client tracking
      const clientInfo = this.connectedClients.get(client.id);
      if (clientInfo) {
        clientInfo.playerId = undefined;
        clientInfo.gameId = undefined;
      }

      // Leave socket room
      client.leave(`game:${data.gameId}`);

      // Send success response
      client.emit("left_game", { gameId: data.gameId });
    } catch (error: any) {
      client.emit("error", { message: error.message });
    }
  }

  @SubscribeMessage("update_position")
  async handleUpdatePosition(
    @MessageBody()
    data: {
      gameId: string;
      playerId: string;
      position: { x: number; y: number };
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.gameServerService.updatePlayerState(
        data.gameId,
        data.playerId,
        { position: data.position },
      );

      // Broadcast to other players in the game
      client.to(`game:${data.gameId}`).emit("player_moved", {
        playerId: data.playerId,
        position: data.position,
      });
    } catch (error: any) {
      client.emit("error", { message: error.message });
    }
  }

  @SubscribeMessage("player_action")
  async handlePlayerAction(
    @MessageBody()
    data: { gameId: string; playerId: string; action: string; params?: any },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      // Handle different game actions
      switch (data.action) {
        case "attack":
        case "defend":
        case "use_item":
          // Broadcast action to all players
          this.server.to(`game:${data.gameId}`).emit("player_action", {
            playerId: data.playerId,
            action: data.action,
            params: data.params,
          });
          break;
      }
    } catch (error: any) {
      client.emit("error", { message: error.message });
    }
  }

  private subscribeToGameEvents() {
    // Subscribe to game events and broadcast to clients
    this.eventBus.onPattern(/^game\./).subscribe((event) => {
      const [_, operation] = event.type.split(".");

      switch (operation) {
        case "created":
          this.server.emit("game_created", event.data);
          break;

        case "started":
          this.server
            .to(`game:${event.data.gameId}`)
            .emit("game_started", event.data);
          break;

        case "player_joined":
          this.server
            .to(`game:${event.data.gameId}`)
            .emit("player_joined", event.data);
          break;

        case "player_left":
          this.server
            .to(`game:${event.data.gameId}`)
            .emit("player_left", event.data);
          break;

        case "player_updated":
          this.server
            .to(`game:${event.data.gameId}`)
            .emit("player_updated", event.data);
          break;

        case "world_updated":
          this.server
            .to(`game:${event.data.gameId}`)
            .emit("world_updated", event.data);
          break;

        case "finished":
          this.server
            .to(`game:${event.data.gameId}`)
            .emit("game_finished", event.data);
          break;
      }
    });
  }
}
