import { createHmac, timingSafeEqual } from "node:crypto";
import { SIGNWELL_NOT_CONNECTED } from "./signwell";

const MAX_AGE_SECONDS = 300;

export type SignWellCompletion = {
  documentId: string;
  signerName: string;
  signerEmail: string;
};

export type SignWellWebhookResult =
  | { status: 200 }
  | { status: 401; error: string }
  | { status: 503; error: string }
  | { status: 500; error: string };

type EventBody = {
  event?: { hash?: unknown; time?: unknown; type?: unknown; related_signer?: { name?: unknown; email?: unknown } };
  data?: { object?: { id?: unknown; recipients?: { name?: unknown; email?: unknown }[] } };
};

function validHash(event: { hash: string; time: number; type: string }, webhookId: string): boolean {
  const actual = createHmac("sha256", webhookId).update(`${event.type}@${event.time}`).digest();
  let expected: Buffer;
  try {
    expected = Buffer.from(event.hash, "hex");
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function signerOf(body: EventBody): { name: string; email: string } | null {
  const related = body.event?.related_signer;
  const recipient = body.data?.object?.recipients?.find((person) => person?.email && person?.name) ?? body.data?.object?.recipients?.[0];
  const name = typeof related?.name === "string" && related.name.trim() ? related.name.trim() : recipient?.name;
  const email = typeof related?.email === "string" && related.email.trim() ? related.email.trim() : recipient?.email;
  if (typeof name !== "string" || typeof email !== "string") return null;
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  if (trimmedName.length < 2 || !trimmedEmail.includes("@")) return null;
  return { name: trimmedName, email: trimmedEmail };
}

/** Verified document_completed events become a SignWell acceptance. Other events are ignored. */
export async function handleSignWellWebhook(
  body: unknown,
  deps: {
    webhookId: string | null;
    apiKey: string | null;
    nowSeconds: number;
    record: (completion: SignWellCompletion) => Promise<{ ok: true } | { ok: false; error: string }>;
  },
): Promise<SignWellWebhookResult> {
  if (!deps.webhookId || !deps.apiKey) return { status: 503, error: SIGNWELL_NOT_CONNECTED };
  const parsed = body as EventBody;
  const event = parsed?.event;
  const type = typeof event?.type === "string" ? event.type : "";
  const time = typeof event?.time === "number" ? event.time : Number.NaN;
  const hash = typeof event?.hash === "string" ? event.hash : "";
  if (!type || !hash || !Number.isFinite(time)) return { status: 401, error: "Invalid SignWell event." };
  if (!validHash({ hash, time, type }, deps.webhookId)) return { status: 401, error: "Invalid SignWell event." };
  if (Math.abs(deps.nowSeconds - time) > MAX_AGE_SECONDS) return { status: 401, error: "Invalid SignWell event." };
  if (type !== "document_completed") return { status: 200 };

  const documentId = parsed.data?.object?.id;
  const signer = signerOf(parsed);
  if (typeof documentId !== "string" || !documentId || !signer) return { status: 401, error: "Invalid SignWell event." };
  const recorded = await deps.record({ documentId, signerName: signer.name, signerEmail: signer.email });
  if (!recorded.ok) return { status: 500, error: recorded.error };
  return { status: 200 };
}
