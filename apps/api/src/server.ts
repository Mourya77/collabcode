import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prismaRepos } from "./repositories/prisma.js";
import { attachChatGateway } from "./modules/chat/gateway.js";

/**
 * HTTP entrypoint. The chat WebSocket gateway shares this server (and its
 * port) at /api/chat/ws — see modules/chat/gateway.ts. `app.ts` stays free of
 * server wiring so supertest can drive the Express app directly.
 */
const app = createApp();
const server = createServer(app);
attachChatGateway(server, prismaRepos);
server.listen(env.PORT, () => console.log(`@collabcode/api listening on :${env.PORT} (chat ws at /api/chat/ws)`));
