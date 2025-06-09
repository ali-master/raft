import { rm, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export async function createTempDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "raft-test-"));
}

export async function cleanupDataDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
