import { Badge } from "@/components/ui/badge";
import { leadAgeMinutes, leadAgeTone, type LeadAgeTone } from "./age-badge";

const TONE_CLASS: Record<LeadAgeTone, string> = {
  ok: "border-border text-muted-foreground",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  red: "border-destructive/40 bg-destructive/10 text-destructive",
};

function formatAge(minutes: number): string {
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rem = Math.floor(minutes % 60);
  if (hours < 48) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function LeadAgeBadge({
  createdAt,
  targetMinutes,
  now,
}: {
  createdAt: string;
  targetMinutes: number;
  now?: Date;
}) {
  const age = leadAgeMinutes(createdAt, now);
  const tone = leadAgeTone(age, targetMinutes);
  return (
    <Badge variant="outline" className={TONE_CLASS[tone]} data-tone={tone}>
      {formatAge(age)}
    </Badge>
  );
}
