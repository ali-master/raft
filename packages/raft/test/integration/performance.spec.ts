import { it, expect, describe } from "vitest";
import { RaftMetricsCollector } from "../../src/monitoring/metrics-collector";
import { RaftEventBus } from "../../src/services/event-bus";
import { RaftEvent } from "../../src/types";
import { RaftState, RaftEventType } from "../../src/constants";
import { createTestConfig } from "../shared/test-utils";

describe("performance Tests", () => {
  it("should handle high-frequency metric updates", async () => {
    const config = createTestConfig();
    const collector = new RaftMetricsCollector(config.metrics);

    const startTime = Date.now();
    const iterations = 10000;

    for (let i = 0; i < iterations; i++) {
      collector.updateMetrics("perf-node", "cluster", {
        currentTerm: i,
        state: i % 3 === 0 ? RaftState.LEADER : RaftState.FOLLOWER,
        commitIndex: i,
        logLength: i * 2,
      });
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should handle 10k updates in under 100ms
    expect(duration).toBeLessThan(100);

    const metrics = collector.getMetrics("perf-node");
    expect(metrics?.currentTerm).toBe(iterations - 1);
  });

  it("should handle many concurrent events", async () => {
    const eventBus = new RaftEventBus();
    let eventCount = 0;

    eventBus.on(RaftEventType.HEARTBEAT, () => {
      eventCount++;
    });

    const startTime = Date.now();
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const event = new RaftEvent(RaftEventType.HEARTBEAT, `node-${i}`, {
        term: i,
        leaderId: "leader",
      });
      eventBus.publish(event);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should handle 1k events in under 50ms
    expect(duration).toBeLessThan(50);
    expect(eventCount).toBe(iterations);
  });
});
