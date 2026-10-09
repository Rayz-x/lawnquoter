export const LOCKED_CUSTOMER_COPY_ERROR =
  "This proposal is frozen. Revise it before editing the title, intro, or customer notes.";

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Customer-facing copy on a frozen quote. Unchanged values are not edits. */
export function customerCopyUpdateError(
  editable: boolean,
  current: { title: string; intro: string | null; notes_customer: string | null },
  submitted: { title?: string; intro?: string; notes_customer?: string },
): string | null {
  if (editable) return null;
  const titleChanged = submitted.title !== undefined && submitted.title.trim() !== current.title.trim();
  const introChanged = submitted.intro !== undefined && blankToNull(submitted.intro) !== blankToNull(current.intro);
  const notesChanged =
    submitted.notes_customer !== undefined && blankToNull(submitted.notes_customer) !== blankToNull(current.notes_customer);
  if (titleChanged || introChanged || notesChanged) return LOCKED_CUSTOMER_COPY_ERROR;
  return null;
}
