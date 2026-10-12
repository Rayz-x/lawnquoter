import { HelpTip } from "@/components/help/help-tip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WISETACK_NOT_CONNECTED } from "@/lib/billing/wisetack";

export function WisetackCard() {
  const connected = Boolean(process.env.WISETACK_PREQUAL_URL?.trim());
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          Wisetack financing
          <HelpTip
            label="Help for Wisetack"
            text="Financing stays off until its key is added. When it is on, proposals of $500 or more include the link."
            href="/help/integrations#wisetack"
          />
        </CardTitle>
        <CardDescription>A financing link on proposals of $500 or more.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {connected ? "Financing is on. Proposals of $500 or more include a financing link." : WISETACK_NOT_CONNECTED}
        </p>
      </CardContent>
    </Card>
  );
}
