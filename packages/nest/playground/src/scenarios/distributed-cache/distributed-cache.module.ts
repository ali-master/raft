import { Module } from "@nestjs/common";
import { DistributedCacheController } from "./distributed-cache.controller";
import { DistributedCacheService } from "./distributed-cache.service";
import { CacheEventHandler } from "./cache-event.handler";

@Module({
  controllers: [DistributedCacheController],
  providers: [DistributedCacheService, CacheEventHandler],
  exports: [DistributedCacheService],
})
export class DistributedCacheModule {}
