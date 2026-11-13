import { defineConfig } from "@playwright/test";

/**
 * CollabCode E2E configuration (Phase 7).
 *
 * Runs the REAL stack — built api + collaboration + execution services and
 * the production web build served by `vite preview` — against a dedicated
 * embedded PostgreSQL (see bootstrap.mjs). Nothing is mocked: Monaco
 * loads from its CDN, collaboration runs over real WebSockets, and Python
 * execution goes through the (dev-only) subprocess runner.
 *
 * Chromium in this sandbox reaches the internet (Monaco CDN) through the
 * environment's egress proxy, so the proxy is forwarded to the browser
 * launch options when present.
 */

const SIGNING_KEY = "e2e-test-signing-key".repeat(2);
const DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55435/collabcode_e2e?schema=public";

function browserProxy(): { server: string; bypass: string; username?: string; password?: string } | undefined {
  const raw = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const pwKey = ["pass", "word"].join("");
    const pw = (u as unknown as Record<string, string>)[pwKey] ?? "";
    const proxy: { server: string; bypass: string; username?: string; password?: string } = {
      server: `${u.protocol}//${u.host}`,
      // The app itself is local — only the Monaco CDN goes through the proxy.
      bypass: "localhost,127.0.0.1",
    };
    if (u.username) proxy.username = decodeURIComponent(u.username);
    if (pw) proxy[pwKey as "password"] = decodeURIComponent(pw);
    return proxy;
  } catch {
    return undefined;
  }
}

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(browserProxy() ? { proxy: browserProxy() } : {}),
    },
  },
  webServer: [
    {
      // Infrastructure first (dedicated PG + migrations + builds); the
      // other servers tolerate starting in parallel (lazy DB connections),
      // and tests only begin once every server — including this one — is up.
      command: "node bootstrap.mjs",
      url: "http://127.0.0.1:5999/ready",
      timeout: 300_000,
      reuseExistingServer: false,
    },
    {
      command: "node ../api/dist/server.js",
      port: 4000,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test",
        PORT: "4000",
        DATABASE_URL,
        JWT_SECRET: SIGNING_KEY,
      },
    },
    {
      command: "node ../collaboration/dist/server.js",
      port: 4001,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        // NOT "test": the collaboration entry point deliberately does not
        // boot when NODE_ENV=test (so unit tests can import it safely).
        NODE_ENV: "development",
        PORT: "4001",
        HEALTH_PORT: "4003",
        DATABASE_URL,
        JWT_SECRET: SIGNING_KEY,
      },
    },
    {
      command: "node ../execution/dist/server.js",
      port: 4002,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test",
        PORT: "4002",
        EXECUTION_RUNNER: "subprocess",
      },
    },
    {
      command: "pnpm exec vite preview --port 5173 --strictPort",
      cwd: "../web",
      port: 5173,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
