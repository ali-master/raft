import { defineConfig } from "vitest/config";
import * as path from "node:path";
import swc from "unplugin-swc";

export default defineConfig({
  test: {
    root: "./",
    server: {
      sourcemap: "inline",
    },
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false, // Disable parallel execution to share Redis container
    name: "Raft Nest",
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
    maxWorkers: 1,
  },
  plugins: [
    // This is required to build the test files with SWC
    swc.vite({
      // Istanbul also transforms uncovered files with a query string in the ID.
      include: /\.ts(?:\?.*)?$/,
      jsc: { parser: { syntax: "typescript", decorators: true } },
      // Explicitly set the module type to avoid inheriting this value from a `.swcrc` config file
      module: { type: "es6" },
    }),
  ],
  resolve: {
    alias: {
      // Ensure Vitest correctly resolves TypeScript path aliases
      src: path.resolve(import.meta.dirname, "./src"),
    },
  },
});
