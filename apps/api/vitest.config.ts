import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // DB-backed suites (integration, phase4) share one test database and
    // truncate it per test — running files in parallel would clobber each
    // other's fixtures, so test files execute serially.
    fileParallelism: false,
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      JWT_SECRET: "test-jwt-secret-for-collabcode-0123456789",
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
