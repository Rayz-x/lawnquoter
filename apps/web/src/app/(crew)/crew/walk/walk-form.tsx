"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { WalkMap } from "@/components/bids/walk-map";
import { addSiteWalkNote } from "@/app/(app)/bids/actions";
import { downscalePhoto } from "@/lib/crew/photo";
import { walkPins } from "@/lib/bids/walk";

type PackageOption = { id: string; title: string };
type SavedNote = { id: string; package_id: string; body: string; lat: number | null; lng: number | null };

export function WalkForm({ packages, notes }: { packages: PackageOption[]; notes: SavedNote[] }) {
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "");
  const [body, setBody] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    const file = (event.currentTarget.elements.namedItem("photo") as HTMLInputElement | null)?.files?.[0];
    if (!file || file.size === 0) return;
    event.preventDefault();
    if (!lat || !lng) {
      setMessage("Drop a pin so the photo is on the map.");
      return;
    }
    try {
      const jpeg = await downscalePhoto(file);
      const data = new FormData(event.currentTarget);
      data.set("photo", new File([jpeg], "walk.jpg", { type: "image/jpeg" }));
      await addSiteWalkNote(data);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not save that photo.");
    }
  }

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
    recognition.onerror = () => setMessage("This browser has no speech recognition. Type the note.");
    recognition.start();
  }

  return (
    <form action={addSiteWalkNote} onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="grid gap-1 text-sm">
        Package
        <select
          name="package_id"
          required
          value={packageId}
          onChange={(event) => setPackageId(event.target.value)}
          className="h-12 rounded-md border bg-background px-2 text-base"
        >
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
      <label className="grid gap-1 text-sm">
        Photo
        <input name="photo" type="file" accept="image/*" capture="environment" className="text-base" />
      </label>
      <p className="text-sm text-muted-foreground">{lat && lng ? `${lat}, ${lng}` : "No pin yet."}</p>
      <WalkMap
        pins={walkPins([
          ...notes.filter((note) => note.package_id === packageId),
          ...(lat && lng ? [{ id: "draft", body: body || "This note", lat: Number(lat), lng: Number(lng) }] : []),
        ])}
      />
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
  onerror: (() => void) | null;
};
