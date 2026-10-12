import { notFound } from "next/navigation";
import { e2eEnabled } from "@/lib/e2e/gate";
import { E2eFlow } from "./e2e-flow";

export default function E2ePage() {
  if (!e2eEnabled()) notFound();
  return <E2eFlow />;
}
