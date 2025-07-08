import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ScheduleModule } from "@nestjs/schedule";
import { SharedModule } from "@shared/shared.module";
import { AdaptiveConsensusService } from "@usex/raft-nestjs";
import { AdaptiveConsensusController } from "./adaptive-consensus.controller";
import { AdaptiveConsensusPlaygroundService } from "./adaptive-consensus-playground.service";
import { AdaptiveConsensusEventHandler } from "./adaptive-consensus-event.handler";
import { NetworkSimulatorService } from "./network-simulator.service";
import { LoadGeneratorService } from "./load-generator.service";
import { AdaptiveConsensusGateway } from "./adaptive-consensus.gateway";

/**
 * Adaptive Consensus Playground Module
 *
 * This module provides a comprehensive playground for testing and demonstrating
 * the adaptive consensus algorithms feature, including simulation capabilities
 * and real-time monitoring.
 */
@Module({
  imports: [
    ConfigModule,
    EventEmitterModule,
    ScheduleModule.forRoot(),
    SharedModule,
  ],
  controllers: [AdaptiveConsensusController],
  providers: [
    AdaptiveConsensusService,
    AdaptiveConsensusPlaygroundService,
    AdaptiveConsensusEventHandler,
    NetworkSimulatorService,
    LoadGeneratorService,
    AdaptiveConsensusGateway,
  ],
  exports: [
    AdaptiveConsensusService,
    AdaptiveConsensusPlaygroundService,
    NetworkSimulatorService,
    LoadGeneratorService,
  ],
})
export class AdaptiveConsensusModule {}
