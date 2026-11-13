import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { getPrisma } from "../src/prisma.js";
import { createCollaborationServer, type CollabServerHandle } from "../src/server.js";
import { buildDocumentName } from "../src/documentName.js";
import { connectClient, freePort, signTestToken, textFromPersistedState, waitFor, type TestClient } from "./helpers.js";

/**
 * Phase 7 — collaboration hardening + concurrency.
 *
 * 1. Origin guard (CSWSH): a raw WebSocket handshake carrying a foreign
 *    Origin header is closed by the server before it can sync; an
 *    allow-listed Origin and a no-Origin (native) client stay connected.
 * 2. Concurrency: 5 simultaneous editors × 40 marked lines in interleaved
 *    bursts must converge to byte-identical text on every client; sync
 *    latency is MEASURED (marker first-seen timestamps) and printed, one
 *    client edits offline and reconnects, and the persisted YjsDocument
 *    must decode to the same converged text.
 */

const markerPath = fileURLToPath(new URL("../.test-db.json", import.meta.url));
const prisma = getPrisma();

let server: CollabServerHandle;
let clients: TestClient[] = [];

function client(args: Parameters<typeof connectClient>[0]): TestClient {
  const c = connectClient(args);
  clients.push(c);
  return c;
}

let seq = 0;
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
async function seedDoc(userCount: number): Promise<{ projectId: string; fileId: string; users: { id: string; name: string }[] }> {
  seq += 1;
  const owner = await prisma.user.create({
    data: { name: `P7 Owner ${seq}`, email: `p7.owner.${RUN}.${seq}@example.com`, passwordHash: "not-a-real-hash" },
  });
  const project = await prisma.project.create({ data: { name: `P7 Project ${seq}`, ownerId: owner.id } });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: owner.id, role: "OWNER" } });
  const users: { id: string; name: string }[] = [{ id: owner.id, name: owner.name }];
  for (let i = 1; i < userCount; i++) {
    const u = await prisma.user.create({
      data: { name: `P7 Editor ${seq}-${i}`, email: `p7.editor.${RUN}.${seq}.${i}@example.com`, passwordHash: "not-a-real-hash" },
    });
    await prisma.projectMember.create({ data: { projectId: project.id, userId: u.id, role: "EDITOR" } });
    users.push({ id: u.id, name: u.name });
  }
  const file = await prisma.file.create({
    data: { projectId: project.id, parentId: null, name: "concurrent.ts", type: "FILE", path: "concurrent.ts" },
  });
  await prisma.documentVersion.create({ data: { fileId: file.id, createdBy: owner.id, content: "" } });
  return { projectId: project.id, fileId: file.id, users };
}

const tokenFor = (projectId: string, u: { id: string; name: string }, role: "OWNER" | "EDITOR") =>
  signTestToken({ userId: u.id, projectId, role, name: u.name });

beforeAll(async () => {
  let mode = "unavailable";
  try {
    mode = (JSON.parse(fs.readFileSync(markerPath, "utf8")) as { mode?: string }).mode ?? "unavailable";
  } catch {
    /* marker missing */
  }
  if (mode !== "postgres") {
    throw new Error("Phase 7 collab tests require the real embedded PostgreSQL (global setup failed).");
  }
  const healthPort = await freePort();
  server = createCollaborationServer({
    port: await freePort(),
    healthPort,
    storeDebounceMs: 100,
    maxDebounceMs: 500,
    versionSyncMinIntervalMs: 0,
    quiet: true,
  });
  await server.listen();
});

afterAll(async () => {
  for (const c of clients) c.destroy();
  clients = [];
  await server.destroy();
});

/** Raw handshake probe: resolves "closed" if the server drops the socket, "open" if it stays up. */
function probeHandshake(url: string, headers: Record<string, string>, observeMs = 1800): Promise<"open" | "closed"> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    let settled = false;
    const finish = (v: "open" | "closed") => {
      if (settled) return;
      settled = true;
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
      resolve(v);
    };
    ws.once("close", () => finish("closed"));
    ws.once("error", () => finish("closed"));
    setTimeout(() => finish(ws.readyState === WebSocket.OPEN ? "open" : "closed"), observeMs);
  });
}

describe("origin guard (Phase 7)", () => {
  it("closes handshakes from a foreign Origin; allows allow-listed and no-Origin handshakes", async () => {
    const { projectId, fileId } = await seedDoc(1);
    const url = `ws://127.0.0.1:${server.port}/${buildDocumentName(projectId, fileId)}`;
    await expect(probeHandshake(url, { Origin: "https://evil.example.com" })).resolves.toBe("closed");
    await expect(probeHandshake(url, { Origin: "http://localhost:5173" })).resolves.toBe("open");
    await expect(probeHandshake(url, {})).resolves.toBe("open");
  });
});

describe("concurrency: 5 editors (Phase 7)", () => {
  it("converges 5×40 interleaved lines, survives an offline/reconnect cycle, and persists the converged text", async () => {
    const N = 5;
    const LINES = 40;
    const { projectId, fileId, users } = await seedDoc(N);
    const editors: TestClient[] = [];
    for (let i = 0; i < N; i++) {
      const u = users[i]!;
      editors.push(
        client({
          port: server.port,
          projectId,
          fileId,
          token: tokenFor(projectId, u, i === 0 ? "OWNER" : "EDITOR"),
          user: { id: u.id, name: u.name, color: "#123456" },
        }),
      );
    }
    await Promise.all(editors.map((e) => e.synced));

    // --- latency sampling: observer on each client records when another
    // client's marker line is first seen locally. ---
    const sentAt = new Map<string, number>();
    const seenAt = new Map<string, Map<string, number>>(); // marker -> (observerIdx -> ts)
    editors.forEach((ed, observerIdx) => {
      ed.ytext.observe(() => {
        const text = ed.ytext.toString();
        for (const marker of sentAt.keys()) {
          if (text.includes(marker)) {
            let per = seenAt.get(marker);
            if (!per) {
              per = new Map();
              seenAt.set(marker, per);
            }
            if (!per.has(observerIdx)) per.set(observerIdx, Date.now());
          }
        }
      });
    });

    const marker = (i: number, k: number) => `C${i}-L${k}`;
    const bursts = 4;
    const perBurst = LINES / bursts;
    await Promise.all(
      editors.map(async (ed, i) => {
        for (let b = 0; b < bursts; b++) {
          ed.doc.transact(() => {
            for (let k = b * perBurst; k < (b + 1) * perBurst; k++) {
              const m = marker(i, k);
              if (k === 0) sentAt.set(`LAT-${m}`, Date.now());
              ed.ytext.insert(ed.ytext.length, `${k === 0 ? `LAT-${m}` : m}\n`);
            }
          });
          await new Promise((r) => setTimeout(r, 25 + i * 10));
        }
      }),
    );

    // All 200 markers everywhere, then byte-identical documents.
    await waitFor(
      () =>
        editors.every((ed) => {
          const t = ed.ytext.toString();
          for (let i = 0; i < N; i++) for (let k = 0; k < LINES; k++) if (!t.includes(marker(i, k))) return false;
          return true;
        }),
      { timeoutMs: 30_000, label: "all clients hold all 200 markers" },
    );
    const reference = editors[0]!.ytext.toString();
    for (const ed of editors) expect(ed.ytext.toString()).toBe(reference);

    // --- offline edit + reconnect (client 4) ---
    const offline = editors[N - 1]!;
    offline.provider.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    const offlineMarkers: string[] = [];
    offline.doc.transact(() => {
      for (let k = 0; k < 5; k++) {
        const m = `OFF-C${N - 1}-L${k}`;
        offlineMarkers.push(m);
        offline.ytext.insert(offline.ytext.length, `${m}\n`);
      }
    });
    expect(editors[0]!.ytext.toString()).not.toContain(offlineMarkers[0]);
    offline.provider.connect();
    await waitFor(() => editors.every((ed) => offlineMarkers.every((m) => ed.ytext.toString().includes(m))), {
      timeoutMs: 30_000,
      label: "offline edits converge after reconnect",
    });
    const reference2 = editors[0]!.ytext.toString();
    for (const ed of editors) expect(ed.ytext.toString()).toBe(reference2);

    // --- persistence: the stored Yjs state decodes to the same text ---
    await waitFor(
      async () => {
        const row = await prisma.yjsDocument.findUnique({ where: { fileId } });
        if (!row) return false;
        return textFromPersistedState(new Uint8Array(row.state)) === reference2;
      },
      { timeoutMs: 30_000, label: "persisted YjsDocument matches converged text" },
    );

    // --- report the measured latencies (real numbers, printed for the QA report) ---
    const samples: number[] = [];
    for (const [m, per] of seenAt) {
      const sent = sentAt.get(m);
      if (sent === undefined) continue;
      const senderIdx = Number(/^LAT-C(\d+)-/.exec(m)?.[1] ?? -1);
      for (const [observerIdx, ts] of per) {
        if (observerIdx === senderIdx) continue; // exclude self-observation
        samples.push(Math.max(0, ts - sent));
      }
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? 0;
    const max = samples[samples.length - 1] ?? 0;
    console.log(
      `[phase7-concurrency] clients=${N} linesPerClient=${LINES} latencySamples=${samples.length} medianMs=${median} p95Ms=${p95} maxMs=${max}`,
    );
    expect(samples.length).toBeGreaterThan(0);
    expect(median).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
