"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ChipGroup } from "@/components/entry";
import { applyWeather, saveWeatherRule } from "@/lib/actions/weather";
import { isWeatherAction, isWeatherCondition, weatherAction, type WeatherRule } from "@/lib/scheduling/weather-rules";

export function WeatherCard({ date, rules }: { date: string; rules: WeatherRule[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [condition, setCondition] = useState("rain");
  const [action, setAction] = useState("skip");
  const [threshold, setThreshold] = useState("0.1");
  const [rain, setRain] = useState("0");
  const [snow, setSnow] = useState("0");
  const [wind, setWind] = useState("0");
  const [temp, setTemp] = useState("60");

  const reading = { rainIn: Number(rain), snowIn: Number(snow), windMph: Number(wind), tempF: Number(temp) };
  const preview = weatherAction(rules, reading);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weather</CardTitle>
        <CardDescription>
          {rules.length === 0
            ? "No weather rules yet."
            : rules.map((rule) => `${rule.condition} ${rule.threshold} → ${rule.action}`).join(" · ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ChipGroup
          label="Condition"
          options={[
            { value: "rain", label: "Rain" },
            { value: "snow", label: "Snow" },
            { value: "wind", label: "Wind" },
            { value: "freeze", label: "Freeze" },
          ]}
          value={condition}
          onValueChange={setCondition}
        />
        <ChipGroup
          label="Action"
          options={[
            { value: "skip", label: "Skip" },
            { value: "push", label: "Push" },
          ]}
          value={action}
          onValueChange={setAction}
        />
        <Input aria-label="Threshold" inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} className="w-32" />
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (!isWeatherCondition(condition) || !isWeatherAction(action)) return;
            startTransition(async () => {
              const result = await saveWeatherRule({ condition, action, threshold: Number(threshold) });
              if (result.ok) {
                toast.success("Weather rule saved");
                router.refresh();
              } else toast.error(result.error);
            });
          }}
        >
          Save rule
        </Button>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Rain inches" value={rain} onChange={(event) => setRain(event.target.value)} className="w-24" />
          <Input aria-label="Snow inches" value={snow} onChange={(event) => setSnow(event.target.value)} className="w-24" />
          <Input aria-label="Wind mph" value={wind} onChange={(event) => setWind(event.target.value)} className="w-24" />
          <Input aria-label="Temperature" value={temp} onChange={(event) => setTemp(event.target.value)} className="w-24" />
        </div>
        <Button
          type="button"
          disabled={pending || preview == null}
          onClick={() => {
            startTransition(async () => {
              const result = await applyWeather({
                serviceDate: date,
                rainIn: reading.rainIn,
                snowIn: reading.snowIn,
                windMph: reading.windMph,
                tempF: reading.tempF,
              });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              const verb = result.data.action === "push" ? "Pushed" : result.data.action === "skip" ? "Skipped" : "Left";
              toast.success(`${verb} ${result.data.affected} stops`);
              router.refresh();
            });
          }}
        >
          {preview === "skip" ? "Skip this day" : preview === "push" ? "Push this day" : "No rule matches"}
        </Button>
      </CardContent>
    </Card>
  );
}
