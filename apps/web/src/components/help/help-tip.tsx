"use client";

import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** Below the icon. Flip when that side does not fit, then to the side, instead of starting on top of the label. */
const placement = {
  side: "bottom" as const,
  collisionAvoidance: {
    side: "flip" as const,
    align: "shift" as const,
    fallbackAxisSide: "end" as const,
  },
};

export function HelpTip({ label, text, href }: { label: string; text: string; href: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={label}
          delay={200}
          closeOnClick={false}
          data-side={placement.side}
          data-collision-side={placement.collisionAvoidance.side}
          data-collision-fallback={placement.collisionAvoidance.fallbackAxisSide}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <CircleHelp aria-hidden className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent
          side={placement.side}
          collisionAvoidance={placement.collisionAvoidance}
          className="max-w-64 flex-col items-start gap-1.5 px-3 py-2 text-start text-xs"
        >
          <p>{text}</p>
          <Link href={href} className="font-medium underline">
            Learn more
          </Link>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
