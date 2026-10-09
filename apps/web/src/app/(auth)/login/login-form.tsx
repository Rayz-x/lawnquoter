"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [linkSent, setLinkSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const emailError = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "Enter your email.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Enter a valid email address.";
    return undefined;
  };

  const signInWithPassword = (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors = {
      email: emailError(email),
      password: password ? undefined : "Enter your password.",
    };
    setFieldErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) return;
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setError(error.message);
        return;
      }
      router.replace(next);
      router.refresh();
    });
  };

  const signUp = () => {
    if (!email || !password) {
      setError("Enter an email and password to create an account.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (error) {
        setError(error.message);
        return;
      }
      toast.success("Account created. If email confirmation is on, check your inbox; otherwise sign in.");
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
    <form noValidate onSubmit={signInWithPassword} className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field data-invalid={fieldErrors.email ? true : undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined }));
            }}
          />
          {fieldErrors.email ? <FieldError id="email-error">{fieldErrors.email}</FieldError> : null}
        </Field>
        <Field data-invalid={fieldErrors.password ? true : undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? "password-error password-hint" : "password-hint"}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined }));
            }}
          />
          <FieldDescription id="password-hint">Leave blank to use a one-time link instead.</FieldDescription>
          {fieldErrors.password ? <FieldError id="password-error">{fieldErrors.password}</FieldError> : null}
        </Field>
      </FieldGroup>
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Sign in
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={signUp}>
          Create account
        </Button>
        <Button type="button" variant="outline" disabled={pending || linkSent} onClick={sendMagicLink}>
          {linkSent ? "Link sent" : "Email me a sign-in link"}
        </Button>
      </div>
    </form>
  );
}
