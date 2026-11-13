import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: { NODE_ENV: "test" },
    // Integration tests spawn real interpreters/compilers.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
