import { describe, expect, it } from "vitest";
import { timelineEntries } from "./timeline";

describe("timelineEntries", () => {
  it("hides an activity that a text or call already points at, and keeps the recording", () => {
    const entries = timelineEntries({
      activities: [
        { id: "act-text", kind: "sms.out", summary: "Text to +15551110000", occurredAt: "2026-10-02T12:00:00.000Z" },
        { id: "act-call", kind: "call.in", summary: "Call from +15551110000", occurredAt: "2026-10-03T12:00:00.000Z", recordingUrl: "https://rec.example/old" },
        { id: "act-mail", kind: "email.out", summary: "Email to pat@example.com", occurredAt: "2026-10-01T12:00:00.000Z" },
      ],
      messages: [
        { id: "msg-1", channel: "sms", direction: "out", body: "On my way", occurredAt: "2026-10-02T12:00:00.000Z", activityId: "act-text" },
      ],
      calls: [
        { id: "call-1", direction: "in", from: "+15551110000", occurredAt: "2026-10-04T15:00:00.000Z", recordingUrl: "https://rec.example/new", activityId: "act-call" },
      ],
    });
    expect(entries.map((entry) => entry.id)).toEqual(["call:call-1", "message:msg-1", "activity:act-mail"]);
    expect(entries[0]).toMatchObject({ label: "Call", recordingUrl: "https://rec.example/new" });
    expect(entries[1]).toMatchObject({ label: "Text", summary: "On my way" });
    expect(entries[2]).toMatchObject({ label: "Email", summary: "Email to pat@example.com" });
  });
});
