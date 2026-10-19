import { HealthIndicatorService } from "@nestjs/terminus";
import type { HealthIndicatorResult } from "@nestjs/terminus";

export abstract class BaseHealthIndicator {
  private readonly healthIndicatorService = new HealthIndicatorService();

  protected async checkHealth(
    key: string,
    healthCheckFn: () => Promise<any>,
    getHealthData?: (result: any) => Record<string, any>,
  ): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const result = await healthCheckFn();
      const isHealthy = Boolean(result);
      const healthData = getHealthData ? getHealthData(result) : {};

      const data = {
        ...healthData,
        message: isHealthy ? `${key} is healthy` : `${key} is not healthy`,
      };
      return isHealthy ? indicator.up(data) : indicator.down(data);
    } catch (error) {
      return indicator.down({
        message: `${key} health check failed: ${(error as Error).message}`,
      });
    }
  }
}
