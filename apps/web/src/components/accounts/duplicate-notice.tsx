import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AccountDuplicate } from "@/lib/accounts/duplicates";

export function AccountDuplicateNotice({ matches }: { matches: AccountDuplicate[] }) {
  if (!matches.length) return null;
  return (
    <Alert data-testid="account-duplicate-notice" className="border-amber-500/40 bg-amber-500/5">
      <AlertTitle>Possible duplicate</AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-1">
          {matches.map((match) => (
            <li key={match.accountId}>
              <Link href={`/accounts/${match.accountId}`} className="underline">
                {match.detail}
              </Link>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
