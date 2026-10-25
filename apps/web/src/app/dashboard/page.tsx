import type { Metadata } from "next";
import Link from "next/link";
import { LiveBoard } from "@/components/dashboard/live-board";
import { PageHeader } from "@/components/dashboard/page";
import { Icon } from "@/components/icons";
import type { HandoffRow, LiveSession } from "@/dashboard/types";
import { sourceParam } from "@/dashboard/types";
import { ownerFetch } from "@/lib/owner-api";

export const metadata: Metadata = { title: "Live" };

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const source = sourceParam((await searchParams).source);
  const [sessions, openHandoffs] = await Promise.all([
    ownerFetch<LiveSession[]>("/live"),
    ownerFetch<HandoffRow[]>(`/handoffs?status=open&source=${source}`),
  ]);
  return (
    <>
      <PageHeader
        title="Live"
        description="Guests talking to Front Desk right now, and any booking waiting for their yes."
        actions={
          openHandoffs.length > 0 && (
            <Link
              href={`/dashboard/handoffs${source === "pilot" ? "?source=pilot" : ""}`}
              className="inline-flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm font-medium text-warning transition-colors duration-200 hover:bg-warning-soft/70"
            >
              <Icon name="handoffs" />
              {openHandoffs.length} {openHandoffs.length === 1 ? "handoff needs" : "handoffs need"}{" "}
              you
              <Icon name="chevronRight" className="size-3.5" />
            </Link>
          )
        }
      />
      <LiveBoard initial={sessions} />
    </>
  );
}
