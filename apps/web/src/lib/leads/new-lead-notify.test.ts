import { describe, expect, it, vi } from "vitest";
import {
  formatReplyWithin,
  officeNewLeadEmail,
  queueNewLeadEmails,
  requesterConfirmationEmail,
  sendQueuedNewLeadEmails,
  type NewLeadNotifyInput,
} from "./new-lead-notify";

function baseInput(overrides: Partial<NewLeadNotifyInput> = {}): NewLeadNotifyInput {
  return {
    status: "new",
    officeTo: "office@green.co",
    requesterEmail: "pat@example.com",
    orgName: "Green Co",
    contactName: "Pat Homeowner",
    addressTyped: "123 Oak St",
    services: ["mowing"],
    phone: "5125551212",
    replyWithinMinutes: 60,
    ...overrides,
  };
}

describe("new-lead notifier", () => {
  it("queues one office email per new request", () => {
    const queued = queueNewLeadEmails(baseInput({ requesterEmail: null }));

    expect(queued).toHaveLength(1);
    expect(queued[0]?.to).toBe("office@green.co");
    expect(queued[0]?.subject).toMatch(/new lead/i);
    expect(queued[0]?.text).toContain("Pat Homeowner");
    expect(queued[0]?.text).toContain("123 Oak St");
  });

  it("queues nothing for spam", () => {
    expect(queueNewLeadEmails(baseInput({ status: "spam" }))).toEqual([]);
  });

  it("confirmation goes only to the provided requester email", () => {
    const queued = queueNewLeadEmails(
      baseInput({
        officeTo: "assignee@green.co",
        requesterEmail: "only-me@example.com",
      }),
    );

    const confirmation = queued.filter((m) => m.to === "only-me@example.com");
    expect(confirmation).toHaveLength(1);
    expect(confirmation[0]?.text.toLowerCase()).not.toMatch(/unsubscribe|sale|promo|marketing/);
    expect(confirmation[0]?.text).toMatch(/within 1 hour/i);
    expect(queued.every((m) => m.to === "assignee@green.co" || m.to === "only-me@example.com")).toBe(
      true,
    );
    expect(queued.filter((m) => m.to === "assignee@green.co")).toHaveLength(1);
  });

  it("skips confirmation when no requester email was provided", () => {
    const queued = queueNewLeadEmails(baseInput({ requesterEmail: null }));
    expect(queued.every((m) => m.to === "office@green.co")).toBe(true);
  });

  it("falls back to office email when assignee is missing", () => {
    const msg = officeNewLeadEmail({
      to: "office@green.co",
      orgName: "Green Co",
      contactName: "Pat",
      addressTyped: "1 Main",
      services: [],
      phone: null,
      email: null,
    });
    expect(msg.to).toBe("office@green.co");
  });

  it("formats reply windows for the confirmation", () => {
    expect(formatReplyWithin(60)).toMatch(/1 hour/i);
    expect(formatReplyWithin(30)).toMatch(/30 minutes/i);
    expect(requesterConfirmationEmail({
      to: "a@b.co",
      orgName: "Co",
      contactName: "Pat",
      addressTyped: "1 Main",
      services: ["mow"],
      replyWithinMinutes: 120,
    }).text).toMatch(/within 2 hours/i);
  });

  it("sends each queued message once", async () => {
    const send = vi.fn(async () => ({ id: "1", sent: true }));
    const result = await sendQueuedNewLeadEmails(baseInput(), send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ officeSent: 1, confirmationSent: 1 });
  });
});
