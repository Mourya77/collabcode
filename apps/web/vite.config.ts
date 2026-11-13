import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

/**
 * Security headers for the dev/preview servers (Phase 7). The production
 * deployment must send the same headers — apps/web/vercel.json carries
 * them for Vercel; for other hosts copy them into the server config
 * (see docs/qa-report.md). The CSP allows exactly what the app uses:
 * same-origin assets, Monaco's loader, stylesheets (editor.main.css),
 * codicon fonts and workers from the jsDelivr CDN (script/style/font +
 * blob: workers), data:/blob: images, and ws(s) for the
 * collaboration/chat sockets.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://cdn.jsdelivr.net",
    "connect-src 'self' ws: wss: https://cdn.jsdelivr.net",
    "worker-src 'self' blob: https://cdn.jsdelivr.net",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        // y-monaco 0.1.6 imports Monaco via the pre-0.5x package path;
        // monaco-editor 0.57's "exports" map no longer resolves it, so
        // point the import at the real file inside the package.
        find: "monaco-editor/esm/vs/editor/editor.api.js",
        replacement: fileURLToPath(
          new URL("./node_modules/monaco-editor/esm/vs/editor/editor.api.js", import.meta.url),
        ),
      },
    ],
  },
  server: {
    port: 5173,
    headers: SECURITY_HEADERS,
    // ws: true so the Phase 4 chat gateway (/api/chat/ws) is proxied too.
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: true, ws: true } },
  },
  // Preview (production build) gets the same /api proxy so cookies stay
  // first-party when smoke-testing the built app against the local API.
  preview: {
    port: 5173,
    headers: SECURITY_HEADERS,
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: true, ws: true } },
  },
});
