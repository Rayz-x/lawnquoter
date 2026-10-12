"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { addSiteWalkNote } from "@/app/(app)/bids/actions";

type PackageOption = { id: string; title: string };

export function WalkForm({ packages }: { packages: PackageOption[] }) {
  const [body, setBody] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [message, setMessage] = useState("");

  function locate() {
    if (!navigator.geolocation) {
      setMessage("This phone has no location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(String(position.coords.latitude));
        setLng(String(position.coords.longitude));
      },
      () => setMessage("Location was not available."),
    );
  }

  function dictate() {
    const speech = (window as Window & { webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition
      ?? (window as Window & { SpeechRecognition?: new () => SpeechRecognition }).SpeechRecognition;
    if (!speech) {
      setMessage("This browser has no speech recognition. Type the note.");
      return;
    }
    const recognition = new speech();
    recognition.onresult = (event) => {
      const said = event.results[0]?.[0]?.transcript ?? "";
      setBody((current) => (current ? `${current} ${said}` : said));
    };
    recognition.start();
  }

  return (
    <form action={addSiteWalkNote} className="flex flex-col gap-3">
      <label className="grid gap-1 text-sm">
        Package
        <select name="package_id" required className="h-12 rounded-md border bg-background px-2 text-base">
          {packages.map((pkg) => (
            <option key={pkg.id} value={pkg.id}>
              {pkg.title}
            </option>
          ))}
        </select>
      </label>
      <textarea
        name="body"
        required
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        placeholder="What did you see?"
        className="rounded-md border bg-background px-3 py-2 text-base"
      />
      <input type="hidden" name="lat" value={lat} />
      <input type="hidden" name="lng" value={lng} />
      <p className="text-sm text-muted-foreground">{lat && lng ? `${lat}, ${lng}` : "No pin yet."}</p>
      {message ? <p className="text-sm">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={locate}>
          Drop pin
        </Button>
        <Button type="button" variant="outline" onClick={dictate}>
          Dictate
        </Button>
        <Button type="submit">Save note</Button>
      </div>
    </form>
  );
}

type SpeechRecognition = {
  start: () => void;
  onresult: ((event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => void) | null;
};
