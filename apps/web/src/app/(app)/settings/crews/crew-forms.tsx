"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { addCrewMember, createCrew } from "@/lib/actions/scheduling";

export function CreateCrewForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await createCrew(name);
          if (result.ok) {
            toast.success("Crew created");
            setName("");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <Field>
        <FieldLabel htmlFor="crew-name">Crew name</FieldLabel>
        <Input
          id="crew-name"
          name="name"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Button type="submit" disabled={pending || name.trim().length === 0}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Create crew
      </Button>
    </form>
  );
}

export function AddCrewMemberForm({
  crews,
  people,
}: {
  crews: { id: string; name: string; memberIds: string[] }[];
  people: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [crewId, setCrewId] = useState(crews[0]?.id ?? "");
  const [profileId, setProfileId] = useState("");
  const [pending, startTransition] = useTransition();
  const available = useMemo(() => {
    const crew = crews.find((item) => item.id === crewId);
    const taken = new Set(crew?.memberIds ?? []);
    return people.filter((person) => !taken.has(person.id));
  }, [crewId, crews, people]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const chosen = profileId || available[0]?.id;
        if (!crewId || !chosen) return;
        startTransition(async () => {
          const result = await addCrewMember(crewId, chosen);
          if (result.ok) {
            toast.success("Member added");
            setProfileId("");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="member-crew">Crew</FieldLabel>
          <NativeSelect
            id="member-crew"
            value={crewId}
            onChange={(event) => {
              setCrewId(event.target.value);
              setProfileId("");
            }}
          >
            {crews.map((crew) => (
              <option key={crew.id} value={crew.id}>
                {crew.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="member-person">Teammate</FieldLabel>
          {available.length === 0 ? (
            <p id="member-person" className="text-sm text-muted-foreground">
              {people.length === 0
                ? "Invite someone on the Team page before adding them to a crew."
                : "Everyone active is already on this crew."}
            </p>
          ) : (
            <NativeSelect id="member-person" value={profileId || available[0]?.id} onChange={(event) => setProfileId(event.target.value)}>
              {available.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={pending || available.length === 0 || !crewId}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Add member
      </Button>
    </form>
  );
}
