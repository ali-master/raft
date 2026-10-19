import { it, expect, describe } from "vitest";
import { CounterStateMachine } from "../../playground/src/state-machines/counter-state-machine";
import { KVStateMachine } from "../../playground/src/state-machines/kv-state-machine";

describe("playground state machines", () => {
  it("preserves explicit zero increments and decrements", async () => {
    const counter = new CounterStateMachine("zero");
    await counter.apply(counter.createIncrementCommand(0));
    await counter.apply(counter.createDecrementCommand(0));
    expect(counter.getValue()).toBe(0);
    expect(counter.getVersion()).toBe(2);
  });

  it("round-trips KV snapshots and clears only the owning node's keys", async () => {
    const config = {
      host: process.env.REDIS_HOST!,
      port: Number(process.env.REDIS_PORT),
      keyPrefix: "playground-regression:",
    };
    const first = new KVStateMachine("first", config);
    const second = new KVStateMachine("second", config);
    try {
      await first.apply(first.createSetCommand("key", "first-value"));
      await second.apply(second.createSetCommand("key", "second-value"));
      expect(await first.keys()).toEqual(["key"]);
      expect(await first.size()).toBe(1);
      const snapshot = await first.getSnapshotData();
      await first.apply(first.createClearCommand());
      expect(await first.get("key")).toBeNull();
      expect(await second.get("key")).toBe("second-value");
      await first.applySnapshot(snapshot);
      expect(await first.get("key")).toBe("first-value");
      expect(await second.get("key")).toBe("second-value");
      expect(await first.size()).toBe(1);
    } finally {
      await Promise.all([first.cleanup(), second.cleanup()]);
    }
  });
});
