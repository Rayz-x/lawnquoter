import { beforeEach, describe, expect, it, vi } from "vitest";

type LeadRow = {
  id: string;
  org_id: string;
  status: "new" | "contacted" | "quoted" | "won" | "lost" | "spam";
  assignee_id: string | null;
  first_contacted_at: string | null;
  next_follow_up_on: string | null;
};

type ActivityRow = {
  org_id: string;
  lead_request_id: string;
  kind: string;
  summary: string;
  meta: Record<string, unknown>;
  actor_id: string | null;
  occurred_at?: string;
};

const state = vi.hoisted(() => ({
  role: "owner" as string,
  lead: {
    id: "lead-1",
    org_id: "org-1",
    status: "new",
    assignee_id: null,
    first_contacted_at: null,
    next_follow_up_on: null,
  } as LeadRow,
  activities: [] as ActivityRow[],
  settings: { default_assignee_id: null as string | null },
  ownerId: "11111111-1111-4111-8111-111111111111",
  profiles: [
    { id: "11111111-1111-4111-8111-111111111111", full_name: "Owner One" },
    { id: "22222222-2222-4222-8222-222222222222", full_name: "Sales One" },
  ],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireOrg: vi.fn(async () => ({
    userId: "user-1",
    email: null,
    orgId: "org-1",
    orgRole: state.role,
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from(table: string) {
      return makeQuery(table);
    },
  })),
}));

function makeQuery(table: string) {
  const filters: Record<string, unknown> = {};
  let patch: Record<string, unknown> | null = null;
  let insertRow: Record<string, unknown> | null = null;
  let mode: "select" | "update" | "insert" = "select";
  let inIds: string[] | null = null;
  let limited = false;

  const api = {
    select() {
      return api;
    },
    eq(key: string, value: unknown) {
      filters[key] = value;
      return api;
    },
    in(_key: string, values: string[]) {
      inIds = values;
      return api;
    },
    order() {
      return api;
    },
    limit() {
      limited = true;
      return api;
    },
    update(values: Record<string, unknown>) {
      mode = "update";
      patch = values;
      return api;
    },
    insert(values: Record<string, unknown>) {
      mode = "insert";
      insertRow = values;
      return api;
    },
    maybeSingle() {
      return Promise.resolve(finishSingle());
    },
    then(ok: (v: unknown) => unknown, err?: (v: unknown) => unknown) {
      return Promise.resolve(finishList()).then(ok, err);
    },
  };

  function finishSingle() {
    if (table === "org_lead_settings") {
      return { data: { default_assignee_id: state.settings.default_assignee_id }, error: null };
    }
    if (table === "memberships") {
      return { data: { user_id: state.ownerId }, error: null };
    }
    if (table === "lead_requests") {
      if (mode === "update" && patch) {
        Object.assign(state.lead, patch);
        return { data: { ...state.lead }, error: null };
      }
      if (filters.id !== state.lead.id || filters.org_id !== state.lead.org_id) {
        return { data: null, error: null };
      }
      return { data: { ...state.lead }, error: null };
    }
    return { data: null, error: null };
  }

  function finishList() {
    if (table === "lead_activities" && mode === "insert" && insertRow) {
      state.activities.push(insertRow as ActivityRow);
      return { data: null, error: null };
    }
    if (table === "lead_requests" && mode === "update" && patch) {
      Object.assign(state.lead, patch);
      return { data: [{ id: state.lead.id, assignee_id: state.lead.assignee_id }], error: null };
    }
    if (table === "profiles") {
      const rows = state.profiles.filter((p) => !inIds || inIds.includes(p.id));
      return { data: rows, error: null };
    }
    void limited;
    return { data: [], error: null };
  }

  return api;
}

import { logLeadContact, reassignLead, setLeadFollowUp } from "./actions";

function fd(entries: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

beforeEach(() => {
  state.role = "owner";
  state.lead = {
    id: "lead-1",
    org_id: "org-1",
    status: "new",
    assignee_id: null,
    first_contacted_at: null,
    next_follow_up_on: null,
  };
  state.activities = [];
  state.settings = { default_assignee_id: null };
  state.ownerId = "11111111-1111-4111-8111-111111111111";
});

describe("logLeadContact", () => {
  it("sets first_contacted_at once and writes an activity each time", async () => {
    expect(await logLeadContact("lead-1", fd({ channel: "call" }))).toEqual({ ok: true });
    const first = state.lead.first_contacted_at;
    expect(first).toBeTruthy();
    expect(state.lead.status).toBe("contacted");
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]?.kind).toBe("lead.contact.call");

    expect(await logLeadContact("lead-1", fd({ channel: "email" }))).toEqual({ ok: true });
    expect(state.lead.first_contacted_at).toBe(first);
    expect(state.activities).toHaveLength(2);
    expect(state.activities[1]?.kind).toBe("lead.contact.email");
  });

  it("blocks read_only", async () => {
    state.role = "read_only";
    expect(await logLeadContact("lead-1", fd({ channel: "text" }))).toEqual({
      ok: false,
      error: "You don't have permission to update leads.",
    });
    expect(state.activities).toHaveLength(0);
  });
});

describe("reassign and follow-up", () => {
  it("writes activities for reassign and follow-up", async () => {
    expect(await reassignLead("lead-1", fd({ assigneeId: "22222222-2222-4222-8222-222222222222" }))).toEqual({
      ok: true,
    });
    expect(state.lead.assignee_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(state.activities.at(-1)?.kind).toBe("lead.reassigned");

    expect(await setLeadFollowUp("lead-1", fd({ nextFollowUpOn: "2026-10-20" }))).toEqual({ ok: true });
    expect(state.lead.next_follow_up_on).toBe("2026-10-20");
    expect(state.activities.at(-1)?.kind).toBe("lead.follow_up_set");
  });
});
