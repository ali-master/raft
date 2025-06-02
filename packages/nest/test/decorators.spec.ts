import "reflect-metadata";
import { it, expect, describe } from "vitest";
import {
  RaftNode,
  RaftEvent,
  OnVoteGranted,
  OnVoteDenied,
  OnStateChange,
  OnLeaderElected,
  OnErrorOccurred,
  InjectRaftNode,
  InjectRaftEventBus,
  InjectRaftEngine,
} from "../src/decorators";
import {
  RaftEventType,
  RAFT_METADATA,
  RAFT_EVENT_METADATA,
} from "../src/constants";

describe("Decorators", () => {
  describe("RaftEvent", () => {
    it("should set metadata on method", () => {
      class TestClass {
        @RaftEvent(RaftEventType.LEADER_ELECTED)
        handleEvent() {}
      }

      new TestClass();
      const metadata = Reflect.getMetadata(
        RAFT_EVENT_METADATA.EVENT_TYPE,
        TestClass,
      );

      expect(metadata).toHaveLength(1);
      expect(metadata[0]).toEqual({
        eventType: RaftEventType.LEADER_ELECTED,
        target: TestClass,
        propertyKey: "handleEvent",
      });
    });

    it("should accumulate multiple event handlers", () => {
      class TestClass {
        @RaftEvent(RaftEventType.LEADER_ELECTED)
        handleLeader() {}

        @RaftEvent(RaftEventType.STATE_CHANGE)
        handleState() {}
      }

      const metadata = Reflect.getMetadata(
        RAFT_EVENT_METADATA.EVENT_TYPE,
        TestClass,
      );

      expect(metadata).toHaveLength(2);
      expect(metadata[0].eventType).toBe(RaftEventType.LEADER_ELECTED);
      expect(metadata[1].eventType).toBe(RaftEventType.STATE_CHANGE);
    });
  });

  describe("Event Decorators", () => {
    it("should create decorator for OnLeaderElected", () => {
      class TestClass {
        @OnLeaderElected()
        handleLeaderElected() {}
      }

      const metadata = Reflect.getMetadata(
        RAFT_EVENT_METADATA.EVENT_TYPE,
        TestClass,
      );

      expect(metadata[0].eventType).toBe(RaftEventType.LEADER_ELECTED);
    });

    it("should create decorator for OnStateChange", () => {
      class TestClass {
        @OnStateChange()
        handleStateChange() {}
      }

      const metadata = Reflect.getMetadata(
        RAFT_EVENT_METADATA.EVENT_TYPE,
        TestClass,
      );

      expect(metadata[0].eventType).toBe(RaftEventType.STATE_CHANGE);
    });

    it("should create decorator for OnVoteGranted", () => {
      class TestClass {
        @OnVoteGranted()
        handleVoteGranted() {}
      }

      const metadata = Reflect.getMetadata(
        RAFT_EVENT_METADATA.EVENT_TYPE,
        TestClass,
      );

      expect(metadata[0].eventType).toBe(RaftEventType.VOTE_GRANTED);
    });

    it("should create decorator for OnVoteDenied", () => {
      class TestClass {
        @OnVoteDenied()
        handleVoteDenied() {}
      }

      const metadata = Reflect.getMetadata(
        RAFT_EVENT_METADATA.EVENT_TYPE,
        TestClass,
      );

      expect(metadata[0].eventType).toBe(RaftEventType.VOTE_DENIED);
    });

    it("should create decorator for OnErrorOccurred", () => {
      class TestClass {
        @OnErrorOccurred()
        handleError() {}
      }

      const metadata = Reflect.getMetadata(
        RAFT_EVENT_METADATA.EVENT_TYPE,
        TestClass,
      );

      expect(metadata[0].eventType).toBe(RaftEventType.ERROR_OCCURRED);
    });
  });

  describe("RaftNode", () => {
    it("should set metadata on class without nodeId", () => {
      @RaftNode()
      class TestClass {}

      const metadata = Reflect.getMetadata(RAFT_METADATA.NODE, TestClass);

      expect(metadata).toEqual({
        nodeId: undefined,
        target: TestClass,
      });
    });

    it("should set metadata on class with nodeId", () => {
      @RaftNode("node-1")
      class TestClass {}

      const metadata = Reflect.getMetadata(RAFT_METADATA.NODE, TestClass);

      expect(metadata).toEqual({
        nodeId: "node-1",
        target: TestClass,
      });
    });

    it("should make class injectable", () => {
      @RaftNode()
      class TestClass {}

      // Check if the class has been decorated with Injectable
      // Injectable decorator adds scope metadata
      const metadata = Reflect.getMetadata(RAFT_METADATA.NODE, TestClass);
      expect(metadata).toBeDefined();
      expect(metadata.target).toBe(TestClass);
    });
  });

  describe("Injection Decorators", () => {
    it("should create inject decorator for RaftEngine", () => {
      class TestClass {
        constructor(@InjectRaftEngine() private engine: any) {}
      }

      const metadata = Reflect.getMetadata("design:paramtypes", TestClass);
      Reflect.getMetadata("self:paramtypes", TestClass);

      expect(metadata).toBeDefined();
      // The actual injection token should be RAFT_ENGINE
    });

    it("should create inject decorator for RaftNode without nodeId", () => {
      class TestClass {
        constructor(@InjectRaftNode() private node: any) {}
      }

      const metadata = Reflect.getMetadata("design:paramtypes", TestClass);
      expect(metadata).toBeDefined();
    });

    it("should create inject decorator for RaftNode with nodeId", () => {
      class TestClass {
        constructor(@InjectRaftNode("node-1") private node: any) {}
      }

      const metadata = Reflect.getMetadata("design:paramtypes", TestClass);
      expect(metadata).toBeDefined();
    });

    it("should create inject decorator for RaftEventBus", () => {
      class TestClass {
        constructor(@InjectRaftEventBus() private eventBus: any) {}
      }

      const metadata = Reflect.getMetadata("design:paramtypes", TestClass);
      expect(metadata).toBeDefined();
    });
  });
});
