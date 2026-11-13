import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], test: { globals: true, environment: "jsdom", include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"] } });
