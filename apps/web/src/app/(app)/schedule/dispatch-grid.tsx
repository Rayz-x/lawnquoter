"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FieldHint } from "@/components/entry";
import { assignVisit } from "@/lib/actions/scheduling";
import { shouldMoveVisit } from "@/lib/scheduling/dispatch-view";
import { formatOfficeDay } from "@/lib/scheduling/office-date";

export type GridVisit = {
  id: string;
  title: string;
  customer: string;
  status: string;
  crewId: string | null;
  date: string;
};

export function DispatchGrid({
  dates,
  crews,
  visits,
  canWrite,
}: {
  dates: string[];
  crews: { id: string; name: string }[];
  visits: GridVisit[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [over, setOver] = useState<string | null>(null);

  const move = (visitId: string, crewId: string, date: string) => {
    const visit = visits.find((item) => item.id === visitId);
    if (!visit || visit.status !== "scheduled") return;
    if (!shouldMoveVisit({ crewId: visit.crewId, date: visit.date }, { crewId, date })) return;
    startTransition(async () => {
      const result = await assignVisit({ visitId, crewId, date });
      if (result.ok) {
        toast.success("Stop moved");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FieldHint>Drag a scheduled stop onto another day or crew. Dropping it on the same cell leaves it put.</FieldHint>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] border-separate border-spacing-2 text-sm">
        <thead>
          <tr>
            <th className="w-32 text-left font-medium text-muted-foreground">Crew</th>
            {dates.map((date) => (
              <th key={date} className="text-left font-medium">
                {formatOfficeDay(date).replace(/, \d{4}$/, "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {crews.map((crew) => (
            <tr key={crew.id}>
              <th className="align-top text-left font-medium">{crew.name}</th>
              {dates.map((date) => {
                const key = `${crew.id}:${date}`;
                const cell = visits.filter((visit) => visit.crewId === crew.id && visit.date === date);
                return (
                  <td
                    key={key}
                    className={`min-h-16 align-top rounded-md border p-2 ${over === key ? "border-primary bg-primary/5" : ""}`}
                    onDragOver={(event) => {
                      if (!canWrite || pending) return;
                      event.preventDefault();
                      setOver(key);
                    }}
                    onDragLeave={() => setOver((current) => (current === key ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      setOver(null);
                      if (!canWrite || pending) return;
                      const visitId = event.dataTransfer.getData("text/plain");
                      if (visitId) move(visitId, crew.id, date);
                    }}
                  >
                    <ul className="flex flex-col gap-2">
                      {cell.length === 0 ? <li className="text-xs text-muted-foreground">Drop a stop</li> : null}
                      {cell.map((visit) => (
                        <li key={visit.id}>
                          <div
                            draggable={canWrite && visit.status === "scheduled" && !pending}
                            onDragStart={(event) => {
                              event.dataTransfer.setData("text/plain", visit.id);
                              event.dataTransfer.effectAllowed = "move";
                            }}
                            className="rounded-md border bg-card p-2"
                          >
                            <div className="font-medium">{visit.title}</div>
                            <div className="text-muted-foreground">{visit.customer}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}
