import type { Metadata } from "next";
import { NewCustomerDialog } from "../new-customer-dialog";

export const metadata: Metadata = { title: "New account" };

export default function NewAccountPage() {
  return (
    <div data-page="new-customer">
      <NewCustomerDialog startOpen />
    </div>
  );
}
