import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WISETACK_NOT_CONNECTED } from "@/lib/billing/wisetack";

export function WisetackCard() {
  const connected = Boolean(process.env.WISETACK_PREQUAL_URL?.trim());
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Wisetack financing</CardTitle>
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
