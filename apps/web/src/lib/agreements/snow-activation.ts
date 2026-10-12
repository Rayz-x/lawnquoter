/** A snow agreement is activated when the snowfall meets its trigger depth. */
export function snowActivates(triggerIn: number, inches: number): boolean {
  if (!Number.isFinite(triggerIn) || triggerIn < 0) return false;
  if (!Number.isFinite(inches) || inches < 0) return false;
  return inches >= triggerIn;
}
