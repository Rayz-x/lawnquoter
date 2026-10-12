import { describe, expect, it } from "vitest";
import { planFollowUps, type FollowUpQuote } from "./follow-up";

function quote(partial: Partial<FollowUpQuote> & Pick<FollowUpQuote, "id">): FollowUpQuote {
  return {
    accountId: "acct",
    status: "sent",
    sentAt: "2026-10-01T12:00:00.000Z",
    viewed: false,
    replied: false,
    stepsSent: 0,
    taskOpen: false,
    runId: "run-1",
    ...partial,
  };
}

const day = (iso: string) => new Date(iso);

describe("quote follow-ups", () => {
  it("stops on a reply, a view, or acceptance and does not create a call", () => {
    const now = day("2026-10-08T12:00:00.000Z");
    expect(planFollowUps([quote({ id: "q1", replied: true })], now)).toEqual([{ type: "stop", runId: "run-1", reason: "reply" }]);
    expect(planFollowUps([quote({ id: "q2", viewed: true })], now)).toEqual([{ type: "stop", runId: "run-1", reason: "view" }]);
    expect(planFollowUps([quote({ id: "q3", status: "accepted" })], now)).toEqual([{ type: "stop", runId: "run-1", reason: "accepted" }]);
    expect(planFollowUps([quote({ id: "q4", status: "declined", runId: null })], now)).toEqual([]);
  });

  it("texts on day 2, emails on day 5, then asks the rep to call", () => {
    expect(planFollowUps([quote({ id: "q1" })], day("2026-10-02T12:00:00.000Z"))).toEqual([]);
    expect(planFollowUps([quote({ id: "q1", runId: null })], day("2026-10-01T18:00:00.000Z"))).toEqual([{ type: "start", quoteId: "q1" }]);
    expect(planFollowUps([quote({ id: "q1" })], day("2026-10-03T12:00:00.000Z"))).toEqual([
      { type: "send", runId: "run-1", quoteId: "q1", accountId: "acct", channel: "sms", nextSteps: 1 },
    ]);
    expect(planFollowUps([quote({ id: "q1", stepsSent: 1 })], day("2026-10-06T12:00:00.000Z"))).toEqual([
      { type: "send", runId: "run-1", quoteId: "q1", accountId: "acct", channel: "email", nextSteps: 2 },
    ]);
    expect(planFollowUps([quote({ id: "q1", stepsSent: 2 })], day("2026-10-06T13:00:00.000Z"))).toEqual([
      { type: "call", runId: "run-1", quoteId: "q1", accountId: "acct" },
    ]);
    expect(planFollowUps([quote({ id: "q1", stepsSent: 2, taskOpen: true })], day("2026-10-07T12:00:00.000Z"))).toEqual([]);
  });
});
