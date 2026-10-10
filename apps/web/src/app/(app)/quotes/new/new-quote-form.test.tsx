import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { NewQuoteForm } from "./new-quote-form";

const formHold = vi.hoisted(() => ({
  run: undefined as undefined | (() => unknown),
}));

const quoteAction = vi.hoisted(() => ({
  createQuoteAndGo: vi.fn<(accountId: string, propertyId?: string | null) => Promise<{ ok: false; error: string }>>(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(init: T | (() => T)) => {
      const value = typeof init === "function" ? (init as () => T)() : init;
      return [value, () => undefined];
    },
    useTransition: () => [false, (cb: () => unknown) => { formHold.run = cb; }],
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("../actions", () => ({
  createQuoteAndGo: (accountId: string, propertyId?: string | null) => quoteAction.createQuoteAndGo(accountId, propertyId),
}));

function formElement() {
  return NewQuoteForm({
    accounts: [{ id: "acct-1", name: "Ada" }],
    properties: [{ id: "prop-1", formatted_address: "1 Main St", account_id: "acct-1" }],
    defaultAccountId: "acct-1",
  });
}

beforeEach(() => {
  formHold.run = undefined;
  quoteAction.createQuoteAndGo.mockReset();
  quoteAction.createQuoteAndGo.mockResolvedValue({ ok: false, error: "Could not create quote" });
  vi.mocked(toast.error).mockClear();
  vi.stubGlobal(
    "FormData",
    class {
      get(name: string) {
        if (name === "account_id") return "acct-1";
        if (name === "property_id") return "prop-1";
        return null;
      }
    },
  );
});

describe("NewQuoteForm", () => {
  it("toasts the create error instead of ignoring the result", async () => {
    const form = formElement();
    form.props.onSubmit({ preventDefault() {}, currentTarget: {} });
    await formHold.run?.();

    expect(toast.error).toHaveBeenCalledWith("Could not create quote");
  });
});
