"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { ensureStatementLink } from "./actions";

export function StatementLinkForm({
  accounts,
  from,
  to,
  appOrigin,
}: {
  accounts: { id: string; name: string }[];
  from: string;
  to: string;
  appOrigin: string;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (accounts.length === 0) {
    return <p className="text-sm text-muted-foreground">Add an account to mint a statement link.</p>;
  }

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await ensureStatementLink(accountId);
            if (!result.ok) {
              setError(result.error);
              setUrl(null);
              return;
            }
            const next = new URL(`/s/${result.data.token}`, appOrigin);
            next.searchParams.set("from", from);
            next.searchParams.set("to", to);
            setUrl(next.toString());
          });
        }}
      >
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Account</span>
          <NativeSelect
            name="accountId"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            className="w-auto min-w-48"
            aria-label="Account for statement"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" variant="outline" disabled={pending || !accountId}>
          {pending ? "Creating…" : "Statement link"}
        </Button>
      </form>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {url ? (
        <p className="break-all text-sm">
          <a href={url} className="font-medium underline" target="_blank" rel="noreferrer">
            {url}
          </a>
        </p>
      ) : null}
    </div>
  );
}
