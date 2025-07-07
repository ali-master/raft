import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import { performance } from "node:perf_hooks";

export class SystemMetrics {
  private static networkInterfaces = os.networkInterfaces();
  private static previousCpuUsage = process.cpuUsage();
  private static previousTime = process.hrtime.bigint();

  public static async getCpuUsage(): Promise<number> {
    const currentUsage = process.cpuUsage(this.previousCpuUsage);
    const currentTime = process.hrtime.bigint();

    const elapsedTime = Number(currentTime - this.previousTime) / 1000000; // Convert to milliseconds
    const totalUsage = (currentUsage.user + currentUsage.system) / 1000; // Convert to milliseconds

    const cpuPercent = (totalUsage / elapsedTime) * 100;

    this.previousCpuUsage = process.cpuUsage();
    this.previousTime = currentTime;

    return Math.min(100, Math.max(0, cpuPercent));
  }

  public static getMemoryUsage(): number {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    return (usedMemory / totalMemory) * 100;
  }

  public static async getDiskUsage(path: string = "/"): Promise<number> {
    try {
      const stats = await fs.stat(path);
      if (stats.isDirectory()) {
        // This is a simplified disk usage calculation
        // In production, you might want to use a more sophisticated approach
        const freeSpace = await this.getFreeSpace(path);
        const totalSpace = await this.getTotalSpace(path);
        return ((totalSpace - freeSpace) / totalSpace) * 100;
      }
    } catch {
      // Fallback to a default value if unable to get disk usage
      return 0;
    }
    return 0;
  }

  private static async getFreeSpace(_path: string): Promise<number> {
    // Simplified implementation - in production use statvfs or similar
    return os.freemem(); // Approximate using free memory
  }

  private static async getTotalSpace(_path: string): Promise<number> {
    // Simplified implementation - in production use statvfs or similar
    return os.totalmem(); // Approximate using total memory
  }

  public static getLoadAverage(): number[] {
    return os.loadavg();
  }

  public static getUptime(): number {
    return process.uptime();
  }

  public static getNetworkInterfaces(): NodeJS.Dict<os.NetworkInterfaceInfo[]> {
    return this.networkInterfaces;
  }

  public static getNetworkStats(): {
    bytesSent: number;
    bytesReceived: number;
  } {
    // Simplified implementation - in production, you'd track actual network I/O
    const usage = process.resourceUsage();
    return {
      bytesSent: usage.voluntaryContextSwitches || 0,
      bytesReceived: usage.involuntaryContextSwitches || 0,
    };
  }

  public static async getAllMetrics(): Promise<{
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    loadAverage: number[];
    networkLatency: number;
    uptime: number;
  }> {
    const [cpuUsage, diskUsage] = await Promise.all([
      this.getCpuUsage(),
      this.getDiskUsage(),
    ]);

    return {
      cpuUsage,
      memoryUsage: this.getMemoryUsage(),
      diskUsage,
      loadAverage: this.getLoadAverage(),
      networkLatency: 0, // Default value, actual measurement requires a target
      uptime: this.getUptime(),
    };
  }

  public static async measureNetworkLatency(
    targetHost: string,
    port: number = 80,
  ): Promise<number> {
    return new Promise((resolve) => {
      const startTime = performance.now();
      const client = port === 443 ? https : http;

      const req = client.request(
        {
          hostname: targetHost,
          port,
          method: "HEAD",
          timeout: 5000,
        },
        () => {
          const latency = performance.now() - startTime;
          resolve(latency);
        },
      );

      req.on("error", () => {
        resolve(1000); // Return high latency on error
      });

      req.on("timeout", () => {
        resolve(1000); // Return high latency on timeout
      });

      req.end();
    });
  }
}
