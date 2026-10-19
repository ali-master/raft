import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import baseConfig from "../vitest.config";

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    name: "Nest playground",
    dir: resolve(import.meta.dirname, "test"),
    setupFiles: [resolve(import.meta.dirname, "../test/setup.ts")],
    typecheck: { enabled: false },
  },
});
