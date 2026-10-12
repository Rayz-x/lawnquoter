type SwitchClient = {
  rpc: (fn: "set_active_org", args: { p_org: string }) => PromiseLike<{ error: { message: string; code?: string } | null }>;
  auth: { refreshSession: () => PromiseLike<{ error: { message: string } | null }> };
};

/** Point this session at another company the user already belongs to, then remint the access token. */
export async function activateOrg(client: SwitchClient, orgId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await client.rpc("set_active_org", { p_org: orgId });
  if (error) {
    const denied = error.code === "42501" || /not a member/i.test(error.message);
    return { ok: false, error: denied ? "You are not a member of that company." : error.message };
  }
  const refreshed = await client.auth.refreshSession();
  if (refreshed.error) return { ok: false, error: refreshed.error.message };
  return { ok: true };
}
