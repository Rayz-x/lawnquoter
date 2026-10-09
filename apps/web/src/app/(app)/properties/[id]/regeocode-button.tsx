"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { regeocodeProperty } from "../../accounts/actions";

export function RegeocodeButton({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await regeocodeProperty(propertyId);
          if (r.ok) {
            toast.success("Geometry refreshed");
            r.data.warnings.forEach((w) => toast.warning(w));
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
      Refresh parcel
    </Button>
  );
}
