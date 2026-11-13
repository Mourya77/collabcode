import { Router } from "express";
import { makeHealth } from "@collabcode/shared";

/**
 * Health probes. Liveness (Phase 0 behaviour preserved: raw HealthStatus,
 * not the envelope) never touches the database. Readiness (Phase 7) pings
 * the database and reports 503 when it is unreachable, so load balancers
 * and orchestrators can stop routing traffic to a DB-less instance.
 */
export function healthRouter(ping?: () => Promise<boolean>): Router {
  const r = Router();
  r.get("/health", (_req, res) => {
    res.json(makeHealth("api"));
  });
  // Canonical liveness path under /api (the web client's health indicator
  // polls this same-origin; /health and /api/v1/health are legacy aliases).
  r.get("/api/health", (_req, res) => {
    res.json(makeHealth("api"));
  });
  r.get("/api/v1/health", (_req, res) => {
    res.json(makeHealth("api"));
  });
  r.get("/api/health/ready", async (_req, res) => {
    const dbUp = ping ? await ping().catch(() => false) : false;
    res.status(dbUp ? 200 : 503).json({
      service: "api",
      status: dbUp ? "ready" : "not_ready",
      db: dbUp ? "up" : "down",
      at: new Date().toISOString(),
    });
  });
  return r;
}
