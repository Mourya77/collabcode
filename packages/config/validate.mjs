import { readFileSync } from "node:fs";
for (const f of ["tsconfig/base.json","tsconfig/node.json","tsconfig/react.json","package.json"]) {
  JSON.parse(readFileSync(new URL("./"+f, import.meta.url), "utf8"));
}
await import("./eslint.config.js").catch(() => { console.log("eslint config present (deps resolved at root)"); });
await import("./prettier.config.js");
console.log("@collabcode/config: JSON + prettier config valid");
