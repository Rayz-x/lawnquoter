import "server-only";

import { redirect } from "next/navigation";
import { resumeOnboarding } from "./wizard";

/** Sends an unfinished company back to setup. A failed company read does the same. */
export function redirectIfOnboardingOpen(settings: unknown, readable: boolean) {
  if (!readable || resumeOnboarding({ hasOrg: true, settings }) !== "done") redirect("/onboarding");
}
