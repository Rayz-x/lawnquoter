import type { LeadActivityRecord, LeadLostStore, LeadRecord } from "./lost";

/** In-memory store for mark-lost / reopen tests (L01 tables not required). */
export type MemoryLeadLostStore = LeadLostStore & {
  leads: Map<string, LeadRecord>;
  activities: LeadActivityRecord[];
  seed(lead: LeadRecord): void;
};

export function createMemoryLeadLostStore(): MemoryLeadLostStore {
  const leads = new Map<string, LeadRecord>();
  const activities: LeadActivityRecord[] = [];
  let activitySeq = 0;

  return {
    leads,
    activities,
    seed(lead) {
      leads.set(lead.id, { ...lead });
    },
    async getLead(leadId) {
      const lead = leads.get(leadId);
      return lead ? { ...lead } : null;
    },
    async saveLead(lead) {
      leads.set(lead.id, { ...lead });
    },
    async appendActivity(activity) {
      const row: LeadActivityRecord = {
        id: activity.id ?? `act-${++activitySeq}`,
        leadId: activity.leadId,
        orgId: activity.orgId,
        kind: activity.kind,
        payload: { ...activity.payload },
      };
      activities.push(row);
      return row;
    },
  };
}
