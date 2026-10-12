import { FieldHint } from "@/components/entry";
import { BatterySaverSettings } from "@/components/crew/battery-saver-settings";
import { CrewSignOut } from "@/components/crew/sign-out";
import { StorageSettings } from "@/components/crew/storage-settings";

export default function CrewMePage() {
  return (
    <section className="flex flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top,0px))]">
      <h1 className="text-2xl font-bold">Me</h1>
      <p className="text-[15px] text-muted-foreground">Install LawnQuoter Crew from the browser menu to keep the route on this phone.</p>
      <BatterySaverSettings />
      <StorageSettings />
      <span className="flex min-w-0 flex-col gap-1">
        <a href="/crew/walk" className="inline-flex min-h-12 items-center text-[17px] font-semibold text-primary">
          Site walk
        </a>
        <FieldHint>Opens the walk form so you can pin notes and photos on a bid.</FieldHint>
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <a href="/dashboard" className="inline-flex min-h-12 items-center text-[17px] font-semibold text-primary">
          Office
        </a>
        <FieldHint>Leaves the crew app and opens the office.</FieldHint>
      </span>
      <CrewSignOut />
    </section>
  );
}
