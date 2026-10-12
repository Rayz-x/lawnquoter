export type IrrigationZoneNote = {
  zone: number;
  note: string;
};

export type IrrigationZoneNoteResult = { ok: true; note: IrrigationZoneNote } | { ok: false; error: string };

/** A zone note names one zone and what the crew found there. */
export function irrigationZoneNote(input: { zone: number; note: string }): IrrigationZoneNoteResult {
  const note = input.note.trim();
  if (!Number.isInteger(input.zone) || input.zone < 1 || input.zone > 64) {
    return { ok: false, error: "Zone has to be a number from 1 to 64" };
  }
  if (!note) return { ok: false, error: "A zone note is required" };
  if (note.length > 500) return { ok: false, error: "Keep the zone note under 500 characters" };
  return { ok: true, note: { zone: input.zone, note } };
}
