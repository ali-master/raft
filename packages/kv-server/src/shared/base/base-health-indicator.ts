import { HealthIndicator } from "@nestjs/terminus";
import type { HealthIndicatorResult } from "@nestjs/terminus";

export abstract class BaseHealthIndicator extends HealthIndicator {
  protected async checkHealth(
    key: string,
    healthCheckFn: () => Promise<any>,
    getHealthData?: (result: any) => Record<string, any>,
  ): Promise<HealthIndicatorResult> {
    try {
      const result = await healthCheckFn();
      const isHealthy = Boolean(result);
      const healthData = getHealthData ? getHealthData(result) : {};

      return this.getStatus(key, isHealthy, {
        ...healthData,
        message: isHealthy ? `${key} is healthy` : `${key} is not healthy`,
      });
    } catch (error) {
      return this.getStatus(key, false, {
        message: `${key} health check failed: ${(error as Error).message}`,
      });
    }
  }
}
