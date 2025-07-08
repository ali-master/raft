import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";

/**
 * Load pattern configuration
 */
export interface LoadPattern {
  requestRate: number; // requests per second
  burstProbability: number; // 0-1
  burstMultiplier: number;
}

/**
 * Load Generator Service
 *
 * Generates synthetic load for testing adaptive consensus under various conditions
 */
@Injectable()
export class LoadGeneratorService {
  private readonly logger = new Logger(LoadGeneratorService.name);
  private currentPattern: LoadPattern | null = null;
  private generationActive = false;
  private requestInterval?: NodeJS.Timeout;
  private totalRequests = 0;
  private currentRate = 0;

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Set load pattern
   */
  async setLoadPattern(pattern: LoadPattern): Promise<void> {
    this.currentPattern = pattern;

    this.logger.log("Load pattern updated", {
      baseRate: `${pattern.requestRate} req/s`,
      burstProbability: `${pattern.burstProbability * 100}%`,
      burstMultiplier: `${pattern.burstMultiplier}x`,
    });

    // Restart generation with new pattern
    if (this.generationActive) {
      await this.stop();
      await this.start();
    }

    this.eventEmitter.emit("load.pattern.changed", {
      pattern,
      timestamp: new Date(),
    });
  }

  /**
   * Get current load pattern
   */
  getLoadPattern(): LoadPattern | null {
    return this.currentPattern;
  }

  /**
   * Start load generation
   */
  async start(): Promise<void> {
    if (this.generationActive || !this.currentPattern) {
      return;
    }

    this.generationActive = true;
    this.totalRequests = 0;
    this.logger.log("Load generation started");

    // Calculate interval based on base request rate
    const baseInterval = 1000 / this.currentPattern.requestRate;

    this.requestInterval = setInterval(() => {
      this.generateRequests();
    }, baseInterval);
  }

  /**
   * Stop load generation
   */
  async stop(): Promise<void> {
    this.generationActive = false;

    if (this.requestInterval) {
      clearInterval(this.requestInterval);
      this.requestInterval = undefined;
    }

    this.logger.log("Load generation stopped", {
      totalRequests: this.totalRequests,
    });
  }

  /**
   * Generate requests based on current pattern
   */
  private generateRequests(): void {
    if (!this.currentPattern || !this.generationActive) {
      return;
    }

    // Determine if this is a burst period
    const isBurst = Math.random() < this.currentPattern.burstProbability;
    const multiplier = isBurst ? this.currentPattern.burstMultiplier : 1;

    // Calculate number of requests for this interval
    const requestCount = Math.round(multiplier);
    this.currentRate = this.currentPattern.requestRate * multiplier;

    // Generate the requests
    for (let i = 0; i < requestCount; i++) {
      this.generateSingleRequest();
    }
  }

  /**
   * Generate a single request
   */
  private generateSingleRequest(): void {
    this.totalRequests++;

    // Emit request event
    this.eventEmitter.emit("load.request.generated", {
      requestId: `req-${this.totalRequests}`,
      timestamp: new Date(),
      isBurst: this.currentRate > (this.currentPattern?.requestRate || 0),
    });

    // Simulate different types of requests
    const requestType = this.selectRequestType();

    this.eventEmitter.emit(`load.request.${requestType}`, {
      requestId: `req-${this.totalRequests}`,
      type: requestType,
      timestamp: new Date(),
    });
  }

  /**
   * Select request type based on realistic distribution
   */
  private selectRequestType(): string {
    const rand = Math.random();

    if (rand < 0.6) {
      return "read"; // 60% reads
    } else if (rand < 0.9) {
      return "write"; // 30% writes
    } else {
      return "config"; // 10% configuration changes
    }
  }

  /**
   * Get current load statistics
   */
  getStatistics(): {
    active: boolean;
    totalRequests: number;
    currentRate: number;
    pattern: LoadPattern | null;
  } {
    return {
      active: this.generationActive,
      totalRequests: this.totalRequests,
      currentRate: this.currentRate,
      pattern: this.currentPattern,
    };
  }

  /**
   * Check if generation is active
   */
  isActive(): boolean {
    return this.generationActive;
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    this.totalRequests = 0;
    this.currentRate = 0;
  }

  /**
   * Generate a burst of requests
   */
  async generateBurst(count: number): Promise<void> {
    this.logger.log(`Generating burst of ${count} requests`);

    for (let i = 0; i < count; i++) {
      this.generateSingleRequest();
      // Small delay to prevent overwhelming the system
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
}
