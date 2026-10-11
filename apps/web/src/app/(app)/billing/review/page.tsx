import type { Metadata } from "next";
import { hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CUSTOMER_EDIT_ROLES, OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { parseBillingReviewQueue } from "@/lib/billing/review-queue";
import { createClient } from "@/lib/supabase/server";
import { ReviewQueuePanel } from "./review-queue-panel";

export const metadata: Metadata = { title: "Billing review" };

export default async function BillingReviewPage() {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Billing review" description="Held visits waiting on office choices" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>
              Billing review stays in the office. Crews never see hold amounts.
            </AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("office_billing_review_queue");
  const queue = parseBillingReviewQueue(data);
  const canWrite = hasRole(session.orgRole, CUSTOMER_EDIT_ROLES);

  return (
    <>
      <PageHeader
        title="Billing review"
        description="Partly done, completed-after-cancel, photo lost, and upsell holds"
      />
      <div className="page-body space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load the queue</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : null}
        <ReviewQueuePanel queue={queue} canWrite={canWrite} />
      </div>
    </>
  );
}
