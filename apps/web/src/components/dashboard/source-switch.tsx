"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "live", label: "Live", hint: "This demo and test traffic" },
  { value: "pilot", label: "Pilot", hint: "Real guests during the pilot" },
] as const;

/** Live vs pilot data (spec §10). Eval runs live in their own database and never show here. */
export function SourceSwitch() {
  const pathname = usePathname();
  const current = useSearchParams().get("source") === "pilot" ? "pilot" : "live";
  return (
    <div className="flex flex-col gap-1.5">
      <span
        id="source-label"
        className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        Data source
      </span>
      <div
        role="group"
        aria-labelledby="source-label"
        className="grid grid-cols-2 rounded-lg border border-border bg-background p-0.5"
      >
        {OPTIONS.map((o) => (
          <Link
            key={o.value}
            href={o.value === "pilot" ? `${pathname}?source=pilot` : pathname}
            title={o.hint}
            aria-pressed={current === o.value}
            className={cn(
              "rounded-md px-3 py-1 text-center text-sm font-medium transition-colors duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              current === o.value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
