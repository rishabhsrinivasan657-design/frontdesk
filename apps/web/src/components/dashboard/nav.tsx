"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/utils";

export const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Live", icon: "live" },
  { href: "/dashboard/conversations", label: "Conversations", icon: "conversations" },
  { href: "/dashboard/bookings", label: "Bookings", icon: "bookings" },
  { href: "/dashboard/handoffs", label: "Handoffs", icon: "handoffs" },
  { href: "/dashboard/metrics", label: "Metrics", icon: "metrics" },
];

const isActive = (pathname: string, href: string) =>
  href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

/** The five views. Links keep `?source=pilot` so switching views keeps the data set. */
export function Nav({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  const pilot = useSearchParams().get("source") === "pilot";
  const vertical = orientation === "vertical";
  return (
    <nav
      aria-label="Dashboard"
      className={cn(vertical ? "flex flex-col gap-1" : "flex gap-1 overflow-x-auto")}
    >
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={pilot ? `${item.href}?source=pilot` : item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md text-sm font-medium whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              vertical ? "px-3 py-2" : "px-3 py-1.5",
              active
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <Icon name={item.icon} className={cn("size-4", active && "text-primary")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
