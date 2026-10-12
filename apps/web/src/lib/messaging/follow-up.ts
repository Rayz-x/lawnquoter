export const FOLLOW_UP_STEPS = [
  { afterDays: 2, channel: "sms" as const },
  { afterDays: 5, channel: "email" as const },
];

export type FollowUpQuote = {
  id: string;
  accountId: string;
  status: string;
  sentAt: string;
  viewed: boolean;
  replied: boolean;
  stepsSent: number;
  taskOpen: boolean;
  runId: string | null;
};

export type FollowUpAction =
  | { type: "start"; quoteId: string }
  | { type: "stop"; runId: string; reason: "reply" | "view" | "accepted" | "declined" }
  | { type: "send"; runId: string | null; quoteId: string; accountId: string; channel: "sms" | "email"; nextSteps: number }
  | { type: "call"; runId: string; quoteId: string; accountId: string };

function daysSince(sentAt: string, now: Date): number {
  const sent = Date.parse(sentAt);
  if (Number.isNaN(sent)) return 0;
  return Math.floor((now.getTime() - sent) / 86_400_000);
}

function stopReason(quote: FollowUpQuote): "reply" | "view" | "accepted" | "declined" {
  if (quote.status === "accepted") return "accepted";
  if (quote.status === "declined") return "declined";
  if (quote.replied) return "reply";
  return "view";
}

export function planFollowUps(quotes: FollowUpQuote[], now: Date): FollowUpAction[] {
  const actions: FollowUpAction[] = [];
  for (const quote of quotes) {
    const engaged = quote.status === "accepted" || quote.status === "declined" || quote.replied || quote.viewed || quote.status === "viewed";
    if (engaged) {
      if (quote.runId) actions.push({ type: "stop", runId: quote.runId, reason: stopReason(quote) });
      continue;
    }
    if (quote.status !== "sent") continue;
    const elapsed = daysSince(quote.sentAt, now);
    const step = FOLLOW_UP_STEPS[quote.stepsSent];
    if (step && elapsed >= step.afterDays) {
      actions.push({ type: "send", runId: quote.runId, quoteId: quote.id, accountId: quote.accountId, channel: step.channel, nextSteps: quote.stepsSent + 1 });
      continue;
    }
    if (!step && quote.runId && !quote.taskOpen) {
      actions.push({ type: "call", runId: quote.runId, quoteId: quote.id, accountId: quote.accountId });
      continue;
    }
    if (!quote.runId) actions.push({ type: "start", quoteId: quote.id });
  }
  return actions;
}
