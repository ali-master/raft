import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  test: {
    alias: {
      "@root": path.resolve(import.meta.dirname, "./src"),
    },
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false, // Disable parallel execution to share Redis container
    name: "Raft",
    typecheck: {
      enabled: true,
      checker: "tsc",
      ignoreSourceErrors: true,
      tsconfig: path.resolve(process.cwd(), "./tsconfig.json"),
    },
    coverage: {
      clean: true,
      provider: "istanbul",
      cleanOnRerun: true,
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      reporter: ["clover", "json", "html", "html-spa"],
      reportsDirectory: path.resolve(import.meta.dirname, "./coverage"),
    },
    dir: path.resolve(import.meta.dirname, "./test"),
    globals: true,
    pool: "forks",
  },
});
