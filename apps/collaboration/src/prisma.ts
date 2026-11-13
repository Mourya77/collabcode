import { PrismaClient } from "./generated/prisma-client/index.js";

/**
 * The collaboration service's own Prisma client, generated from
 * prisma/schema.prisma (a deliberate subset of the API's canonical schema —
 * see the header comment in that file). Same DATABASE_URL as the API.
 *
 * Constructed lazily so tests can point DATABASE_URL at a throwaway database
 * before the first query runs.
 */
const globalForPrisma = globalThis as unknown as { collabPrisma?: PrismaClient };

export function getPrisma(datasourceUrl?: string): PrismaClient {
  if (!globalForPrisma.collabPrisma) {
    globalForPrisma.collabPrisma = datasourceUrl
      ? new PrismaClient({ datasourceUrl })
      : new PrismaClient();
  }
  return globalForPrisma.collabPrisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (globalForPrisma.collabPrisma) {
    await globalForPrisma.collabPrisma.$disconnect();
    globalForPrisma.collabPrisma = undefined;
  }
}

export type { PrismaClient };
