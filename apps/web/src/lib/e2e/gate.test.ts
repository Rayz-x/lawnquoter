import { describe, expect, it } from "vitest";
import { e2eEnabled } from "./gate";

describe("e2e gate", () => {
  it("stays off unless the fixture flag is set, including on Vercel production", () => {
    expect(e2eEnabled({})).toBe(false);
    expect(e2eEnabled({ E2E_MODE: "1", VERCEL_ENV: "production" })).toBe(false);
    expect(e2eEnabled({ E2E_MODE: "1" })).toBe(true);
  });
});
