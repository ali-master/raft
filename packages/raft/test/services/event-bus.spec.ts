import { it, expect, describe, beforeEach } from "vitest";
import { RaftEventBus } from "../../src/services/event-bus";
import { RaftEvent } from "../../src/types";
import { RaftState, RaftEventType } from "../../src/constants";

describe("raftEventBus", () => {
  let eventBus: RaftEventBus;

  beforeEach(() => {
    eventBus = new RaftEventBus();
  });

  it("should publish and emit events", async () => {
    const event = new RaftEvent(RaftEventType.STATE_CHANGE, "node1", { state: RaftState.LEADER });

    const eventPromise = new Promise<void>((resolve) => {
      eventBus.on(RaftEventType.STATE_CHANGE, (receivedEvent: RaftEvent) => {
        expect(receivedEvent.type).toBe(RaftEventType.STATE_CHANGE);
        expect(receivedEvent.nodeId).toBe("node1");
        expect(receivedEvent.data).toEqual({ state: RaftState.LEADER });
        resolve();
      });
    });

    eventBus.publish(event);
    await eventPromise;
  });

  it("should store events and retrieve them", () => {
    const event1 = new RaftEvent(RaftEventType.STATE_CHANGE, "node1", { state: RaftState.FOLLOWER });
    const event2 = new RaftEvent(RaftEventType.LEADER_ELECTED, "node1", { leader: "node2" });

    eventBus.publish(event1);
    eventBus.publish(event2);

    const allEvents = eventBus.getEvents("node1");
    expect(allEvents).toHaveLength(2);
    expect(allEvents[0].type).toBe(RaftEventType.STATE_CHANGE);
    expect(allEvents[1].type).toBe(RaftEventType.LEADER_ELECTED);
  });

  it("should filter events by type", () => {
    const event1 = new RaftEvent(RaftEventType.STATE_CHANGE, "node1", { state: RaftState.FOLLOWER });
    const event2 = new RaftEvent(RaftEventType.LEADER_ELECTED, "node1", { leader: "node2" });
    const event3 = new RaftEvent(RaftEventType.STATE_CHANGE, "node1", { state: RaftState.CANDIDATE });

    eventBus.publish(event1);
    eventBus.publish(event2);
    eventBus.publish(event3);

    const stateChangeEvents = eventBus.getEvents("node1", RaftEventType.STATE_CHANGE);
    expect(stateChangeEvents).toHaveLength(2);
    expect(stateChangeEvents[0].data.state).toBe(RaftState.FOLLOWER);
    expect(stateChangeEvents[1].data.state).toBe(RaftState.CANDIDATE);
  });

  it("should handle multiple listeners", () => {
    let count = 0;
    const listener1 = () => count++;
    const listener2 = () => count++;

    eventBus.on(RaftEventType.VOTE_GRANTED, listener1);
    eventBus.on(RaftEventType.VOTE_GRANTED, listener2);

    const event = new RaftEvent(RaftEventType.VOTE_GRANTED, "node1", {});
    eventBus.publish(event);

    expect(count).toBe(2);
  });

  it("should remove listeners", () => {
    let called = false;
    const listener = () => { called = true; };

    eventBus.on(RaftEventType.HEARTBEAT, listener);
    eventBus.off(RaftEventType.HEARTBEAT, listener);

    const event = new RaftEvent(RaftEventType.HEARTBEAT, "node1", {});
    eventBus.publish(event);

    expect(called).toBe(false);
  });
});
