export type CostingInput = {
  service: string;
  crew: string;
  customer: string;
  estimatedHours: number;
  estimatedCostCents: number;
  actualMinutes: number;
  crewSize: number;
  revenueCents: number;
  hourlyRate: number;
  burdenPct: number;
};

export type CostingRow = {
  label: string;
  estimatedHours: number;
  actualHours: number;
  manHours: number;
  estimatedCostCents: number;
  actualCostCents: number;
  revenueCents: number;
  dollarsPerManHour: number | null;
  marginCents: number;
};

function hours(minutes: number): number {
  return minutes / 60;
}

export function costVisit(input: CostingInput): CostingRow {
  const actualHours = hours(Math.max(0, input.actualMinutes));
  const crewSize = input.crewSize > 0 ? input.crewSize : 1;
  const manHours = actualHours * crewSize;
  const burden = 1 + Math.max(0, input.burdenPct) / 100;
  const actualCostCents = Math.round(manHours * Math.max(0, input.hourlyRate) * burden * 100);
  const revenueCents = Math.max(0, Math.round(input.revenueCents));
  return {
    label: input.service,
    estimatedHours: Math.max(0, input.estimatedHours),
    actualHours,
    manHours,
    estimatedCostCents: Math.max(0, Math.round(input.estimatedCostCents)),
    actualCostCents,
    revenueCents,
    dollarsPerManHour: manHours > 0 ? revenueCents / 100 / manHours : null,
    marginCents: revenueCents - actualCostCents,
  };
}

export function groupCosting(inputs: CostingInput[], labelOf: (input: CostingInput) => string): CostingRow[] {
  const groups = new Map<string, CostingInput[]>();
  for (const input of inputs) {
    const label = labelOf(input) || "Unassigned";
    groups.set(label, [...(groups.get(label) ?? []), input]);
  }
  return [...groups.entries()]
    .map(([label, rows]) => {
      const summed = rows.reduce(
        (total, row) => ({
          estimatedHours: total.estimatedHours + Math.max(0, row.estimatedHours),
          estimatedCostCents: total.estimatedCostCents + Math.max(0, row.estimatedCostCents),
          actualMinutes: total.actualMinutes + Math.max(0, row.actualMinutes),
          revenueCents: total.revenueCents + Math.max(0, row.revenueCents),
          manHours:
            total.manHours +
            hours(Math.max(0, row.actualMinutes)) * (row.crewSize > 0 ? row.crewSize : 1),
          actualCostCents: total.actualCostCents + costVisit(row).actualCostCents,
        }),
        {
          estimatedHours: 0,
          estimatedCostCents: 0,
          actualMinutes: 0,
          revenueCents: 0,
          manHours: 0,
          actualCostCents: 0,
        },
      );
      return {
        label,
        estimatedHours: summed.estimatedHours,
        actualHours: hours(summed.actualMinutes),
        manHours: summed.manHours,
        estimatedCostCents: Math.round(summed.estimatedCostCents),
        actualCostCents: summed.actualCostCents,
        revenueCents: Math.round(summed.revenueCents),
        dollarsPerManHour: summed.manHours > 0 ? summed.revenueCents / 100 / summed.manHours : null,
        marginCents: Math.round(summed.revenueCents) - summed.actualCostCents,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}
