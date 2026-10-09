export const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const roundHours = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function line(price: number, hours: number, cost: number) {
  return { price: roundMoney(price), hours: roundHours(hours), cost: roundMoney(cost) };
}
