import { describe, it, expect } from "vitest";
import { makeApiError, makeHealth, parseEnv, healthStatusSchema, PROJECT_ROLES, okEnvelope } from "../src/index";

describe("shared", () => {
  it("makeApiError produces the shared shape", () => {
    const e = makeApiError("NOT_FOUND", "Missing", undefined, "req-1");
    expect(e.error.code).toBe("NOT_FOUND");
    expect(e.error.requestId).toBe("req-1");
  });
  it("makeHealth validates against healthStatusSchema", () => {
    const h = makeHealth("api");
    expect(() => healthStatusSchema.parse(h)).not.toThrow();
    expect(h.service).toBe("api");
  });
  it("parseEnv applies defaults and coercion", () => {
    const env = parseEnv({}, { NODE_ENV: "test", PORT: "4000" });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("test");
  });
  it("parseEnv throws clearly on invalid env", () => {
    expect(() => parseEnv({}, { PORT: "nope" })).toThrow(/Invalid environment/);
  });
  it("okEnvelope follows {success,data,error,requestId}", () => {
    expect(okEnvelope({ a: 1 }, "r1")).toEqual({ success: true, data: { a: 1 }, error: null, requestId: "r1" });
    expect(PROJECT_ROLES).toEqual(["OWNER", "EDITOR", "VIEWER"]);
  });
});
