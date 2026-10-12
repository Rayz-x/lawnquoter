import { describe, expect, it } from "vitest";
import { chemicalLog } from "./chemical-log";

const weather = { tempF: 72, windMph: 4, conditions: "Clear" };

describe("chemical application log", () => {
  it("keeps product, rate, EPA number, and weather", () => {
    expect(
      chemicalLog({ product: "  Trimec  ", rate: "1.5 oz / 1000 sq ft", epaRegNo: "2217-543", ...weather }),
    ).toEqual({
      ok: true,
      log: {
        product: "Trimec",
        rate: "1.5 oz / 1000 sq ft",
        epaRegNo: "2217-543",
        tempF: 72,
        windMph: 4,
        conditions: "Clear",
      },
    });
  });

  it("refuses a log without an EPA registration number", () => {
    expect(chemicalLog({ product: "Trimec", rate: "1.5 oz", epaRegNo: "  ", ...weather })).toEqual({
      ok: false,
      error: "Product, rate, and EPA registration number are required",
    });
  });

  it("names a weather-number failure separately from a missing EPA number", () => {
    expect(chemicalLog({ product: "Trimec", rate: "1.5 oz", epaRegNo: "2217-543", tempF: 200, windMph: 4, conditions: "Clear" })).toEqual({
      ok: false,
      error: "Temperature must be between -40 and 130 °F, and wind between 0 and 100 mph",
    });
  });
});
