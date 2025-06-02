import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { vi, it, expect, describe, afterEach } from "vitest";
import { RaftModule } from "../src/modules/raft.module";
import { RaftService } from "../src/services/raft.service";
import { RAFT_NODE, RAFT_MODULE_OPTIONS, RAFT_ENGINE } from "../src/constants";
import { RaftEngine } from "@usex/raft";

describe("RaftModule", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  describe("forRoot", () => {
    it("should create module with basic configuration", async () => {
      module = await Test.createTestingModule({
        imports: [
          RaftModule.forRoot({
            nodeId: "test-node",
            clusterId: "test-cluster",
          }),
        ],
      }).compile();

      const engine = module.get(RAFT_ENGINE);
      const node = module.get(RAFT_NODE);
      const options = module.get(RAFT_MODULE_OPTIONS);
      const service = module.get(RaftService);

      expect(engine).toBeInstanceOf(RaftEngine);
      expect(node).toBeDefined();
      expect(options.nodeId).toBe("test-node");
      expect(options.clusterId).toBe("test-cluster");
      expect(service).toBeInstanceOf(RaftService);
    });

    it("should create global module when isGlobal is true", async () => {
      const dynamicModule = RaftModule.forRoot({
        nodeId: "test-node",
        clusterId: "test-cluster",
        isGlobal: true,
      });

      expect(dynamicModule.global).toBe(true);
    });

    it("should use default configuration for missing options", async () => {
      module = await Test.createTestingModule({
        imports: [
          RaftModule.forRoot({
            nodeId: "test-node",
            clusterId: "test-cluster",
          }),
        ],
      }).compile();

      const options = module.get(RAFT_MODULE_OPTIONS);

      expect(options.nodeId).toBe("test-node");
      expect(options.clusterId).toBe("test-cluster");
      // Other options should be merged with defaults
    });
  });

  describe("forRootAsync", () => {
    it("should create module with factory function", async () => {
      module = await Test.createTestingModule({
        imports: [
          RaftModule.forRootAsync({
            useFactory: () => ({
              nodeId: "async-node",
              clusterId: "async-cluster",
            }),
          }),
        ],
      }).compile();

      const options = module.get(RAFT_MODULE_OPTIONS);
      const service = module.get(RaftService);

      expect(options.nodeId).toBe("async-node");
      expect(options.clusterId).toBe("async-cluster");
      expect(service).toBeInstanceOf(RaftService);
    });

    it("should create module with useClass", async () => {
      class ConfigService {
        createRaftOptions() {
          return {
            nodeId: "class-node",
            clusterId: "class-cluster",
          };
        }
      }

      module = await Test.createTestingModule({
        imports: [
          RaftModule.forRootAsync({
            useClass: ConfigService,
          }),
        ],
      }).compile();

      const options = module.get(RAFT_MODULE_OPTIONS);

      expect(options.nodeId).toBe("class-node");
      expect(options.clusterId).toBe("class-cluster");
    });

    it("should inject dependencies into factory", async () => {
      const mockDep = { getValue: () => "injected-value" };

      module = await Test.createTestingModule({
        imports: [
          RaftModule.forRootAsync({
            useFactory: (dep: any) => ({
              nodeId: dep.getValue(),
              clusterId: "test-cluster",
            }),
            inject: ["MOCK_DEP"],
          }),
        ],
        providers: [
          {
            provide: "MOCK_DEP",
            useValue: mockDep,
          },
        ],
      }).compile();

      const options = module.get(RAFT_MODULE_OPTIONS);

      expect(options.nodeId).toBe("injected-value");
    });
  });

  describe("lifecycle hooks", () => {
    it("should start node on application bootstrap", async () => {
      const mockStart = vi.fn().mockResolvedValue(undefined);
      const mockNode = { start: mockStart } as any;

      module = await Test.createTestingModule({
        imports: [RaftModule],
        providers: [
          {
            provide: RAFT_ENGINE,
            useValue: new RaftEngine(),
          },
          {
            provide: RAFT_NODE,
            useValue: mockNode,
          },
        ],
      }).compile();

      const raftModule = module.get(RaftModule);
      await raftModule.onApplicationBootstrap();

      expect(mockStart).toHaveBeenCalled();
    });

    it("should stop node on application shutdown", async () => {
      const mockStop = vi.fn().mockResolvedValue(undefined);
      const mockNode = { stop: mockStop } as any;

      module = await Test.createTestingModule({
        imports: [RaftModule],
        providers: [
          {
            provide: RAFT_ENGINE,
            useValue: new RaftEngine(),
          },
          {
            provide: RAFT_NODE,
            useValue: mockNode,
          },
        ],
      }).compile();

      const raftModule = module.get(RaftModule);
      await raftModule.onApplicationShutdown();

      expect(mockStop).toHaveBeenCalled();
    });
  });
});
