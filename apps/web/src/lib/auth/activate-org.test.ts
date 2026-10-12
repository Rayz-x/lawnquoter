import { describe, expect, it, vi } from "vitest";
import { activateOrg } from "./activate-org";

const orgId = "22222222-2222-4222-8222-222222222222";

describe("activateOrg", () => {
  it("switches the company and remints the session", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const refreshSession = vi.fn(async () => ({ error: null }));
    expect(await activateOrg({ rpc, auth: { refreshSession } }, orgId)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_active_org", { p_org: orgId });
    expect(refreshSession).toHaveBeenCalledOnce();
  });

  it("does not remint the session when the user is not a member", async () => {
    const refreshSession = vi.fn();
    const result = await activateOrg(
      { rpc: async () => ({ error: { message: "not a member of org", code: "42501" } }), auth: { refreshSession } },
      orgId,
    );
    expect(result).toEqual({ ok: false, error: "You are not a member of that company." });
    expect(refreshSession).not.toHaveBeenCalled();
  });
});
