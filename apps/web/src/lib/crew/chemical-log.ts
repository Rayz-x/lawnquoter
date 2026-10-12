export type ChemicalLog = {
  product: string;
  rate: string;
  epaRegNo: string;
  tempF: number;
  windMph: number;
  conditions: string;
};

export type ChemicalLogResult = { ok: true; log: ChemicalLog } | { ok: false; error: string };

const REQUIRED = "Product, rate, and EPA registration number are required";
const WEATHER = "Temperature must be between -40 and 130 °F, and wind between 0 and 100 mph";

/** A log needs a product, a rate, an EPA registration number, and weather numbers in range. */
export function chemicalLog(input: ChemicalLog): ChemicalLogResult {
  const product = input.product.trim();
  const rate = input.rate.trim();
  const epaRegNo = input.epaRegNo.trim();
  const conditions = input.conditions.trim();
  if (!product || !rate || !epaRegNo) return { ok: false, error: REQUIRED };
  if (product.length > 120 || rate.length > 40 || epaRegNo.length > 40 || conditions.length > 80) {
    return { ok: false, error: "Keep product, rate, EPA number, and weather notes shorter" };
  }
  if (!Number.isFinite(input.tempF) || input.tempF < -40 || input.tempF > 130) return { ok: false, error: WEATHER };
  if (!Number.isFinite(input.windMph) || input.windMph < 0 || input.windMph > 100) return { ok: false, error: WEATHER };
  return { ok: true, log: { product, rate, epaRegNo, tempF: input.tempF, windMph: input.windMph, conditions } };
}
