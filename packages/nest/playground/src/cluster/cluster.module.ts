import { Module } from "@nestjs/common";
import { ClusterController } from "./cluster.controller";
import { ClusterService } from "./cluster.service";

@Module({
  controllers: [ClusterController],
  providers: [ClusterService],
  exports: [ClusterService],
})
export class ClusterModule {}
