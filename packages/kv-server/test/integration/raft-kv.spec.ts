import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";
import { RaftModule } from "../../src/raft/raft.module";
import { KVStoreModule } from "../../src/kv-store/kv-store.module";
import { EncryptionModule } from "../../src/encryption/encryption.module";
import { KVStoreService } from "../../src/kv-store/kv-store.service";
import { KVStateMachine } from "../../src/kv-store/kv-state-machine";
import { RaftService } from "../../src/raft/raft.service";
import { RaftNode } from "@usex/raft";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, it, expect, describe, beforeAll, afterAll } from "vitest";
import { getGlobalRedisContext } from "../shared/test-setup";

describe("Raft-integrated KV Store", () => {
  let app: INestApplication;
  let kvStoreService: KVStoreService;
  let raftService: RaftService;
  let dataDir: string;

  beforeAll(async () => {
    const { container: redisContainer } = getGlobalRedisContext();
    dataDir = await mkdtemp(join(tmpdir(), "raft-kv-integration-"));

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [
            () => ({
              REDIS_HOST: redisContainer.getHost(),
              REDIS_PORT: redisContainer.getMappedPort(6379),
              RAFT_NODE_ID: "test-node-1",
              RAFT_CLUSTER_ID: "test-cluster",
              RAFT_HTTP_HOST: "localhost",
              RAFT_HTTP_PORT: 4001,
              RAFT_DATA_DIR: dataDir,
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
    await vi.waitFor(() => expect(raftService.isLeader()).toBe(true), {
      timeout: 10000,
    });
  });

  afterAll(async () => {
    try {
      const stateMachine = app?.get(KVStateMachine);
      await app?.close();
      if (stateMachine) {
        await expect(stateMachine.listKeys()).rejects.toThrow(
          "Connection is closed",
        );
      }
    } finally {
      if (dataDir) await rm(dataDir, { recursive: true, force: true });
    }
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

  it("should reject writes after the node stops being leader", async () => {
    await app.get(RaftNode).stop();
    expect(raftService.isLeader()).toBe(false);
    await expect(
      kvStoreService.setValue("non-leader-key", "value"),
    ).rejects.toThrow("Only the leader can accept write operations");
    expect(await kvStoreService.getValue("non-leader-key")).toBeNull();
  });
});
