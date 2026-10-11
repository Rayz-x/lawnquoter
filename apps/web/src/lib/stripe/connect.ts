export type ConnectStatus = "not_connected" | "pending" | "ready";

export type ConnectRow = {
  org_id: string;
  stripe_account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  status: ConnectStatus;
};

export function connectIdempotencyKey(orgId: string) {
  return `lawnquoter_connect_${orgId}`;
}

export function connectStatusFromFlags(chargesEnabled: boolean, payoutsEnabled: boolean): ConnectStatus {
  return chargesEnabled && payoutsEnabled ? "ready" : "pending";
}

export type ConnectStore = {
  getByOrg: (orgId: string) => Promise<{ stripe_account_id: string | null; status: ConnectStatus } | null>;
  upsert: (row: ConnectRow) => Promise<void>;
};

export async function startConnectOnboarding(deps: {
  orgId: string;
  returnUrl: string;
  refreshUrl: string;
  stripe: {
    accounts: { create: (params: object, opts?: { idempotencyKey: string }) => Promise<{ id: string }> };
    accountLinks: { create: (params: object) => Promise<{ url: string }> };
  };
  store: ConnectStore;
}) {
  const existing = await deps.store.getByOrg(deps.orgId);
  let accountId = existing?.stripe_account_id ?? null;
  const reused = Boolean(accountId);
  if (!accountId) {
    const account = await deps.stripe.accounts.create(
      {
        type: "express",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
          us_bank_account_ach_payments: { requested: true },
        },
      },
      { idempotencyKey: connectIdempotencyKey(deps.orgId) },
    );
    accountId = account.id;
  }
  if (!reused) {
    await deps.store.upsert({
      org_id: deps.orgId,
      stripe_account_id: accountId,
      charges_enabled: false,
      payouts_enabled: false,
      status: "pending",
    });
  }
  const link = await deps.stripe.accountLinks.create({
    account: accountId,
    refresh_url: deps.refreshUrl,
    return_url: deps.returnUrl,
    type: "account_onboarding",
  });
  return { url: link.url, accountId, reused };
}

export async function applyAccountUpdated(deps: {
  account: { id: string; charges_enabled: boolean; payouts_enabled: boolean };
  store: {
    updateByAccountId: (
      accountId: string,
      patch: { charges_enabled: boolean; payouts_enabled: boolean; status: ConnectStatus },
    ) => Promise<boolean>;
  };
}) {
  const status = connectStatusFromFlags(deps.account.charges_enabled, deps.account.payouts_enabled);
  const updated = await deps.store.updateByAccountId(deps.account.id, {
    charges_enabled: deps.account.charges_enabled,
    payouts_enabled: deps.account.payouts_enabled,
    status,
  });
  return updated ? ({ ok: true as const, status } as const) : ({ ok: false as const, reason: "unknown_account" } as const);
}
