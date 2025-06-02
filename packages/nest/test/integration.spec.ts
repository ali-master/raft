import { Test } from "@nestjs/testing";
import { Injectable, Module } from "@nestjs/common";
import {
  RaftModule,
  RaftService,
  RaftNode,
  OnLeaderElected,
  OnStateChange,
  OnErrorOccurred,
  InjectRaftEngine,
  InjectRaftNode,
  InjectRaftEventBus,
} from "../src";
import { RaftEngine, RaftNode as RaftNodeType, RaftEventBus } from "@usex/raft";

describe("Integration Tests", () => {
  describe("Complete Module Setup", () => {
    @Injectable()
    @RaftNode()
    class TestEventHandler {
      public leaderElectedEvents: any[] = [];
      public stateChangeEvents: any[] = [];
      public errorEvents: any[] = [];

      @OnLeaderElected()
      handleLeaderElected(event: any) {
        this.leaderElectedEvents.push(event);
      }

      @OnStateChange()
      handleStateChange(event: any) {
        this.stateChangeEvents.push(event);
      }

      @OnErrorOccurred()
      handleError(event: any) {
        this.errorEvents.push(event);
      }
    }

    @Injectable()
    class TestService {
      constructor(
        private readonly raftService: RaftService,
        @InjectRaftEngine() private readonly engine: RaftEngine,
        @InjectRaftNode() private readonly node: RaftNodeType,
        @InjectRaftEventBus() private readonly eventBus: RaftEventBus,
      ) {}

      getAllInjections() {
        return {
          service: this.raftService,
          engine: this.engine,
          node: this.node,
          eventBus: this.eventBus,
        };
      }
    }

    @Module({
      imports: [
        RaftModule.forRoot({
          nodeId: "integration-node",
          clusterId: "integration-cluster",
        }),
      ],
      providers: [TestEventHandler, TestService],
    })
    class TestModule {}

    it("should set up complete module with all features", async () => {
      const module = await Test.createTestingModule({
        imports: [TestModule],
      }).compile();

      const testService = module.get(TestService);
      const testHandler = module.get(TestEventHandler);
      const raftService = module.get(RaftService);

      // Verify all injections work
      const injections = testService.getAllInjections();
      expect(injections.service).toBe(raftService);
      expect(injections.engine).toBeInstanceOf(RaftEngine);
      expect(injections.node).toBeDefined();
      expect(injections.eventBus).toBeDefined();

      // Verify event handlers are registered
      expect(testHandler).toBeDefined();

      await module.close();
    });
  });

  describe("Async Configuration", () => {
    @Injectable()
    class ConfigService {
      getNodeId() {
        return "async-node";
      }

      getClusterId() {
        return "async-cluster";
      }

      createRaftOptions() {
        return {
          nodeId: this.getNodeId(),
          clusterId: this.getClusterId(),
          httpPort: 4001,
        };
      }
    }

    @Module({
      providers: [ConfigService],
      exports: [ConfigService],
    })
    class ConfigModule {}

    it("should work with async configuration", async () => {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule,
          RaftModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => ({
              nodeId: configService.getNodeId(),
              clusterId: configService.getClusterId(),
            }),
            inject: [ConfigService],
          }),
        ],
      }).compile();

      const raftService = module.get(RaftService);
      expect(raftService).toBeDefined();

      await module.close();
    });

    it("should work with useClass async configuration", async () => {
      const module = await Test.createTestingModule({
        imports: [
          RaftModule.forRootAsync({
            useClass: ConfigService,
          }),
        ],
      }).compile();

      const raftService = module.get(RaftService);
      expect(raftService).toBeDefined();

      await module.close();
    });
  });

  describe("Multi-Node Configuration", () => {
    @Injectable()
    @RaftNode("node-1")
    class Node1Handler {
      public events: any[] = [];

      @OnStateChange()
      handleStateChange(event: any) {
        this.events.push({ node: "node-1", event });
      }
    }

    @Injectable()
    @RaftNode("node-2")
    class Node2Handler {
      public events: any[] = [];

      @OnStateChange()
      handleStateChange(event: any) {
        this.events.push({ node: "node-2", event });
      }
    }

    @Injectable()
    @RaftNode()
    class GenericHandler {
      public events: any[] = [];

      @OnStateChange()
      handleStateChange(event: any) {
        this.events.push({ node: "generic", event });
      }
    }

    @Module({
      imports: [
        RaftModule.forRoot({
          nodeId: "multi-node-test",
          clusterId: "multi-cluster",
        }),
      ],
      providers: [Node1Handler, Node2Handler, GenericHandler],
    })
    class MultiNodeModule {}

    it("should support multiple node handlers", async () => {
      const module = await Test.createTestingModule({
        imports: [MultiNodeModule],
      }).compile();

      const node1Handler = module.get(Node1Handler);
      const node2Handler = module.get(Node2Handler);
      const genericHandler = module.get(GenericHandler);

      expect(node1Handler).toBeDefined();
      expect(node2Handler).toBeDefined();
      expect(genericHandler).toBeDefined();

      await module.close();
    });
  });

  describe("Error Handling", () => {
    it("should handle missing node gracefully", async () => {
      const module = await Test.createTestingModule({
        imports: [
          RaftModule.forRoot({
            nodeId: "error-test",
            clusterId: "error-cluster",
          }),
        ],
      }).compile();

      const raftService = module.get(RaftService);

      const nonExistentNode = raftService.getNode("non-existent");
      expect(nonExistentNode).toBeUndefined();

      const state = raftService.getState("non-existent");
      expect(state).toBeUndefined();

      await expect(raftService.propose("data", "non-existent")).rejects.toThrow(
        "Node non-existent not found",
      );

      await module.close();
    });
  });

  describe("Global Module", () => {
    @Module({
      imports: [
        RaftModule.forRoot({
          nodeId: "global-node",
          clusterId: "global-cluster",
          isGlobal: true,
        }),
      ],
    })
    class GlobalRootModule {}

    @Injectable()
    class NestedService {
      constructor(private readonly raftService: RaftService) {}

      getRaftService() {
        return this.raftService;
      }
    }

    @Module({
      providers: [NestedService],
      exports: [NestedService],
    })
    class NestedModule {}

    @Module({
      imports: [GlobalRootModule, NestedModule],
    })
    class AppModule {}

    it("should make RaftModule globally available", async () => {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const nestedService = module.get(NestedService);
      const raftService = nestedService.getRaftService();

      expect(raftService).toBeInstanceOf(RaftService);

      await module.close();
    });
  });
});
