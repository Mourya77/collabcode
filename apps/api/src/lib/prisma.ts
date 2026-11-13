import { PrismaClient } from "@prisma/client";

// Lazily-created singleton: the client is constructed on first actual use, so the
// DATABASE_URL in effect at that moment wins (tests point it at a throwaway database
// before issuing any query). Importing this module never connects.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient();
  }
  return globalForPrisma.prisma;
}

/** Drop-in lazy proxy with the PrismaClient surface. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
