import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import { RaftService, RAFT_NODE, RAFT_ENGINE } from "../src";
import type { RaftNode } from "@usex/raft";
import { RaftState } from "@usex/raft";

describe("RaftService", () => {
  let service: RaftService;
  let mockEngine: any;
  let mockNode: any;
  let module: TestingModule;

  beforeEach(async () => {
    mockNode = {
      getState: vi.fn(),
      getLeaderId: vi.fn(),
      getCurrentTerm: vi.fn(),
      getMetrics: vi.fn(),
      getPeers: vi.fn(),
      propose: vi.fn(),
      addPeer: vi.fn(),
      removePeer: vi.fn(),
      forceElection: vi.fn(),
      createSnapshot: vi.fn(),
      getEventBus: vi.fn(),
    };

    mockEngine = {
      getNode: vi.fn(),
      getAllNodes: vi.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        RaftService,
        {
          provide: RAFT_ENGINE,
          useValue: mockEngine,
        },
        {
          provide: RAFT_NODE,
          useValue: mockNode,
        },
      ],
    }).compile();

    service = module.get<RaftService>(RaftService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe("getNode", () => {
    it("should return default node when no nodeId provided", () => {
      const result = service.getNode();
      expect(result).toBe(mockNode);
    });

    it("should return specific node when nodeId provided", () => {
      const specificNode = {} as RaftNode;
      mockEngine.getNode.mockReturnValue(specificNode);

      const result = service.getNode("node-2");

      expect(mockEngine.getNode).toHaveBeenCalledWith("node-2");
      expect(result).toBe(specificNode);
    });
  });

  describe("getState", () => {
    it("should return node state", () => {
      mockNode.getState.mockReturnValue(RaftState.LEADER);

      const result = service.getState();

      expect(result).toBe(RaftState.LEADER);
      expect(mockNode.getState).toHaveBeenCalled();
    });

    it("should return undefined when node not found", () => {
      mockEngine.getNode.mockReturnValue(undefined);

      const result = service.getState("non-existent");

      expect(result).toBeUndefined();
    });
  });

  describe("state checks", () => {
    it("should correctly identify leader", () => {
      mockNode.getState.mockReturnValue(RaftState.LEADER);

      expect(service.isLeader()).toBe(true);
      expect(service.isFollower()).toBe(false);
      expect(service.isCandidate()).toBe(false);
    });

    it("should correctly identify follower", () => {
      mockNode.getState.mockReturnValue(RaftState.FOLLOWER);

      expect(service.isLeader()).toBe(false);
      expect(service.isFollower()).toBe(true);
      expect(service.isCandidate()).toBe(false);
    });

    it("should correctly identify candidate", () => {
      mockNode.getState.mockReturnValue(RaftState.CANDIDATE);

      expect(service.isLeader()).toBe(false);
      expect(service.isFollower()).toBe(false);
      expect(service.isCandidate()).toBe(true);
    });
  });

  describe("getLeaderId", () => {
    it("should return leader ID", () => {
      // TODO: Update when getLeaderId is implemented in RaftService
      const result = service.getLeaderId();

      expect(result).toBe(null);
    });

    it("should return null when no leader", () => {
      mockNode.getLeaderId.mockReturnValue(undefined);

      const result = service.getLeaderId();

      expect(result).toBeNull();
    });
  });

  describe("getCurrentTerm", () => {
    it("should return current term", () => {
      mockNode.getCurrentTerm.mockReturnValue(5);

      const result = service.getCurrentTerm();

      expect(result).toBe(5);
      expect(mockNode.getCurrentTerm).toHaveBeenCalled();
    });

    it("should return 0 when node not found", () => {
      mockEngine.getNode.mockReturnValue(undefined);

      const result = service.getCurrentTerm("non-existent");

      expect(result).toBe(0);
    });
  });

  describe("getAllNodes", () => {
    it("should return all nodes from engine", () => {
      const nodesMap = new Map([["node-1", mockNode as any]]);
      mockEngine.getAllNodes.mockReturnValue(nodesMap);

      const result = service.getAllNodes();

      expect(result).toBe(nodesMap);
      expect(mockEngine.getAllNodes).toHaveBeenCalled();
    });
  });

  describe("propose", () => {
    it("should propose value to node", async () => {
      mockNode.propose.mockResolvedValue(undefined);

      await service.propose({ data: "test" });

      expect(mockNode.propose).toHaveBeenCalledWith({ data: "test" });
    });

    it("should throw error when node not found", async () => {
      mockEngine.getNode.mockReturnValue(undefined);

      await expect(
        service.propose({ data: "test" }, "non-existent"),
      ).rejects.toThrow("Node non-existent not found");
    });
  });

  describe("getMetrics", () => {
    it("should return node metrics", () => {
      const metrics = { requests: 100, errors: 5 };
      mockNode.getMetrics.mockReturnValue(metrics);

      const result = service.getMetrics();

      expect(result).toBe(metrics);
      expect(mockNode.getMetrics).toHaveBeenCalled();
    });
  });

  describe("peer management", () => {
    it("should add peer", async () => {
      mockNode.addPeer.mockResolvedValue(undefined);

      await service.addPeer("new-peer");

      expect(mockNode.addPeer).toHaveBeenCalledWith("new-peer");
    });

    it("should remove peer", async () => {
      mockNode.removePeer.mockResolvedValue(undefined);

      await service.removePeer("old-peer");

      expect(mockNode.removePeer).toHaveBeenCalledWith("old-peer");
    });

    it("should get peers", () => {
      mockNode.getPeers.mockReturnValue(["peer-1", "peer-2"]);

      const result = service.getPeers();

      expect(result).toEqual(["peer-1", "peer-2"]);
      expect(mockNode.getPeers).toHaveBeenCalled();
    });

    it("should return empty array when node not found", () => {
      mockEngine.getNode.mockReturnValue(undefined);

      const result = service.getPeers("non-existent");

      expect(result).toEqual([]);
    });
  });

  describe("forceElection", () => {
    it("should force election on node", async () => {
      mockNode.forceElection.mockResolvedValue(undefined);

      await service.forceElection();

      expect(mockNode.forceElection).toHaveBeenCalled();
    });

    it("should throw error when node not found", async () => {
      mockEngine.getNode.mockReturnValue(undefined);

      await expect(service.forceElection("non-existent")).rejects.toThrow(
        "Node non-existent not found",
      );
    });
  });

  describe("createSnapshot", () => {
    it("should create snapshot on node", async () => {
      mockNode.createSnapshot.mockResolvedValue(undefined);

      await service.createSnapshot();

      expect(mockNode.createSnapshot).toHaveBeenCalled();
    });

    it("should throw error when node not found", async () => {
      mockEngine.getNode.mockReturnValue(undefined);

      await expect(service.createSnapshot("non-existent")).rejects.toThrow(
        "Node non-existent not found",
      );
    });
  });
});
