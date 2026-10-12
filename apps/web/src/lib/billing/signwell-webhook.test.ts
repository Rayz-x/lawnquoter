import { describe, expect, it, vi } from "vitest";
import { SIGNWELL_NOT_CONNECTED } from "./signwell";
import { handleSignWellWebhook } from "./signwell-webhook";

const WEBHOOK_ID = "wh_123";
const COMPLETED_AT = 1700000000;
const COMPLETED_HASH = "59ded0baf9e6193904b5f9c17d2f0dfe9cd2c5dea380d75f0036a464bb64d784";

function completedBody() {
  return {
    event: { hash: COMPLETED_HASH, time: COMPLETED_AT, type: "document_completed" },
    data: {
      object: {
        id: "doc_completed",
        recipients: [{ id: "1", name: "Pat Buyer", email: "pat@example.com" }],
      },
    },
  };
}

describe("SignWell completion webhook", () => {
  it("stays off until the SignWell key and webhook id are set", async () => {
    const record = vi.fn();
    const result = await handleSignWellWebhook(completedBody(), {
      webhookId: null,
      apiKey: null,
      nowSeconds: COMPLETED_AT,
      record,
    });
    expect(result).toEqual({ status: 503, error: SIGNWELL_NOT_CONNECTED });
    expect(record).not.toHaveBeenCalled();
  });

  it("accepts the quote when the completed event hash matches", async () => {
    const record = vi.fn(async () => ({ ok: true as const }));
    const result = await handleSignWellWebhook(completedBody(), {
      webhookId: WEBHOOK_ID,
      apiKey: "test-key",
      nowSeconds: COMPLETED_AT,
      record,
    });
    expect(result).toEqual({ status: 200 });
    expect(record).toHaveBeenCalledWith({
      documentId: "doc_completed",
      signerName: "Pat Buyer",
      signerEmail: "pat@example.com",
    });
  });

  it("rejects a hash that was not made with the webhook id", async () => {
    const record = vi.fn();
    const body = completedBody();
    body.event.hash = "ab";
    const result = await handleSignWellWebhook(body, {
      webhookId: WEBHOOK_ID,
      apiKey: "test-key",
      nowSeconds: COMPLETED_AT,
      record,
    });
    expect(result.status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });

  it("ignores a viewed event that still has a valid hash", async () => {
    const { createHmac } = await import("node:crypto");
    const hash = createHmac("sha256", WEBHOOK_ID).update("document_viewed@1700000000").digest("hex");
    const record = vi.fn();
    const result = await handleSignWellWebhook(
      {
        event: { hash, time: COMPLETED_AT, type: "document_viewed" },
        data: { object: { id: "doc_completed", recipients: [] } },
      },
      { webhookId: WEBHOOK_ID, apiKey: "test-key", nowSeconds: COMPLETED_AT, record },
    );
    expect(result).toEqual({ status: 200 });
    expect(record).not.toHaveBeenCalled();
  });
});
