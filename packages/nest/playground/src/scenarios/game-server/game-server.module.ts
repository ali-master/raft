import { Module } from "@nestjs/common";
import { GameServerController } from "./game-server.controller";
import { GameServerService } from "./game-server.service";
import { GameEventHandler } from "./game-event.handler";
import { GameServerGateway } from "./game-server.gateway";

@Module({
  controllers: [GameServerController],
  providers: [GameServerService, GameEventHandler, GameServerGateway],
  exports: [GameServerService],
})
export class GameServerModule {}
