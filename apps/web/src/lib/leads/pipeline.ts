import { LEAD_LOST_REASON_LABELS, parseLeadLostReason } from "./lost";
import { ACTIVE_LEAD_STATUSES, type LeadStatus } from "./types";

/** Working kanban columns. Spam stays off the board. */
export const PIPELINE_STAGES = ACTIVE_LEAD_STATUSES;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type PipelineEvent = "contact_logged" | "quote_sent" | "quote_accepted" | "marked_lost";

const STAGE_LABEL: Record<PipelineStage, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

/** Contact moves only New. A sent quote moves New or Contacted. Acceptance wins an open lead. */
export function advanceLeadStage(status: LeadStatus, event: PipelineEvent): LeadStatus {
  if (status === "spam" || status === "lost" || status === "won") return status;
  switch (event) {
    case "contact_logged":
      return status === "new" ? "contacted" : status;
    case "quote_sent":
      return status === "new" || status === "contacted" ? "quoted" : status;
    case "quote_accepted":
      return "won";
    case "marked_lost":
      return "lost";
  }
}

export type RottingInput = {
  status: LeadStatus;
  stageEnteredAt: string | Date;
  now: Date;
  responseTargetMinutes: number;
};

/** New rots at the response target. Contacted rots after 3 days. Quoted rots after 7 days. */
export function leadIsRotting(input: RottingInput): boolean {
  if (input.status === "won" || input.status === "lost" || input.status === "spam") return false;
  const entered = typeof input.stageEnteredAt === "string" ? new Date(input.stageEnteredAt) : input.stageEnteredAt;
  const ageMs = input.now.getTime() - entered.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return false;
  if (input.status === "new") {
    const minutes = input.responseTargetMinutes > 0 ? input.responseTargetMinutes : 60;
    return ageMs >= minutes * 60_000;
  }
  if (input.status === "contacted") return ageMs >= 3 * 24 * 60 * 60 * 1000;
  if (input.status === "quoted") return ageMs >= 7 * 24 * 60 * 60 * 1000;
  return false;
}

export type PipelineCard = {
  id: string;
  name: string;
  status: PipelineStage;
  ownerName: string;
  lostReasonLabel: string | null;
  rotting: boolean;
};

export type PipelineColumn = {
  stage: PipelineStage;
  label: string;
  cards: PipelineCard[];
};

type PipelineLeadInput = {
  id: string;
  status: string;
  contact_name: string;
  assignee_name: string | null;
  lost_reason?: string | null;
  stage_entered_at?: string | null;
  created_at: string;
};

export function toPipelineCards(
  leads: readonly PipelineLeadInput[],
  now: Date,
  responseTargetMinutes: number,
): PipelineCard[] {
  const cards: PipelineCard[] = [];
  for (const lead of leads) {
    if (!(PIPELINE_STAGES as readonly string[]).includes(lead.status)) continue;
    const status = lead.status as PipelineStage;
    const reason = parseLeadLostReason(lead.lost_reason);
    const entered = lead.stage_entered_at || lead.created_at;
    cards.push({
      id: lead.id,
      name: lead.contact_name.trim() || "Untitled lead",
      status,
      ownerName: lead.assignee_name?.trim() || "Unassigned",
      lostReasonLabel: status === "lost" && reason ? LEAD_LOST_REASON_LABELS[reason] : null,
      rotting: leadIsRotting({
        status,
        stageEnteredAt: entered,
        now,
        responseTargetMinutes,
      }),
    });
  }
  return cards;
}

export function pipelineColumns(cards: readonly PipelineCard[]): PipelineColumn[] {
  return PIPELINE_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    cards: cards.filter((card) => card.status === stage),
  }));
}
