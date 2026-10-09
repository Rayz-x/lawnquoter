import type { ComponentProps } from "react";
import { cn } from "cn";

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn("native-control", className)} {...props} />;
}
