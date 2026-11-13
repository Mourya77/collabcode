import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import type { Repos } from "./repositories/types.js";
import { prismaRepos } from "./repositories/prisma.js";
import { requestId } from "./middleware/requestId.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { globalRateLimiter } from "./middleware/rateLimits.js";
import { csrfProtection } from "./middleware/csrf.js";
import { healthRouter } from "./modules/health/routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { usersRouter } from "./modules/users/routes.js";
import { projectsRouter } from "./modules/projects/routes.js";
import { membersRouter } from "./modules/members/routes.js";
import { projectFilesRouter, filesRouter } from "./modules/files/routes.js";
import { versionsRouter } from "./modules/versions/routes.js";
import { collabRouter } from "./modules/collab/routes.js";
import { executionsRouter, projectExecutionsRouter } from "./modules/executions/routes.js";
import { invitationsRouter, projectInvitationsRouter } from "./modules/invitations/routes.js";
import { chatRouter } from "./modules/chat/routes.js";
import { openApiSpec } from "./openapi.js";

export function createApp(repos: Repos = prismaRepos) {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS_LIST, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(requestId);
  app.use(requestLogger);

  // Health probes are unauthenticated and CSRF-exempt.
  app.use(healthRouter(() => repos.ping()));

  app.get("/api/openapi.json", (_req, res) => {
    res.json(openApiSpec);
  });
  // Swagger UI is a development convenience — it is not mounted in
  // production (Phase 7 hardening); the OpenAPI JSON stays available.
  if (env.NODE_ENV !== "production") {
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec as unknown as Record<string, unknown>));
  }

  app.use("/api", globalRateLimiter);
  app.use("/api", csrfProtection);

  app.use("/api/auth", authRouter(repos));
  app.use("/api/users", usersRouter(repos));
  app.use("/api/projects", projectsRouter(repos));
  app.use("/api/projects", projectInvitationsRouter(repos));
  app.use("/api/projects", membersRouter(repos));
  app.use("/api/projects", chatRouter(repos));
  app.use("/api/invitations", invitationsRouter(repos));
  app.use("/api/projects", projectFilesRouter(repos));
  app.use("/api/files", filesRouter(repos));
  app.use("/api/files", versionsRouter(repos));
  app.use("/api/collab", collabRouter(repos));
  app.use("/api/projects", projectExecutionsRouter(repos));
  app.use("/api/executions", executionsRouter(repos));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export const app = createApp();
