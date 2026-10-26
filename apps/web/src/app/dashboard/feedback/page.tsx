import type { Metadata } from "next";
import Link from "next/link";
import { DemoBadge } from "@/components/dashboard/chips";
import { EmptyState, PageHeader } from "@/components/dashboard/page";
import { Icon } from "@/components/icons";
import { formatTime, relativeTime } from "@/dashboard/format";
import { type FeedbackRow, sourceParam } from "@/dashboard/types";
import { ownerFetch } from "@/lib/owner-api";

export const metadata: Metadata = { title: "Feedback" };

/** Post-conversation ratings and comments (spec §12), newest first. */
export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const source = sourceParam((await searchParams).source);
  const rows = await ownerFetch<FeedbackRow[]>(`/feedback?source=${source}`);
  const sourceQ = source === "pilot" ? "?source=pilot" : "";

  return (
    <>
      <PageHeader
        title="Feedback"
        description="What guests said when their chat ended. Read it weekly (docs/pilot.md)."
      />
      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState icon="star" title="No feedback yet">
            Guests can rate a chat when they end it or when it's handed to you.
          </EmptyState>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((f) => (
            <li
              key={f.conversationId}
              data-testid="feedback-row"
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span
                    className="text-accent"
                    aria-label={`${f.rating ?? 0} out of 5 stars`}
                    data-testid="feedback-rating"
                  >
                    {"★".repeat(f.rating ?? 0)}
                    <span className="text-muted-foreground/40">
                      {"★".repeat(5 - (f.rating ?? 0))}
                    </span>
                  </span>
                  {f.seeded && <DemoBadge />}
                  <span className="text-xs text-muted-foreground" title={formatTime(f.createdAt)}>
                    {relativeTime(f.createdAt)}
                  </span>
                </div>
                <p className="text-sm">
                  {f.comment || <span className="text-muted-foreground">No comment</span>}
                </p>
              </div>
              <Link
                href={`/dashboard/conversations/${encodeURIComponent(f.conversationId)}${sourceQ}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Conversation <Icon name="chevronRight" className="size-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
