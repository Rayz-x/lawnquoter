import type { CardSetupSession, SavedCard } from "./card-on-file";
import { cardFromSetupSession } from "./card-on-file";

export type CardSetupStore = {
  claimEvent: (eventId: string, orgId: string | null) => Promise<{ claimed: boolean }>;
  saveCard: (input: { orgId: string; accountId: string; card: SavedCard; makeDefault: boolean }) => Promise<void>;
  hasCard: (accountId: string) => Promise<boolean>;
};

export async function applyCardSetupEvent(deps: {
  eventId: string;
  session: CardSetupSession;
  store: CardSetupStore;
}): Promise<"saved" | "duplicate" | "ignored"> {
  const parsed = cardFromSetupSession(deps.session);
  if (!parsed.ok) return "ignored";
  const claimed = await deps.store.claimEvent(deps.eventId, parsed.orgId);
  if (!claimed.claimed) return "duplicate";
  const hasCard = await deps.store.hasCard(parsed.accountId);
  await deps.store.saveCard({
    orgId: parsed.orgId,
    accountId: parsed.accountId,
    card: parsed.card,
    makeDefault: !hasCard,
  });
  return "saved";
}
