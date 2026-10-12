import { describe, expect, it, vi } from "vitest";
import { SIGNWELL_NOT_CONNECTED, createSignWellClient } from "./signwell";

describe("SignWell client", () => {
  it("does not call SignWell when the key is unset", async () => {
    const previous = process.env.SIGNWELL_API_KEY;
    delete process.env.SIGNWELL_API_KEY;
    const fetchImpl = vi.fn();
    await expect(
      createSignWellClient(fetchImpl as unknown as typeof fetch).createDocument({
        name: "Commercial contract",
        fileUrl: "https://example.com/q/token/pdf",
        recipientName: "Pat",
        recipientEmail: "pat@example.com",
      }),
    ).rejects.toThrow(SIGNWELL_NOT_CONNECTED);
    expect(fetchImpl).not.toHaveBeenCalled();
    if (previous === undefined) delete process.env.SIGNWELL_API_KEY;
    else process.env.SIGNWELL_API_KEY = previous;
  });

  it("stores the document id from a fake SignWell response", async () => {
    process.env.SIGNWELL_API_KEY = "test-key";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "doc_test" }), { status: 200 }));
    const created = await createSignWellClient(fetchImpl as unknown as typeof fetch).createDocument({
      name: "Commercial contract",
      fileUrl: "https://example.com/q/token/pdf",
      recipientName: "Pat",
      recipientEmail: "pat@example.com",
    });
    expect(created.id).toBe("doc_test");
    expect(fetchImpl).toHaveBeenCalledOnce();
    delete process.env.SIGNWELL_API_KEY;
  });
});
