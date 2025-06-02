import { Test, TestingModule } from "@nestjs/testing";
import { DiscoveryService } from "@nestjs/core";
import {
  raftEngineProvider,
  raftNodeProvider,
  raftEventBusProvider,
  raftEventHandlerProvider,
  createRaftNodeProvider,
} from "../src/providers";
import {
  RAFT_ENGINE,
  RAFT_NODE,
  RAFT_EVENT_BUS,
  RAFT_MODULE_OPTIONS,
  RAFT_EVENT_METADATA,
} from "../src/constants";
import { RaftEngine, RaftNode, RaftEventBus } from "@usex/raft";

describe("Providers", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  describe("raftEngineProvider", () => {
    it("should create RaftEngine instance", async () => {
      module = await Test.createTestingModule({
        providers: [raftEngineProvider],
      }).compile();

      const engine = module.get(RAFT_ENGINE);

      expect(engine).toBeInstanceOf(RaftEngine);
    });
  });

  describe("raftNodeProvider", () => {
    it("should create RaftNode with options", async () => {
      const mockCreateNode = jest.fn().mockResolvedValue({} as RaftNode);
      const mockEngine = {
        createNode: mockCreateNode,
      } as any;

      const options = {
        nodeId: "test-node",
        clusterId: "test-cluster",
      };

      module = await Test.createTestingModule({
        providers: [
          raftNodeProvider,
          {
            provide: RAFT_ENGINE,
            useValue: mockEngine,
          },
          {
            provide: RAFT_MODULE_OPTIONS,
            useValue: options,
          },
        ],
      }).compile();

      const node = await module.get(RAFT_NODE);

      expect(mockCreateNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: "test-node",
          clusterId: "test-cluster",
        }),
      );
    });

    it("should merge default configuration with user options", async () => {
      const mockCreateNode = jest.fn().mockResolvedValue({} as RaftNode);
      const mockEngine = {
        createNode: mockCreateNode,
      } as any;

      const options = {
        nodeId: "test-node",
        clusterId: "test-cluster",
        httpPort: 4000,
      };

      module = await Test.createTestingModule({
        providers: [
          raftNodeProvider,
          {
            provide: RAFT_ENGINE,
            useValue: mockEngine,
          },
          {
            provide: RAFT_MODULE_OPTIONS,
            useValue: options,
          },
        ],
      }).compile();

      await module.get(RAFT_NODE);

      const calledConfig = mockCreateNode.mock.calls[0][0];
      expect(calledConfig.httpPort).toBe(4000);
      expect(calledConfig.electionTimeout).toEqual([150, 300]); // Default value
    });
  });

  describe("createRaftNodeProvider", () => {
    it("should create provider for specific node", async () => {
      const mockNode = {} as RaftNode;
      const mockEngine = {
        getNode: jest.fn().mockReturnValue(mockNode),
      } as any;

      const provider = createRaftNodeProvider("node-2");

      module = await Test.createTestingModule({
        providers: [
          provider,
          {
            provide: RAFT_ENGINE,
            useValue: mockEngine,
          },
        ],
      }).compile();

      const node = await module.get(`${RAFT_NODE}_node-2`);

      expect(node).toBe(mockNode);
      expect(mockEngine.getNode).toHaveBeenCalledWith("node-2");
    });
  });

  describe("raftEventBusProvider", () => {
    it("should get event bus from node", async () => {
      const mockEventBus = {} as RaftEventBus;
      const mockNode = {
        getEventBus: jest.fn().mockReturnValue(mockEventBus),
      } as any;

      module = await Test.createTestingModule({
        providers: [
          raftEventBusProvider,
          {
            provide: RAFT_NODE,
            useValue: mockNode,
          },
        ],
      }).compile();

      const eventBus = module.get(RAFT_EVENT_BUS);

      expect(eventBus).toBe(mockEventBus);
      expect(mockNode.getEventBus).toHaveBeenCalled();
    });
  });

  describe("raftEventHandlerProvider", () => {
    it("should register event handlers from providers", async () => {
      const mockOn = jest.fn();
      const mockEventBus = { on: mockOn } as any;

      const mockHandler = jest.fn();
      class TestHandler {
        handleEvent = mockHandler;
      }

      const testInstance = new TestHandler();

      Reflect.defineMetadata(
        RAFT_EVENT_METADATA.EVENT_TYPE,
        [
          {
            eventType: "test_event",
            propertyKey: "handleEvent",
          },
        ],
        TestHandler,
      );

      const mockWrapper = {
        instance: testInstance,
      };

      const mockDiscovery = {
        getProviders: jest.fn().mockReturnValue([mockWrapper]),
        getControllers: jest.fn().mockReturnValue([]),
      } as any;

      module = await Test.createTestingModule({
        providers: [
          raftEventHandlerProvider,
          {
            provide: DiscoveryService,
            useValue: mockDiscovery,
          },
          {
            provide: RAFT_EVENT_BUS,
            useValue: mockEventBus,
          },
        ],
      }).compile();

      await module.init();

      expect(mockOn).toHaveBeenCalledWith("test_event", expect.any(Function));
    });

    it("should bind event handler methods correctly", async () => {
      const mockOn = jest.fn();
      const mockEventBus = { on: mockOn } as any;

      class TestHandler {
        value = "test";

        handleEvent() {
          return this.value;
        }
      }

      const testInstance = new TestHandler();

      Reflect.defineMetadata(
        RAFT_EVENT_METADATA.EVENT_TYPE,
        [
          {
            eventType: "test_event",
            propertyKey: "handleEvent",
          },
        ],
        TestHandler,
      );

      const mockWrapper = {
        instance: testInstance,
      };

      const mockDiscovery = {
        getProviders: jest.fn().mockReturnValue([mockWrapper]),
        getControllers: jest.fn().mockReturnValue([]),
      } as any;

      module = await Test.createTestingModule({
        providers: [
          raftEventHandlerProvider,
          {
            provide: DiscoveryService,
            useValue: mockDiscovery,
          },
          {
            provide: RAFT_EVENT_BUS,
            useValue: mockEventBus,
          },
        ],
      }).compile();

      await module.init();

      // Get the bound handler
      const boundHandler = mockOn.mock.calls[0][1];

      // Call it and check if 'this' is bound correctly
      expect(boundHandler()).toBe("test");
    });

    it("should handle providers without event handlers", async () => {
      const mockEventBus = { on: jest.fn() } as any;

      const mockWrapper = {
        instance: {},
      };

      const mockDiscovery = {
        getProviders: jest.fn().mockReturnValue([mockWrapper]),
        getControllers: jest.fn().mockReturnValue([]),
      } as any;

      module = await Test.createTestingModule({
        providers: [
          raftEventHandlerProvider,
          {
            provide: DiscoveryService,
            useValue: mockDiscovery,
          },
          {
            provide: RAFT_EVENT_BUS,
            useValue: mockEventBus,
          },
        ],
      }).compile();

      await module.init();

      expect(mockEventBus.on).not.toHaveBeenCalled();
    });
  });
});
