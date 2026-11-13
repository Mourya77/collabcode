/**
 * Phase 8 — portfolio screenshot capture (NOT part of the test suite).
 *
 * Boots the same real stack as playwright.config.ts (dedicated embedded
 * Postgres via bootstrap.mjs, built API + collaboration + execution
 * services, production web build via `vite preview`), seeds two users and
 * a project through the real UI/API, and captures the README screenshots
 * into docs/screenshots/ at 1440x900.
 *
 * Run:  node apps/e2e/screenshots.mjs        (from anywhere; paths self-resolve)
 * The stack is torn down on exit; the e2e Postgres is stopped by
 * bootstrap.mjs's own SIGTERM handler.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const OUT_DIR = path.join(repoRoot, "docs", "screenshots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const SIGNING_KEY = "e2e-test-signing-key".repeat(2);
const DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55435/collabcode_e2e?schema=public";
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PASSWORD = "<MASKED_SECRET_003>";

const children = [];
function spawnSvc(name, command, args, options) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: true, ...options });
  child.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  children.push(child);
  return child;
}
function stopAll() {
  for (const c of children.splice(0)) {
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      try {
        c.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
}
process.on("exit", stopAll);

async function waitForUrl(url, label, timeoutMs = 120_000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label} (${url})`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function until(fn, label, timeoutMs = 30_000) {
  const start = Date.now();
  let last;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out: ${label}${last ? ` (${last})` : ""}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ---- browser helpers (mirror tests/helpers.ts) ----

const MONACO_VS_DIR = path.resolve(here, "../web/node_modules/monaco-editor/min/vs");
const CONTENT_TYPES = { ".js": "application/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
async function serveMonacoFromLocalPackage(context) {
  await context.route("https://cdn.jsdelivr.net/npm/monaco-editor@*/min/vs/**", async (route) => {
    const rel = new URL(route.request().url()).pathname.split("/min/vs/")[1] ?? "";
    const file = path.join(MONACO_VS_DIR, rel);
    if (!file.startsWith(MONACO_VS_DIR) || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ body: fs.readFileSync(file), contentType: CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
  });
}

async function registerUser(page, { name, email }) {
  await page.goto("/register");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
}

async function createProject(page, name) {
  await page.getByRole("button", { name: "Create project" }).first().click();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).last().click();
  await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
}

async function openFile(page, name) {
  await page.getByRole("button", { name: `Open file ${name}` }).click();
}

async function editorText(page) {
  const raw = await page.locator(".monaco-editor .view-lines").innerText();
  return raw.replace(/ /g, " ");
}

async function expectEditorToContain(page, text) {
  await until(async () => (await editorText(page)).includes(text), `editor to contain: ${text}`);
}

async function appendToEditor(page, text) {
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text, { delay: 15 });
}

async function inviteByEmail(page, email, role) {
  await page.getByRole("button", { name: /Invite/ }).click();
  await page.getByLabel("Invite by email").fill(email);
  await page.getByLabel("Role").selectOption(role);
  await page.getByRole("button", { name: "Send invitation" }).click();
  const link = page.getByLabel("Invitation link", { exact: true });
  await until(async () => /\/invite\//.test(await link.inputValue()), "invite link to appear");
  return link.inputValue();
}

async function acceptInvite(page, inviteUrl) {
  const p = new URL(inviteUrl).pathname;
  await page.goto(p);
  await page.getByRole("button", { name: /accept/i }).click();
  await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
}

/** Authenticated API call from inside the page (session cookie + CSRF). */
async function apiInPage(page, method, urlPath, body) {
  return page.evaluate(
    async ([m, u, b]) => {
      const csrf = document.cookie
        .split("; ")
        .find((c) => c.startsWith("cc_csrf="))
        ?.split("=")[1];
      const res = await fetch(u, {
        method: m,
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf ?? "" },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    [method, urlPath, body],
  );
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file });
  const size = fs.statSync(file).size;
  console.log(`[shots] ${name} — ${size} bytes`);
  if (size < 10_000) throw new Error(`Screenshot ${name} looks too small (${size} bytes) — page may be blank/broken`);
}

// ---- main ----

const PYTHON_CODE = `"""Q3 pipeline summary — sales by region."""

regions = {
    "north": 124_500,
    "south": 98_200,
    "west": 143_750,
    "east": 87_300,
}

total = sum(regions.values())
best = max(regions, key=regions.get)

print("Q3 pipeline summary")
for name, value in sorted(regions.items()):
    print(f"  {name:<6} \${value:,}")
print(f"  total  \${total:,}")
print(f"Top region: {best}")
`;

async function main() {
  console.log("[shots] booting infrastructure (bootstrap.mjs)…");
  spawnSvc("bootstrap", "node", ["bootstrap.mjs"], { cwd: here });
  await waitForUrl("http://127.0.0.1:5999/ready", "e2e bootstrap", 300_000);

  const apiEnv = { ...process.env, NODE_ENV: "test", PORT: "4000", DATABASE_URL, JWT_SECRET: SIGNING_KEY };
  const collabEnv = {
    ...process.env,
    NODE_ENV: "development",
    PORT: "4001",
    HEALTH_PORT: "4003",
    DATABASE_URL,
    JWT_SECRET: SIGNING_KEY,
  };
  const execEnv = { ...process.env, NODE_ENV: "test", PORT: "4002", EXECUTION_RUNNER: "subprocess" };
  spawnSvc("api", "node", [path.join(repoRoot, "apps/api/dist/server.js")], { cwd: repoRoot, env: apiEnv });
  spawnSvc("collab", "node", [path.join(repoRoot, "apps/collaboration/dist/server.js")], { cwd: repoRoot, env: collabEnv });
  spawnSvc("execution", "node", [path.join(repoRoot, "apps/execution/dist/server.js")], { cwd: repoRoot, env: execEnv });
  spawnSvc("web", "pnpm", ["exec", "vite", "preview", "--port", "5173", "--strictPort", "--host", "127.0.0.1"], {
    cwd: path.join(repoRoot, "apps/web"),
  });
  await waitForUrl("http://127.0.0.1:4000/api/health/ready", "api");
  await waitForUrl("http://127.0.0.1:4003/", "collab health");
  await waitForUrl("http://127.0.0.1:4002/health", "execution");
  await waitForUrl("http://127.0.0.1:5173/", "web preview");

  const browser = await chromium.launch();
  try {
    const viewport = { width: 1440, height: 900 };
    const baseURL = "http://localhost:5173";
    const anonCtx = await browser.newContext({ viewport, baseURL });
    await serveMonacoFromLocalPackage(anonCtx);
    const landing = await anonCtx.newPage();
    await landing.goto("/");
    await landing.getByRole("heading").first().waitFor({ timeout: 30_000 });
    await landing.waitForTimeout(800);
    await shot(landing, "01-landing.png");
    await anonCtx.close();

    const ownerCtx = await browser.newContext({ viewport, baseURL });
    const editorCtx = await browser.newContext({ viewport, baseURL });
    await serveMonacoFromLocalPackage(ownerCtx);
    await serveMonacoFromLocalPackage(editorCtx);
    const owner = await ownerCtx.newPage();
    const editor = await editorCtx.newPage();

    const ownerEmail = `shots.owner.${RUN}@example.com`;
    const editorEmail = `shots.editor.${RUN}@example.com`;

    await registerUser(owner, { name: "Maya Chen", email: ownerEmail });
    await createProject(owner, "Apollo — Realtime Docs");
    const projectId = owner.url().split("/").pop();

    // A Python file with runnable demo content (via the real API).
    const created = await apiInPage(owner, "POST", `/api/projects/${projectId}/files`, { name: "analysis.py", type: "FILE" });
    if (created.status !== 201) throw new Error(`create analysis.py failed: ${JSON.stringify(created.json)}`);
    const pyId = created.json.data.id;
    const saved = await apiInPage(owner, "PATCH", `/api/files/${pyId}`, { content: PYTHON_CODE });
    if (saved.status !== 200) throw new Error(`save analysis.py failed: ${JSON.stringify(saved.json)}`);

    // Second project so the dashboard shot shows a real list.
    await owner.goto("/dashboard");
    await createProject(owner, "Data Playground");
    await owner.goto("/dashboard");
    await owner.getByText("Apollo — Realtime Docs").waitFor({ timeout: 30_000 });
    await owner.waitForTimeout(600);
    await shot(owner, "02-dashboard.png");

    // Back into the Apollo workspace; invite the editor.
    await owner.getByText("Apollo — Realtime Docs").click();
    await owner.waitForURL(/\/workspace\//, { timeout: 30_000 });
    const inviteUrl = await inviteByEmail(owner, editorEmail, "EDITOR");
    await owner.keyboard.press("Escape");

    await registerUser(editor, { name: "Arjun Mehta", email: editorEmail });
    await acceptInvite(editor, inviteUrl);

    // Both users on src/main.ts; the editor adds a line.
    await openFile(editor, "main.ts");
    await expectEditorToContain(editor, "greet");
    await appendToEditor(editor, "\n// Live from Arjun — editing in real time!\n");
    await openFile(owner, "main.ts");
    await expectEditorToContain(owner, "Live from Arjun");
    // Leave the editor's cursor parked mid-file so the remote caret shows.
    await editor.locator(".monaco-editor .view-lines > div").nth(2).click();
    await owner.bringToFront();
    await owner.waitForTimeout(900);
    await shot(owner, "03-workspace-editing.png");

    // Chat exchange. (The chat panel is mounted in the Collaboration aside;
    // scope to it — a second hidden instance exists in the layout.)
    const ownerPanel = owner.locator("aside[aria-label='Collaboration panel']");
    const editorPanel = editor.locator("aside[aria-label='Collaboration panel']");
    await owner.getByRole("tab", { name: "Chat" }).click();
    const ownerBox = ownerPanel.getByLabel("Chat message", { exact: true });
    await ownerBox.fill("Pushed the new greet() helper — take a look when you can.");
    await ownerPanel.getByRole("button", { name: "Send message" }).click();
    await editor.getByRole("tab", { name: "Chat" }).click();
    const editorBox = editorPanel.getByLabel("Chat message", { exact: true });
    await until(async () => (await editorPanel.locator("ul[aria-label='Chat messages']").innerText()).includes("greet() helper"), "message to reach editor");
    await editorBox.fill("Reviewing now — sync was instant on my side.");
    await editorPanel.getByRole("button", { name: "Send message" }).click();
    await until(async () => (await ownerPanel.locator("ul[aria-label='Chat messages']").innerText()).includes("sync was instant"), "reply to reach owner");
    await owner.waitForTimeout(500);
    await shot(owner, "04-chat.png");

    // Version history: snapshot, then a post-snapshot edit, then diff.
    await owner.getByRole("button", { name: /History/ }).click();
    await owner.getByLabel("Snapshot label (optional)").fill("Demo release");
    await owner.getByRole("button", { name: /Create snapshot/ }).click();
    await until(async () => (await owner.locator("body").innerText()).includes("created."), "snapshot notice");
    await owner.getByRole("button", { name: "Close version history" }).click();
    await openFile(owner, "main.ts");
    await appendToEditor(owner, "const afterSnapshot = true;\n");
    await expectEditorToContain(owner, "afterSnapshot");
    await owner.getByRole("button", { name: /History/ }).click();
    await owner.locator("li", { hasText: "Demo release" }).waitFor({ timeout: 30_000 });
    await owner.waitForTimeout(500);
    await shot(owner, "05-version-history.png");
    const row = owner.locator("li", { hasText: "Demo release" });
    await row.getByRole("button", { name: /^Preview diff/ }).click();
    await owner.locator(".monaco-diff-editor").waitFor({ timeout: 30_000 });
    await owner.waitForTimeout(1200);
    await shot(owner, "05-version-diff.png");
    await owner.getByRole("button", { name: "Close diff" }).click();
    await owner.getByRole("button", { name: "Close version history" }).click();

    // Execution output (Python via the real execution service).
    await openFile(owner, "analysis.py");
    await expectEditorToContain(owner, "pipeline summary");
    const runBtn = owner.getByRole("button", { name: /^Run$/ });
    await until(async () => await runBtn.isEnabled(), "Run button enabled");
    await runBtn.click();
    await owner.getByTestId("execution-stdout").waitFor({ timeout: 60_000 });
    await until(async () => (await owner.getByTestId("execution-stdout").innerText()).includes("Top region: west"), "python output");
    await until(async () => (await owner.getByTestId("execution-footer").innerText()).includes("COMPLETED"), "execution footer");
    await owner.waitForTimeout(500);
    await shot(owner, "06-execution-output.png");

    await ownerCtx.close();
    await editorCtx.close();
  } finally {
    await browser.close();
  }
  console.log("[shots] all screenshots captured into docs/screenshots/");
}

main()
  .then(() => {
    stopAll();
    process.exit(0);
  })
  .catch((e) => {
    console.error("[shots] FAILED:", e);
    stopAll();
    process.exit(1);
  });
