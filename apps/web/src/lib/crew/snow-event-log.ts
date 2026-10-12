export type SnowEventLog = {
  triggerIn: number;
  startedAt: string;
  endedAt: string;
  materials: string;
  minutes: number;
};

export type SnowEventLogResult = { ok: true; log: SnowEventLog } | { ok: false; error: string };

/** A snow log needs a trigger depth, a start, an end, and the materials used. */
export function snowEventLog(input: {
  triggerIn: number;
  startedAt: string;
  endedAt: string;
  materials: string;
}): SnowEventLogResult {
  const materials = input.materials.trim();
  const started = Date.parse(input.startedAt);
  const ended = Date.parse(input.endedAt);
  if (!Number.isFinite(input.triggerIn) || input.triggerIn < 0 || input.triggerIn > 48) {
    return { ok: false, error: "Trigger depth has to be between 0 and 48 inches" };
  }
  if (!materials || materials.length > 200) {
    return { ok: false, error: "Materials are required" };
  }
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) {
    return { ok: false, error: "The snow event has to end after it starts" };
  }
  return {
    ok: true,
    log: {
      triggerIn: input.triggerIn,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      materials,
      minutes: Math.round((ended - started) / 60000),
    },
  };
}
