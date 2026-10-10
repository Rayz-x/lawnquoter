"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TabBox, type EntryTab } from "@/components/entry";

export function AccountTabBox({ initial, tabs }: { initial: string; tabs: EntryTab[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initial);

  return (
    <TabBox
      label="Account"
      tabs={tabs}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        router.replace(`${pathname}?tab=${next}`, { scroll: false });
      }}
    />
  );
}
