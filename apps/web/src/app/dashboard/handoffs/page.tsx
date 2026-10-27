import type { Metadata } from "next";
import Link from "next/link";
import { Chip, DemoBadge, reasonLabel } from "@/components/dashboard/chips";
import { EmptyState, PageHeader } from "@/components/dashboard/page";
import { ResolveForm } from "@/components/dashboard/resolve-form";
import { Icon } from "@/components/icons";
import { formatTime, relativeTime } from "@/dashboard/format";
import { outcomeLabel } from "@/dashboard/handoff-outcomes";
import { type HandoffRow, sourceParam } from "@/dashboard/types";
import { ownerFetch } from "@/lib/owner-api";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Handoffs" };

export default async function HandoffsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const source = sourceParam(params.source);
  const status = params.status === "resolved" ? "resolved" : "open";
  const [rows, openRows] = await Promise.all([
    ownerFetch<HandoffRow[]>(`/handoffs?source=${source}&status=${status}`),
    status === "open" ? null : ownerFetch<HandoffRow[]>(`/handoffs?source=${source}&status=open`),
  ]);
  const openCount = (openRows ?? rows).length;
  const tab = (s: "open" | "resolved") => {
    const q = new URLSearchParams();
    if (s === "resolved") q.set("status", "resolved");
    if (source === "pilot") q.set("source", "pilot");
    const qs = q.toString();
    return `/dashboard/handoffs${qs ? `?${qs}` : ""}`;
  };
  const sourceQ = source === "pilot" ? "?source=pilot" : "";

  return (
    <>
      <PageHeader
        title="Handoffs"
        description="Conversations Front Desk passed to you. Each guest was told how and when you'd be in touch."
      />
      <div
        role="tablist"
        aria-label="Handoff status"
        className="mb-4 inline-flex rounded-lg border border-border bg-card p-0.5"
      >
        {(["open", "resolved"] as const).map((s) => (
          <Link
            key={s}
            role="tab"
            aria-selected={status === s}
            href={tab(s)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-200",
              status === s
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s === "open" ? `Open (${openCount})` : "Resolved"}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon="check"
            title={status === "open" ? "Nothing needs you" : "No resolved handoffs yet"}
          >
            {status === "open"
              ? "When Front Desk hands a guest to you, it shows up here."
              : "Resolved handoffs and your notes are kept here."}
          </EmptyState>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((h) => (
            <li
              key={h.id}
              id={h.id}
              data-testid="handoff-card"
              className="scroll-mt-24 rounded-xl border border-border bg-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="warn" icon="handoffs">
                    {reasonLabel(h.reason)}
                  </Chip>
                  {h.seeded && <DemoBadge />}
                  <span className="text-xs text-muted-foreground" title={formatTime(h.createdAt)}>
                    {relativeTime(h.createdAt)}
                  </span>
                </div>
                <Link
                  href={`/dashboard/conversations/${encodeURIComponent(h.sessionId)}${sourceQ}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  Conversation <Icon name="chevronRight" className="size-3.5" />
                </Link>
              </div>
              <div className="flex flex-col gap-4 px-5 py-4">
                <p className="text-sm">{h.summary}</p>
                <details className="group rounded-lg border border-border">
                  <summary className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground select-none hover:text-foreground">
                    <Icon
                      name="chevronRight"
                      className="size-3.5 transition-transform duration-200 group-open:rotate-90"
                    />
                    Transcript ({h.transcript.length} messages)
                  </summary>
                  <ol className="flex flex-col gap-2 border-t border-border px-4 py-3 text-sm">
                    {h.transcript.map((t, i) => (
                      <li key={i} className="flex gap-2">
                        <span
                          className={cn(
                            "w-20 shrink-0 text-xs font-semibold leading-5",
                            t.role === "agent" ? "text-primary" : "text-muted-foreground",
                          )}
                        >
                          {t.role === "agent" ? "Front Desk" : "Guest"}
                        </span>
                        <span>{t.text}</span>
                      </li>
                    ))}
                  </ol>
                </details>
                {h.resolvedAt ? (
                  <div className="rounded-lg bg-success-soft/60 px-4 py-3 text-sm">
                    <p className="flex items-center gap-2 font-medium text-success">
                      <Icon name="check" /> Resolved {formatTime(h.resolvedAt)}
                      {outcomeLabel(h.outcome) && (
                        <span data-testid="handoff-outcome">· {outcomeLabel(h.outcome)}</span>
                      )}
                    </p>
                    {h.notes && <p className="mt-1 text-foreground/80">{h.notes}</p>}
                  </div>
                ) : (
                  <ResolveForm id={h.id} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
