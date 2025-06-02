import { Module } from "@nestjs/common";
import { CliService } from "./cli.service";

@Module({
  providers: [CliService],
  exports: [CliService],
})
export class CliModule {}
