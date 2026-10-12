export const WEATHER_CONDITIONS = ["rain", "snow", "wind", "freeze"] as const;
export const WEATHER_ACTIONS = ["skip", "push"] as const;

export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];
export type WeatherAction = (typeof WEATHER_ACTIONS)[number];

export type WeatherRule = {
  condition: WeatherCondition;
  threshold: number;
  action: WeatherAction;
  enabled: boolean;
};

export type WeatherReading = {
  rainIn: number;
  snowIn: number;
  windMph: number;
  tempF: number;
};

const ORDER: Record<WeatherCondition, number> = { rain: 0, snow: 1, wind: 2, freeze: 3 };

export function isWeatherCondition(value: string): value is WeatherCondition {
  return (WEATHER_CONDITIONS as readonly string[]).includes(value);
}

export function isWeatherAction(value: string): value is WeatherAction {
  return (WEATHER_ACTIONS as readonly string[]).includes(value);
}

function matches(rule: WeatherRule, reading: WeatherReading): boolean {
  if (!rule.enabled) return false;
  if (rule.condition === "rain") return reading.rainIn >= rule.threshold;
  if (rule.condition === "snow") return reading.snowIn >= rule.threshold;
  if (rule.condition === "wind") return reading.windMph >= rule.threshold;
  return reading.tempF <= rule.threshold;
}

/** First matching rule in rain, snow, wind, freeze order. Skip and push do not combine. */
export function weatherAction(rules: WeatherRule[], reading: WeatherReading): WeatherAction | null {
  const ordered = [...rules].sort((a, b) => ORDER[a.condition] - ORDER[b.condition]);
  return ordered.find((rule) => matches(rule, reading))?.action ?? null;
}
