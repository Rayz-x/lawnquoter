"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CATALOG_CATEGORIES, CATALOG_SEED_V1, CATALOG_VERSION } from "@lawnquoter/pricing-engine";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatMoney } from "@/lib/money";
import { activateCatalogDraft, installCatalogServices } from "./catalog-actions";

export const BENCHMARK_NOTICE =
  "Starter prices are national planning benchmarks from published cost guides, not your market. Review every price before you activate.";

/** Owner picks catalog services; they land in a draft price list. */
export function AddFromCatalog({ installedKeys }: { installedKeys: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [showSnow, setShowSnow] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const installed = useMemo(() => new Set(installedKeys), [installedKeys]);
  const visible = CATALOG_SEED_V1.filter((entry) => showSnow || entry.category !== "Snow");
  const count = Object.keys(picked).length;

  function toggle(key: string, typical: number, on: boolean) {
    setPicked((prev) => {
      const next = { ...prev };
      if (on) next[key] = String(typical);
      else delete next[key];
      return next;
    });
  }

  function submit() {
    const selections = Object.entries(picked).map(([key, price]) => ({ key, price: Number(price) }));
    startTransition(async () => {
      const result = await installCatalogServices(selections);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Added ${result.data.installed} service${result.data.installed === 1 ? "" : "s"} to your draft price list`);
      setPicked({});
      setOpen(false);
      router.push("/settings/pricing?list=draft");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>Add from catalog</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add from catalog</DialogTitle>
          <DialogDescription>{BENCHMARK_NOTICE}</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showSnow} onCheckedChange={setShowSnow} />
          I offer snow services
        </label>
        {CATALOG_CATEGORIES.map((category) => {
          const entries = visible.filter((entry) => entry.category === category);
          if (entries.length === 0) return null;
          return (
            <section key={category} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{category}</h3>
              {entries.map((entry) => {
                const already = installed.has(entry.key);
                const on = entry.key in picked;
                return (
                  <div key={entry.key} className="grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-md border p-3 text-sm">
                    <Checkbox
                      aria-label={entry.name}
                      checked={on || already}
                      disabled={already || pending}
                      onCheckedChange={(value) => toggle(entry.key, entry.starter.typical, Boolean(value))}
                    />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {entry.name}
                        {already ? <span className="ml-2 text-xs text-muted-foreground">Already added</span> : null}
                      </p>
                      <p className="text-muted-foreground">{entry.unitLabel}{entry.recurring ? " · recurring" : " · one-time"}{entry.isMaterial ? " · material, ask your CPA about tax" : ""}</p>
                      <p className="text-xs text-muted-foreground">
                        Range {formatMoney(entry.starter.low)}–{formatMoney(entry.starter.high)} ·{" "}
                        <a className="underline" href={entry.source.url} target="_blank" rel="noreferrer">{entry.source.label}</a>
                      </p>
                    </div>
                    <Input
                      aria-label={`${entry.name} price`}
                      className="w-24"
                      type="number"
                      min={0.01}
                      step="0.01"
                      inputMode="decimal"
                      disabled={!on || pending}
                      value={on ? picked[entry.key] : String(entry.starter.typical)}
                      onChange={(event) => setPicked((prev) => ({ ...prev, [entry.key]: event.target.value }))}
                    />
                  </div>
                );
              })}
            </section>
          );
        })}
        <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-background pt-3">
          <p className="text-xs text-muted-foreground">Catalog {CATALOG_VERSION}. Cost and hours start at 0, so set your cost.</p>
          <Button type="button" disabled={pending || count === 0} onClick={submit}>
            Add {count || ""} to draft
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Shown while a draft price list exists. Nothing quotes from it until activated. */
export function CatalogDraftBanner({
  draftId,
  ruleCount,
  starterCount,
  viewingDraft,
  canEdit,
}: {
  draftId: string;
  ruleCount: number;
  starterCount: number;
  viewingDraft: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warning/10 p-4 text-sm ring-1 ring-warning/30" role="status">
      <div>
        <p className="font-medium">
          Draft price list · {ruleCount} service{ruleCount === 1 ? "" : "s"}
          {starterCount > 0 ? ` · ${starterCount} still at starter prices` : ""}
        </p>
        <p className="text-muted-foreground">Customers are not quoted from the draft until you activate it. {BENCHMARK_NOTICE}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" render={<Link href={viewingDraft ? "/settings/pricing" : "/settings/pricing?list=draft"} />}>
          {viewingDraft ? "Back to active prices" : "Review draft prices"}
        </Button>
        {canEdit ? (
          <AlertDialog>
            <AlertDialogTrigger render={<Button disabled={pending} />}>Activate price list</AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Activate this price list?</AlertDialogTitle>
                <AlertDialogDescription>
                  {starterCount > 0
                    ? `${starterCount} service${starterCount === 1 ? " is" : "s are"} still at starter prices. `
                    : ""}
                  New quotes will use these prices. Services already priced in your current list keep their prices.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    startTransition(async () => {
                      const result = await activateCatalogDraft(draftId);
                      if (!result.ok) {
                        toast.error(result.error);
                        return;
                      }
                      toast.success("Price list activated");
                      router.push("/settings/pricing");
                      router.refresh();
                    })
                  }
                >
                  Activate
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </div>
  );
}
