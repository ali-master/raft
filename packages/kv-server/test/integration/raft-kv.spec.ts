import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";
import { RaftModule } from "../../src/raft/raft.module";
import { KVStoreModule } from "../../src/kv-store/kv-store.module";
import { EncryptionModule } from "../../src/encryption/encryption.module";
import { KVStoreService } from "../../src/kv-store/kv-store.service";
import { RaftService } from "../../src/raft/raft.service";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("Raft-integrated KV Store", () => {
  let app: INestApplication;
  let kvStoreService: KVStoreService;
  let raftService: RaftService;
  let redisContainer: StartedTestContainer;

  beforeAll(async () => {
    redisContainer = await new GenericContainer("redis:7-alpine")
      .withExposedPorts(6379)
      .start();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: false,
          load: [
            () => ({
              REDIS_HOST: redisContainer.getHost(),
              REDIS_PORT: redisContainer.getMappedPort(6379),
              RAFT_NODE_ID: "test-node-1",
              RAFT_CLUSTER_ID: "test-cluster",
              RAFT_HTTP_HOST: "localhost",
              RAFT_HTTP_PORT: 4001,
              ENCRYPTION_KEY: "test-encryption-key-32-characters",
            }),
          ],
        }),
        CqrsModule,
        RaftModule,
        KVStoreModule,
        EncryptionModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    kvStoreService = app.get<KVStoreService>(KVStoreService);
    raftService = app.get<RaftService>(RaftService);
  });

  afterAll(async () => {
    await app.close();
    await redisContainer.stop();
  });

  it("should initialize Raft node", () => {
    expect(raftService.getNodeId()).toBe("test-node-1");
  });

  it("should set and get value through Raft consensus", async () => {
    const key = "test-key";
    const value = "test-value";

    await kvStoreService.setValue(key, value);
    const retrievedValue = await kvStoreService.getValue(key);

    expect(retrievedValue).toBe(value);
  });

  it("should delete value through Raft consensus", async () => {
    const key = "delete-test-key";
    const value = "delete-test-value";

    await kvStoreService.setValue(key, value);
    await kvStoreService.deleteValue(key);
    const retrievedValue = await kvStoreService.getValue(key);

    expect(retrievedValue).toBeNull();
  });

  it("should list keys", async () => {
    await kvStoreService.setValue("list-key-1", "value1");
    await kvStoreService.setValue("list-key-2", "value2");

    const keys = await kvStoreService.listKeys();
    expect(keys).toContain("list-key-1");
    expect(keys).toContain("list-key-2");
  });

  it("should only allow leader to accept writes", async () => {
    if (!raftService.isLeader()) {
      await expect(
        kvStoreService.setValue("non-leader-key", "value"),
      ).rejects.toThrow("Only the leader can accept write operations");
    } else {
      await kvStoreService.setValue("leader-key", "value");
      const value = await kvStoreService.getValue("leader-key");
      expect(value).toBe("value");
    }
  });
});
