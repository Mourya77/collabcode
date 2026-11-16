import { WebSocket } from "ws";

// @hocuspocus/provider's websocket layer falls back to the global `WebSocket`
// (its constructor references it directly when building its configuration),
// and that global only exists by default on Node >= 22. On Node 20 the
// reference throws `ReferenceError: WebSocket is not defined` before any
// test runs. Provide the `ws` implementation as the global so the suite
// behaves identically on every supported Node version.
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
}
