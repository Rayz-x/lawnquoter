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
      <a href="/dashboard" className="inline-flex min-h-12 items-center text-[17px] font-semibold text-primary">
        Office
      </a>
      <CrewSignOut />
    </section>
  );
}
