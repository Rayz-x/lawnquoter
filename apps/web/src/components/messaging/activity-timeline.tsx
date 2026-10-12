import type { TimelineEntry } from "@/lib/messaging/timeline";

export function ActivityTimeline({
  entries,
  emptyLabel = "No activity yet.",
  testId,
}: {
  entries: TimelineEntry[];
  emptyLabel?: string;
  testId?: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid={testId ? `${testId}-empty` : undefined}>
        {emptyLabel}
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3" data-testid={testId}>
      {entries.map((entry) => (
        <li key={entry.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{entry.label}</p>
            <time className="text-xs text-muted-foreground" dateTime={entry.at}>
              {new Date(entry.at).toLocaleString()}
            </time>
          </div>
          <p className="text-sm">{entry.summary}</p>
          {entry.recordingUrl ? (
            <a href={entry.recordingUrl} className="text-sm underline" target="_blank" rel="noreferrer">
              Recording
            </a>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
