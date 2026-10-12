"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createService } from "./actions";

export function ServiceForm({ onCreated }: { onCreated?: (id: string) => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        startTransition(async () => {
          const r = await createService(fd);
          if (r.ok) {
            toast.success("Service added");
            form.reset();
            onCreated?.(r.data.id);
          } else toast.error(r.error);
        });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="svc_name">Name</FieldLabel>
          <Input id="svc_name" name="name" aria-describedby="svc-name-hint" required placeholder="Weekly mow" />
          <FieldHint id="svc-name-hint">The service name customers see on a quote.</FieldHint>
        </Field>
        <Field>
          <FieldLabel htmlFor="svc_kind">Category</FieldLabel>
          <select id="svc_kind" name="kind" aria-describedby="svc-kind-hint" className="native-control" defaultValue="mowing">
            <option value="mowing">Mowing</option>
            <option value="fert">Fert / weed</option>
            <option value="cleanup">Cleanup</option>
            <option value="snow">Snow</option>
            <option value="irrigation">Irrigation</option>
            <option value="install">Install / design-build</option>
            <option value="other">Other</option>
          </select>
          <FieldHint id="svc-kind-hint">Groups this service with similar work on quotes.</FieldHint>
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Create service
      </Button>
    </form>
  );
}
