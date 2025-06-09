import { Injectable } from "@nestjs/common";
import type { HealthIndicatorResult } from "@nestjs/terminus";
import type { KVStoreService } from "../../kv-store/kv-store.service";
import { BaseHealthIndicator } from "../../shared";

@Injectable()
export class KVStoreHealthIndicator extends BaseHealthIndicator {
  constructor(private readonly kvStoreService: KVStoreService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    return this.checkHealth(
      key,
      () => this.kvStoreService.isHealthy(),
    );
  }
}
