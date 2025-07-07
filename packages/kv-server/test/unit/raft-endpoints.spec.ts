import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { RaftRpcController } from "../../src/raft/raft-rpc.controller";
import { RaftController } from "../../src/raft/raft.controller";
import { RaftNode } from "@usex/raft";
import { RaftService } from "../../src/raft/raft.service";
import { ConfigService } from "@nestjs/config";
import { vi, it, expect, describe, beforeEach } from "vitest";

describe("Raft Endpoints", () => {
  let raftRpcController: RaftRpcController;
  let raftController: RaftController;
  let mockRaftNode: any;
  let mockRaftService: any;

  beforeEach(async () => {
    // Mock RaftNode
    mockRaftNode = {
      handleVoteRequest: vi.fn(),
      handleAppendEntries: vi.fn(),
      handlePreVoteRequest: vi.fn(),
      handleInstallSnapshot: vi.fn(),
      handleTimeoutNowRequest: vi.fn(),
      getState: vi.fn(),
      getMetrics: vi.fn(),
    };

    // Mock RaftService
    mockRaftService = {
      getNodeId: vi.fn().mockReturnValue("test-node"),
      getState: vi.fn().mockReturnValue("FOLLOWER"),
      isLeader: vi.fn().mockReturnValue(false),
      getMetrics: vi.fn().mockReturnValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RaftRpcController, RaftController],
      providers: [
        {
          provide: RaftNode,
          useValue: mockRaftNode,
        },
        {
          provide: RaftService,
          useValue: mockRaftService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn(),
          },
        },
      ],
    }).compile();

    raftRpcController = module.get<RaftRpcController>(RaftRpcController);
    raftController = module.get<RaftController>(RaftController);
  });

  describe("RaftRpcController", () => {
    it("should have handleVoteRequest method", () => {
      expect(raftRpcController.handleVoteRequest).toBeDefined();
    });

    it("should have handleAppendEntries method", () => {
      expect(raftRpcController.handleAppendEntries).toBeDefined();
    });

    it("should have handlePreVote method", () => {
      expect(raftRpcController.handlePreVote).toBeDefined();
    });

    it("should have handleInstallSnapshot method", () => {
      expect(raftRpcController.handleInstallSnapshot).toBeDefined();
    });

    it("should have handleTimeoutNow method", () => {
      expect(raftRpcController.handleTimeoutNow).toBeDefined();
    });

    it("should call RaftNode.handleVoteRequest", async () => {
      const voteRequest = {
        term: 1,
        candidateId: "candidate-1",
        lastLogIndex: 0,
        lastLogTerm: 0,
      };

      const expectedResponse = { term: 1, voteGranted: true };
      mockRaftNode.handleVoteRequest.mockResolvedValue(expectedResponse);

      const result = await raftRpcController.handleVoteRequest(voteRequest);

      expect(mockRaftNode.handleVoteRequest).toHaveBeenCalledWith(voteRequest);
      expect(result).toEqual(expectedResponse);
    });

    it("should call RaftNode.handleAppendEntries", async () => {
      const appendRequest = {
        term: 1,
        leaderId: "leader-1",
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: 0,
      };

      const expectedResponse = {
        nodeId: "test-node",
        term: 1,
        success: true,
        matchIndex: 0,
      };
      mockRaftNode.handleAppendEntries.mockResolvedValue(expectedResponse);

      const result = await raftRpcController.handleAppendEntries(appendRequest);

      expect(mockRaftNode.handleAppendEntries).toHaveBeenCalledWith(
        appendRequest,
      );
      expect(result).toEqual(expectedResponse);
    });
  });

  describe("RaftController", () => {
    it("should have getStatus method", () => {
      expect(raftController.getStatus).toBeDefined();
    });

    it("should have isLeader method", () => {
      expect(raftController.isLeader).toBeDefined();
    });

    it("should have getMetrics method", () => {
      expect(raftController.getMetrics).toBeDefined();
    });

    it("should return status correctly", async () => {
      const result = await raftController.getStatus();

      expect(result).toEqual({
        nodeId: "test-node",
        state: "FOLLOWER",
        isLeader: false,
        metrics: {},
      });
    });
  });
});
