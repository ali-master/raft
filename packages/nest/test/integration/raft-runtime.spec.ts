import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { it, expect, describe } from "vitest";
import { RaftEngine, LogLevel } from "@usex/raft";
import type { RaftEvent } from "@usex/raft";
import { RaftService, RaftModule } from "../../src";
import { getGlobalRedisContext } from "../shared/test-setup";

describe("RaftService with a running node", () => {
  it("elects, commits, snapshots and shuts down through the Nest lifecycle", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "raft-nest-runtime-"));
    const { container } = getGlobalRedisContext();
    const config = RaftEngine.createDefaultConfiguration(
      "nest-runtime",
      dataDir,
    );
    config.redis = {
      ...config.redis,
      host: container.getHost(),
      port: container.getMappedPort(6379),
      keyPrefix: `${dataDir}:`,
    };
    config.persistence = { ...config.persistence, dataDir };
    config.logging = {
      ...config.logging,
      level: LogLevel.ERROR,
      enableConsole: false,
    };
    let module: TestingModule | undefined;
    try {
      module = await Test.createTestingModule({
        imports: [RaftModule.forRoot(config)],
      }).compile();
      await module.init();
      const service = module.get(RaftService);
      const node = service.getNode()!;
      const events: RaftEvent[] = [];
      node.on("raftEvent", (event: RaftEvent) => events.push(event));
      await service.forceElection();
      expect(service.getLeaderId()).toBe(node.getNodeId());
      await service.propose({ value: "persisted" });
      const committed = node.getCommitIndex();
      expect(node.getLastApplied()).toBe(committed);
      expect(node.getLog().getEntry(committed)?.commandPayload).toEqual({
        value: "persisted",
      });
      await service.createSnapshot();
      expect(
        events.some(
          (event) =>
            event.type === "snapshot_created" &&
            event.data.lastIncludedIndex === committed,
        ),
      ).toBe(true);
      await module.close();
      module = undefined;
      expect(node.isRunning()).toBe(false);
      await expect(service.propose("after-stop")).rejects.toThrow();
    } finally {
      await module?.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
