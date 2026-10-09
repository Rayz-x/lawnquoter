import { OutboxPanel } from "@/components/crew/outbox-panel";
import { requireOrg } from "@/lib/auth/session";

export default async function CrewOutboxPage() {
  const session = await requireOrg();
  return <OutboxPanel userId={session.userId} orgId={session.orgId} />;
}
