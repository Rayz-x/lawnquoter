export type AccountStatus = "lead" | "active" | "inactive";

export type AccountStatusMenuItem = {
  id: "lead" | "activate" | "archive" | "unarchive" | "export";
  label: string;
  destructive?: boolean;
  confirm?: string;
};

/** Manual override items for the account ⋯ menu (S18). */
export function accountStatusMenuItems(status: AccountStatus): AccountStatusMenuItem[] {
  const items: AccountStatusMenuItem[] = [{ id: "export", label: "Export" }];
  if (status !== "lead") items.push({ id: "lead", label: "Mark as Lead" });
  if (status !== "active") items.push({ id: "activate", label: "Activate" });
  if (status !== "inactive") {
    items.push({
      id: "archive",
      label: "Archive",
      destructive: true,
      confirm: "This account stays on file as archived.",
    });
  } else {
    items.push({ id: "unarchive", label: "Unarchive" });
  }
  return items;
}
