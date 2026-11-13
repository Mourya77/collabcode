import { defineConfig } from "vitest/config";

/** Must match TEST_DB_URL in test/global-setup.ts: the embedded Postgres
 *  on 55434 by default, or the external database CI provides via
 *  CC_COLLAB_TEST_DATABASE_URL. */
export const COLLAB_TEST_DB_URL =
  process.env.CC_COLLAB_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55434/collabcode_collab_test?schema=public";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      JWT_SECRET: "collab-test-secret-collab-test-secret-0123456789",
      DATABASE_URL: COLLAB_TEST_DB_URL,
    },
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // One fork only: the suite shares one Postgres and real WebSocket servers.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
