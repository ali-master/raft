import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";
import { ValidationPipe } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import type { OpenAPIObject } from "@nestjs/swagger";
import IORedis from "ioredis";
import { RaftState, RaftNode } from "@usex/raft";
import { vi, it, expect, describe, beforeAll, afterAll } from "vitest";
import { KVStoreModule } from "../../src/kv-store/kv-store.module";
import { KVStoreService } from "../../src/kv-store/kv-store.service";
import { KVStateMachine } from "../../src/kv-store/kv-state-machine";
import { EncryptionService } from "../../src/encryption/encryption.service";
import { getGlobalRedisContext } from "../shared/test-setup";

describe("KV data isolation and HTTP contract", () => {
  let app: NestFastifyApplication;
  let kv: KVStoreService;
  let dataDir: string;
  let baseUrl: string;
  let document: OpenAPIObject;
  let isolatedRedis: IORedis;
  let isolatedState: KVStateMachine;
  let sdkDir: string;
  const packageDir = resolve(__dirname, "../../../kv-server-sdk");

  beforeAll(async () => {
    const { container } = getGlobalRedisContext();
    dataDir = await mkdtemp(join(tmpdir(), "raft-kv-audit-"));
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [
            () => ({
              REDIS_HOST: container.getHost(),
              REDIS_PORT: container.getMappedPort(6379),
              RAFT_NODE_ID: "kv-audit",
              RAFT_CLUSTER_ID: dataDir,
              RAFT_DATA_DIR: dataDir,
              ENCRYPTION_KEY: "audit-only-key-not-for-production",
            }),
          ],
        }),
        CqrsModule,
        KVStoreModule,
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    kv = app.get(KVStoreService);
    await vi.waitFor(
      () => expect(app.get(RaftNode).getState()).toBe(RaftState.LEADER),
      {
        timeout: 8000,
      },
    );
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("KV audit").setVersion("1").build(),
    );
    await writeFile(
      join(dataDir, "openapi.json"),
      JSON.stringify(document, null, 2),
    );
    const config = {
      host: container.getHost(),
      port: container.getMappedPort(6379),
      db: 15,
      keyPrefix: "audit-kv:",
    };
    isolatedRedis = new IORedis(config);
    isolatedState = new KVStateMachine(app.get(EncryptionService), config);
    sdkDir = await mkdtemp(join(packageDir, "node_modules/.raft-audit-"));
    await promisify(execFile)(
      process.execPath,
      [
        "run",
        "generate:client",
        "-i",
        join(dataDir, "openapi.json"),
        "-o",
        join(sdkDir, "client"),
      ],
      { cwd: packageDir },
    );
  }, 30000);

  afterAll(async () => {
    await isolatedState?.cleanup();
    await isolatedRedis?.quit();
    await app?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (sdkDir) await rm(sdkDir, { recursive: true, force: true });
  });

  it("round trips Unicode values through the actual Fastify HTTP API", async () => {
    const response = await fetch(`${baseUrl}/kv/http-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "سلام 🌍" }),
    });
    expect(response.status).toBe(201);
    expect(await (await fetch(`${baseUrl}/kv/http-key`)).text()).toBe(
      "سلام 🌍",
    );
    expect(await (await fetch(`${baseUrl}/kv`)).json()).toContain("http-key");
    expect(
      (await fetch(`${baseUrl}/kv/http-key`, { method: "DELETE" })).status,
    ).toBe(200);
    expect(await kv.getValue("http-key")).toBeNull();
  });

  it("does not overwrite user data during a health check", async () => {
    await kv.setValue("health-check", "user-owned-data");
    expect(await kv.isHealthy()).toBe(true);
    expect(await kv.getValue("health-check")).toBe("user-owned-data");
  });

  it("generates and compiles the SDK from the running server contract", async () => {
    const run = promisify(execFile);
    const tsconfig = join(sdkDir, "tsconfig.json");
    await writeFile(
      tsconfig,
      JSON.stringify({
        extends: join(packageDir, "tsconfig.json"),
        compilerOptions: { rootDir: "./client", noEmit: true },
        include: ["client/**/*.ts"],
        exclude: [],
      }),
    );
    try {
      await run(process.execPath, ["run", "tsc", "-p", tsconfig], {
        cwd: packageDir,
      });
    } catch (error) {
      throw new Error(
        `Generated SDK compilation failed:\n${(error as { stdout?: string }).stdout}`,
      );
    }
  }, 30000);

  it("reads real HTTP data through the generated SDK", async () => {
    await kv.setValue("sdk-read", "SDK data");
    const script = join(sdkDir, "read.ts");
    await writeFile(
      script,
      `import assert from "node:assert/strict";
import { kvStoreControllerGetValue, kvStoreControllerListKeys } from "./client/sdk.gen";
const baseUrl = process.argv[2];
const response = await kvStoreControllerGetValue({ baseUrl, path: { key: "sdk-read" }, throwOnError: true });
assert.equal(response.data, "SDK data");
const keys = await kvStoreControllerListKeys({ baseUrl, throwOnError: true });
assert.ok(keys.data.includes("sdk-read"));
`,
    );
    await promisify(execFile)(process.execPath, [script, baseUrl]);
  });

  it("writes real HTTP data through the generated SDK", async () => {
    const script = join(sdkDir, "write.ts");
    await writeFile(
      script,
      `import { kvStoreControllerSetValue } from "./client/sdk.gen";
await kvStoreControllerSetValue({ baseUrl: process.argv[2], path: { key: "sdk-write" }, body: { value: "SDK write" }, throwOnError: true });
`,
    );
    await promisify(execFile)(process.execPath, [script, baseUrl]);
    expect(await kv.getValue("sdk-write")).toBe("SDK write");
  });

  it("rejects invalid HTTP bodies with a client error", async () => {
    const response = await fetch(`${baseUrl}/kv/bad-body`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { invalid: true } }),
    });
    expect(response.status).toBe(400);
    expect(await kv.getValue("bad-body")).toBeNull();
  });

  it("documents the actual body and return types for SDK generation", () => {
    const route = document.paths["/kv/{key}"]!;
    expect.soft(route.post?.requestBody).toMatchObject({
      content: { "application/json": { schema: { type: "object" } } },
    });
    expect.soft(route.get?.responses["200"]).toHaveProperty("content");
    expect(document.paths["/kv"]?.get?.responses["200"]).toHaveProperty(
      "content",
    );
  });

  it("lists only keys owned by the KV state machine", async () => {
    // This Redis database is owned exclusively by the test container.
    await isolatedRedis.set("unrelated-state", "must-survive");
    await isolatedState.apply(
      JSON.stringify({ type: "SET", key: "owned", value: "value" }),
    );
    expect(await isolatedState.listKeys()).toEqual(["owned"]);
  });

  it("excludes unrelated Redis data from snapshots", async () => {
    await isolatedRedis.set("unrelated-state", "must-survive");
    await isolatedState.apply(
      JSON.stringify({ type: "SET", key: "owned", value: "value" }),
    );
    const snapshot = JSON.parse(
      (await isolatedState.getSnapshotData()).toString(),
    );
    expect(Object.keys(snapshot.data)).toEqual(["owned"]);
  });

  it("preserves unrelated Redis data when installing a snapshot", async () => {
    await isolatedRedis.set("unrelated-state", "must-survive");
    await isolatedState.applySnapshot(
      Buffer.from(JSON.stringify({ data: {}, timestamp: Date.now() })),
    );
    expect(await isolatedRedis.get("unrelated-state")).toBe("must-survive");
  });
});
