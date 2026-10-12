import { defaultModifiers, mergeModifiers, modifiersSchema } from "@lawnquoter/pricing-engine";
import { describe, expect, it } from "vitest";
import { fieldsToModifiers, modifierExamples, modifiersToFields, modifierFieldsSchema } from "./modifier-fields";

describe("modifier fields", () => {
  it("turns engine modifiers into plain percent, dollar and minute values", () => {
    const fields = modifiersToFields(defaultModifiers());
    expect(fields).toMatchObject({
      minimumPrice: 45,
      minimumMinutes: 24,
      slopeOn: true,
      slopePct: { gentle: 5, moderate: 12, steep: 25 },
      slopeTimePct: { gentle: 8, moderate: 20, steep: 40 },
      gateOn: true,
      gateInches: 48,
      gatePrice: 8,
      gateMinutes: 9,
      firstCutOn: true,
      firstCutPct: 50,
      obstacleOn: true,
      obstaclePrice: 3,
      obstacleMinutes: 3,
      stairsOn: true,
      stairsPrice: 5,
      stairsMinutes: 6,
    });
  });

  it("round-trips back to the same engine modifiers", () => {
    const back = fieldsToModifiers(modifiersToFields(defaultModifiers()));
    expect(modifiersSchema.parse(back)).toEqual(modifiersSchema.parse(defaultModifiers()));
  });

  it("stores a switched-off modifier as zero so saved defaults can't bring it back", () => {
    const fields = { ...modifiersToFields(defaultModifiers()), slopeOn: false, firstCutOn: false, stairsOn: false };
    const mods = fieldsToModifiers(fields);
    expect(mods.slope?.steep).toEqual({ pricePct: 0, hoursPct: 0 });
    expect(mods.firstCut).toEqual({ multiplier: 1 });
    expect(mods.stairs).toEqual({ extraPrice: 0, extraHours: 0 });
    expect(mods.minimum).toEqual({ price: 45, hours: 0.4 });
    const again = modifiersToFields(mergeModifiers(mods));
    expect([again.slopeOn, again.firstCutOn, again.stairsOn]).toEqual([false, false, false]);
  });

  it("turns on stairs with a dollar amount and minutes", () => {
    const mods = fieldsToModifiers({ ...modifiersToFields(defaultModifiers()), stairsOn: true, stairsPrice: 10, stairsMinutes: 6 });
    expect(mods.stairs?.extraPrice).toBe(10);
    expect(mods.stairs).toEqual({ extraPrice: 10, extraHours: 0.1 });
  });

  it("rejects negative money and silly percentages", () => {
    const base = modifiersToFields(defaultModifiers());
    expect(modifierFieldsSchema.safeParse({ ...base, minimumPrice: -1 }).success).toBe(false);
    expect(modifierFieldsSchema.safeParse({ ...base, slopePct: { ...base.slopePct, steep: 500 } }).success).toBe(false);
    expect(modifierFieldsSchema.safeParse(base).success).toBe(true);
  });

  it("prices a far drive, a dense route, and summer from the same fields the form saves", () => {
    const fields = {
      ...modifiersToFields(defaultModifiers()),
      travelOn: true,
      farPrice: 25,
      densityOn: true,
      densityPct: 10,
      seasonOn: true,
      summerPct: 10,
    };
    const examples = modifierExamples(fieldsToModifiers(fields), 55);
    expect(examples.farDrive).toBe(80);
    expect(examples.denseRoute).toBe(49.5);
    expect(examples.summer).toBe(60.5);
  });

  it("explains each modifier with a worked example from the engine", () => {
    const examples = modifierExamples(defaultModifiers(), 55);
    expect(examples.steep).toBe(68.75);
    expect(examples.narrowGate).toBe(63);
    expect(examples.firstCut).toBe(82.5);
    expect(examples.small).toBe(45);
  });
});
