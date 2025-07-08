import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";

/**
 * Network conditions configuration
 */
export interface NetworkConditions {
  latency: { min: number; max: number; distribution: "uniform" | "gaussian" };
  packetLoss: number;
  bandwidth: number; // Mbps
  jitter: number;
}

/**
 * Network Simulator Service
 *
 * Simulates various network conditions for testing adaptive consensus behavior
 */
@Injectable()
export class NetworkSimulatorService {
  private readonly logger = new Logger(NetworkSimulatorService.name);
  private currentConditions: NetworkConditions | null = null;
  private simulationActive = false;

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Set network conditions
   */
  async setConditions(conditions: NetworkConditions): Promise<void> {
    this.currentConditions = conditions;
    this.simulationActive = true;

    this.logger.log("Network conditions updated", {
      latency: `${conditions.latency.min}-${conditions.latency.max}ms`,
      packetLoss: `${conditions.packetLoss * 100}%`,
      bandwidth: `${conditions.bandwidth}Mbps`,
      jitter: `${conditions.jitter}ms`,
    });

    this.eventEmitter.emit("network.conditions.changed", {
      conditions,
      timestamp: new Date(),
    });
  }

  /**
   * Get current network conditions
   */
  getConditions(): NetworkConditions | null {
    return this.currentConditions;
  }

  /**
   * Simulate network latency
   */
  simulateLatency(): number {
    if (!this.currentConditions || !this.simulationActive) {
      return 0;
    }

    const { min, max, distribution } = this.currentConditions.latency;

    if (distribution === "uniform") {
      return Math.random() * (max - min) + min;
    } else {
      // gaussian
      // Simplified gaussian - using Box-Muller transform
      const mean = (min + max) / 2;
      const stdDev = (max - min) / 6; // 99.7% within range

      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

      return Math.max(min, Math.min(max, mean + z0 * stdDev));
    }
  }

  /**
   * Simulate packet loss
   */
  shouldDropPacket(): boolean {
    if (!this.currentConditions || !this.simulationActive) {
      return false;
    }

    return Math.random() < this.currentConditions.packetLoss;
  }

  /**
   * Simulate bandwidth constraint
   */
  simulateBandwidthDelay(dataSize: number): number {
    if (!this.currentConditions || !this.simulationActive) {
      return 0;
    }

    // Convert data size from bytes to bits and bandwidth from Mbps to bps
    const bits = dataSize * 8;
    const bitsPerSecond = this.currentConditions.bandwidth * 1_000_000;

    // Calculate transmission delay in milliseconds
    return (bits / bitsPerSecond) * 1000;
  }

  /**
   * Simulate jitter
   */
  simulateJitter(): number {
    if (!this.currentConditions || !this.simulationActive) {
      return 0;
    }

    // Jitter is random variation around 0
    return (Math.random() - 0.5) * 2 * this.currentConditions.jitter;
  }

  /**
   * Calculate total delay for a network operation
   */
  calculateTotalDelay(dataSize: number = 1024): number {
    if (!this.simulationActive) {
      return 0;
    }

    const latency = this.simulateLatency();
    const jitter = this.simulateJitter();
    const bandwidthDelay = this.simulateBandwidthDelay(dataSize);

    return Math.max(0, latency + jitter + bandwidthDelay);
  }

  /**
   * Start simulation
   */
  async start(): Promise<void> {
    this.simulationActive = true;
    this.logger.log("Network simulation started");
  }

  /**
   * Stop simulation
   */
  async stop(): Promise<void> {
    this.simulationActive = false;
    this.currentConditions = null;
    this.logger.log("Network simulation stopped");
  }

  /**
   * Check if simulation is active
   */
  isActive(): boolean {
    return this.simulationActive;
  }

  /**
   * Reset to normal conditions
   */
  async reset(): Promise<void> {
    await this.setConditions({
      latency: { min: 1, max: 5, distribution: "uniform" },
      packetLoss: 0,
      bandwidth: 1000,
      jitter: 0,
    });
  }
}
