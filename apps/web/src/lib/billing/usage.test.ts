import { describe, expect, it } from "vitest";
import { usageFromRpc } from "./usage";

describe("usage totals", () => {
  it("reads the imagery and measurement totals and rejects a bad payload", () => {
    expect(usageFromRpc({ imagery_sessions: 2, measurements: 3 })).toEqual({ imagerySessions: 2, measurements: 3 });
    expect(usageFromRpc(null)).toBeNull();
    expect(usageFromRpc({ imagery_sessions: "2", measurements: 3 })).toBeNull();
  });
});
