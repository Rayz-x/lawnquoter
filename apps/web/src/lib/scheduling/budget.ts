/**
 * Visit budget in minutes. Mirrors `convert_accepted_quote` /
 * `generate_agreement_visits`: round(sum(line hours) * 60 / crew_size).
 * Hours are the line totals already stored on the quote. Price and cost
 * are not inputs.
 */
export function budgetMinutes(hours: readonly number[], crewSize: number): number {
  if (!Number.isInteger(crewSize) || crewSize < 1) {
    throw new Error("crew_size must be an integer >= 1");
  }
  const totalHours = hours.reduce((sum, lineHours) => {
    if (!Number.isFinite(lineHours) || lineHours < 0) {
      throw new Error("hours must be a non-negative number");
    }
    return sum + lineHours;
  }, 0);
  return Math.round((totalHours * 60) / crewSize);
}
