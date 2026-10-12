import { describe, expect, it } from "vitest";
import { weatherAction, type WeatherRule } from "./weather-rules";

const clear = { rainIn: 0, snowIn: 0, windMph: 5, tempF: 60 };

const rainSkip: WeatherRule = { condition: "rain", threshold: 0.1, action: "skip", enabled: true };
const snowPush: WeatherRule = { condition: "snow", threshold: 2, action: "push", enabled: true };

describe("weather skip rules", () => {
  it("skips when rain meets the threshold", () => {
    expect(weatherAction([rainSkip], { ...clear, rainIn: 0.25 })).toBe("skip");
  });

  it("lets rain win when snow also matches", () => {
    expect(weatherAction([snowPush, rainSkip], { rainIn: 0.25, snowIn: 3, windMph: 5, tempF: 60 })).toBe("skip");
  });

  it("pushes when snow meets the threshold and rain does not", () => {
    expect(weatherAction([rainSkip, snowPush], { ...clear, snowIn: 3 })).toBe("push");
  });

  it("changes nothing under every threshold", () => {
    expect(weatherAction([rainSkip, snowPush], clear)).toBeNull();
  });
});
