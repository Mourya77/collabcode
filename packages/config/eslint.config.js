// Shared ESLint flat config — used by every app via a re-exporting eslint.config.js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Generated code (the collaboration app's generated Prisma client) and
    // build output are never hand-linted — Phase 7 made lint real, and
    // these ignores are what keep the signal meaningful.
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/generated/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // Express request augmentation (`declare global { namespace Express }`)
      // is the canonical, type-only way to extend Express's Request type.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
    },
  },
  {
    // Plain Node scripts (dev-db, smoke scripts, this package's validator)
    // run outside the TS project: give them Node globals.
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
      },
    },
  },
);
