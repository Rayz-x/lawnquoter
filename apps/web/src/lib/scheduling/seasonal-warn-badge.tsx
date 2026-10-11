import { Badge } from "@/components/ui/badge";
import { isSeasonalWarnRed, seasonalWarnBadgeLabel, type SeasonalWarnState } from "./seasonal-window";

export function SeasonalWarnBadge({
  state,
  warn,
}: {
  state?: SeasonalWarnState | null;
  warn?: boolean;
}) {
  const red = warn === true || (state != null && isSeasonalWarnRed(state));
  if (!red) return null;
  const label = state ? seasonalWarnBadgeLabel(state) : "Past warn date";
  if (!label) return null;
  return (
    <Badge variant="destructive" data-testid="seasonal-warn-badge">
      {label}
    </Badge>
  );
}
