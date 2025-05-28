import { it, expect, describe } from "vitest";
import { SystemMetrics } from "../../src/utils/system-metrics";

describe("systemMetrics", () => {
  describe("getCpuUsage", () => {
    it("should return CPU usage percentage between 0 and 100", async () => {
      const cpuUsage = await SystemMetrics.getCpuUsage();
      expect(cpuUsage).toBeGreaterThanOrEqual(0);
      expect(cpuUsage).toBeLessThanOrEqual(100);
    });

    it("should return different values on consecutive calls", async () => {
      const usage1 = await SystemMetrics.getCpuUsage();
      // Do some work to change CPU usage
      const _arr = Array.from({ length: 1000000 }).fill(0).map((_, i) => i * 2);
      const usage2 = await SystemMetrics.getCpuUsage();

      expect(usage1).not.toBe(usage2);
    });
  });

  describe("getMemoryUsage", () => {
    it("should return memory usage percentage between 0 and 100", () => {
      const memUsage = SystemMetrics.getMemoryUsage();
      expect(memUsage).toBeGreaterThanOrEqual(0);
      expect(memUsage).toBeLessThanOrEqual(100);
    });
  });

  describe("getDiskUsage", () => {
    it("should return disk usage percentage between 0 and 100", async () => {
      const diskUsage = await SystemMetrics.getDiskUsage();
      expect(diskUsage).toBeGreaterThanOrEqual(0);
      expect(diskUsage).toBeLessThanOrEqual(100);
    });
  });

  describe("getLoadAverage", () => {
    it("should return array of three numbers for load average", () => {
      const loadAvg = SystemMetrics.getLoadAverage();
      expect(loadAvg).toHaveLength(3);
      expect(loadAvg[0]).toBeGreaterThanOrEqual(0);
      expect(loadAvg[1]).toBeGreaterThanOrEqual(0);
      expect(loadAvg[2]).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getNetworkStats", () => {
    it("should return network statistics with bytes sent and received", () => {
      const stats = SystemMetrics.getNetworkStats();
      expect(stats.bytesSent).toBeGreaterThanOrEqual(0);
      expect(stats.bytesReceived).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getUptime", () => {
    it("should return system uptime in seconds", () => {
      const uptime = SystemMetrics.getUptime();
      expect(uptime).toBeGreaterThan(0);
    });
  });

  describe("getAllMetrics", () => {
    it("should return all system metrics", async () => {
      const metrics = await SystemMetrics.getAllMetrics();

      expect(metrics).toHaveProperty("cpuUsage");
      expect(metrics).toHaveProperty("memoryUsage");
      expect(metrics).toHaveProperty("diskUsage");
      expect(metrics).toHaveProperty("loadAverage");
      expect(metrics).toHaveProperty("networkLatency");
      expect(metrics).toHaveProperty("uptime");

      expect(metrics.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(metrics.cpuUsage).toBeLessThanOrEqual(100);
      expect(metrics.memoryUsage).toBeGreaterThanOrEqual(0);
      expect(metrics.memoryUsage).toBeLessThanOrEqual(100);
      expect(metrics.diskUsage).toBeGreaterThanOrEqual(0);
      expect(metrics.diskUsage).toBeLessThanOrEqual(100);
      expect(metrics.loadAverage).toHaveLength(3);
      expect(metrics.uptime).toBeGreaterThan(0);
    });
  });
});
