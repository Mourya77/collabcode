/**
 * Live smoke for Phase 3 (manual verification, not part of the test suite):
 * boots against the REAL running API (4000) + collaboration server (4001) +
 * PostgreSQL, registers two users through the API, creates a project,
 * invites the second user, fetches collab tokens for both, then edits one
 * file concurrently from two HocuspocusProvider clients and prints the
 * converged document + the DocumentVersions the server synced back.
 *
 * Prereqs: embedded PG up (apps/api/scripts/dev-db.mjs start), API and
 * collaboration servers running with the same DATABASE_URL + JWT_SECRET.
 * Run: node scripts/live-smoke.mjs
 */
import * as Y from "yjs";
import WebSocket from "ws";
import { HocuspocusProvider } from "@hocuspocus/provider";

const API = process.env.API_URL ?? "http://localhost:4000";
const COLLAB = process.env.COLLAB_URL ?? "ws://localhost:4001";
const stamp = Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cookieJar() {
  const jar = new Map();
  return {
    absorb(res) {
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const sc of setCookies) {
        const [pair] = sc.split(";");
        const idx = pair.indexOf("=");
        if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    get(name) {
      return jar.get(name);
    },
  };
}

async function api(jar, method, path, body) {
  const headers = { "content-type": "application/json", cookie: jar.header() };
  const csrf = jar.get("cc_csrf");
  if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.absorb(res);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function registerUser(name) {
  const jar = cookieJar();
  await api(jar, "GET", "/api/auth/csrf");
  const email = `${name.toLowerCase()}.smoke.${stamp}@example.com`;
  const user = await api(jar, "POST", "/api/auth/register", { name, email, password: "password1234" });
  return { jar, user };
}

function connect(token, documentName, user) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: COLLAB,
    name: documentName,
    document: doc,
    token,
    WebSocketPolyfill: WebSocket,
  });
  provider.awareness.setLocalStateField("user", { id: user.id, name: user.name, color: "#3b82f6" });
  return { doc, provider, yText: doc.getText("content") };
}

async function waitFor(fn, label, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for: ${label}`);
    await sleep(100);
  }
}

const ada = await registerUser("Ada");
const grace = await registerUser("Grace");
console.log(`registered: ${ada.user.email} / ${grace.user.email}`);

const project = await api(ada.jar, "POST", "/api/projects", { name: `Smoke ${stamp}` });
console.log(`project created: ${project.id} (role ${project.role})`);

const member = await api(ada.jar, "POST", `/api/projects/${project.id}/invitations`, {
  email: grace.user.email,
  role: "EDITOR",
});
console.log(`invited Grace as ${member.role}`);

const files = await api(ada.jar, "GET", `/api/projects/${project.id}/files`);
const welcome = files.find((f) => f.name === "welcome.md");
console.log(`seeded file: welcome.md ${welcome.id}`);

const adaToken = await api(ada.jar, "POST", "/api/collab/token", { projectId: project.id });
const graceToken = await api(grace.jar, "POST", "/api/collab/token", { projectId: project.id });
console.log(`collab tokens: Ada role=${adaToken.role}, Grace role=${graceToken.role}, expires ${adaToken.expiresAt}`);

const documentName = `project:${project.id}:file:${welcome.id}`;
const a = connect(adaToken.token, documentName, ada.user);
const g = connect(graceToken.token, documentName, grace.user);
await waitFor(() => a.provider.synced && g.provider.synced, "both providers synced");
console.log(`both synced; seeded content on both: ${JSON.stringify(a.yText.toString())} === ${JSON.stringify(g.yText.toString())}`);
console.log(`awareness on Ada's client: ${a.provider.awareness.getStates().size} user(s) present`);

// Concurrent edits in the same tick.
a.yText.insert(a.yText.length, "\n[Ada] concurrent edit from Ada\n");
g.yText.insert(0, "[Grace] concurrent edit from Grace\n");

await waitFor(
  () => a.yText.toString() === g.yText.toString() && a.yText.toString().includes("[Ada]") && a.yText.toString().includes("[Grace]"),
  "convergence",
);
console.log("CONVERGED — both clients hold identical text:");
console.log("-----");
console.log(a.yText.toString());
console.log("-----");

// Server persistence: default store debounce is 2s; the version sync runs
// with the store. Give it a window, then read versions back through the API.
await sleep(5000);
const versions = await api(ada.jar, "GET", `/api/files/${welcome.id}/versions`);
const latestMeta = versions.reduce((m, v) => (!m || v.createdAt > m.createdAt ? v : m), null);
const latest = await api(ada.jar, "GET", `/api/files/${welcome.id}/versions/${latestMeta.id}`);
console.log(`DocumentVersions after collab edits: ${versions.length} total (seed version + server-synced versions)`);
console.log(`latest version content matches converged text: ${latest.content === a.yText.toString()}`);

a.provider.destroy();
g.provider.destroy();
await sleep(300);
console.log("SMOKE OK");
process.exit(0);
