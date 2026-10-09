"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [linkSent, setLinkSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const signInWithPassword = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        return;
      }
      router.replace(next);
      router.refresh();
    });
  };

  const sendMagicLink = () => {
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (error) {
        setError(error.message);
        return;
      }
      setLinkSent(true);
      toast.success("Check your email for a sign-in link.");
    });
  };

  return (
    <form onSubmit={signInWithPassword} className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FieldDescription>Leave blank to use a one-time link instead.</FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending || !password}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Sign in
        </Button>
        <Button type="button" variant="outline" disabled={pending || linkSent} onClick={sendMagicLink}>
          {linkSent ? "Link sent" : "Email me a sign-in link"}
        </Button>
      </div>
    </form>
  );
}
