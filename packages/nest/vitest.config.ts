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
      checker: "vue-tsc",
      ignoreSourceErrors: true,
      tsconfig: path.resolve(process.cwd(), "./tsconfig.json"),
    },
    coverage: {
      all: false,
      clean: true,
      provider: "v8",
      cleanOnRerun: true,
      reportOnFailure: true,
      include: ["**/src/**"],
      reporter: ["clover", "json", "html", "html-spa"],
      reportsDirectory: path.resolve(__dirname, "./coverage"),
    },
    dir: path.resolve(__dirname, "./test"),
    cache: false,
    globals: true,
    pool: "forks",
    poolOptions: {
      threads: {
        singleThread: true,
      },
      forks: {
        singleFork: true,
      },
    },
  },
  plugins: [
    // This is required to build the test files with SWC
    swc.vite({
      // Explicitly set the module type to avoid inheriting this value from a `.swcrc` config file
      module: { type: "es6" },
    }),
  ],
  resolve: {
    alias: {
      // Ensure Vitest correctly resolves TypeScript path aliases
      src: path.resolve(__dirname, "./src"),
    },
  },
});
