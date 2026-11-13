import type { Metadata } from "next";
import Link from "next/link";
import { Chip, DemoBadge, reasonLabel } from "@/components/dashboard/chips";
import { EmptyState, PageHeader } from "@/components/dashboard/page";
import { ResolveForm } from "@/components/dashboard/resolve-form";
import { Icon } from "@/components/icons";
import { formatTime, relativeTime } from "@/dashboard/format";
import { nextStep, whatTheyWant } from "@/dashboard/handoff-guidance";
import { outcomeLabel } from "@/dashboard/handoff-outcomes";
import { sourceParam, sourceQuery } from "@/dashboard/source";
import type { HandoffRow } from "@/dashboard/types";
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
  const sourceQ = sourceQuery(source);

  return (
    <>
      <PageHeader
        title="Handoffs"
        description="Guests Front Desk passed to you. Each card says who they are, what they wanted, and what to do next."
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
        <ul className="grid items-start gap-4 xl:grid-cols-2">
          {rows.map((h) => {
            const want = whatTheyWant(h.summary);
            const d = h.details ?? {};
            const facts = [
              d.date,
              d.time,
              d.partySize ? `Party of ${d.partySize}` : undefined,
            ].filter(Boolean);
            const initials = (d.name ?? "")
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]!.toUpperCase())
              .join("");
            return (
              <li
                key={h.id}
                id={h.id}
                data-testid="handoff-card"
                className="fd-pop flex scroll-mt-24 flex-col overflow-hidden rounded-2xl border border-border bg-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
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
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-bold">
                      {initials || <Icon name="user" className="size-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">{d.name ?? "Guest (no name given)"}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {d.contact ?? "No contact given: see the conversation"}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-xl bg-muted/60 px-4 py-3">
                    <p className="mb-1 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                      {want.kind === "summary" ? "What they want" : "What they said last"}
                    </p>
                    <p className="text-sm">
                      {want.kind === "quote" ? `“${want.text}”` : want.text}
                    </p>
                  </div>
                  {facts.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5" aria-label="What they asked for">
                      {facts.map((f) => (
                        <li
                          key={f}
                          className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs"
                        >
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!h.resolvedAt && (
                    <div className="border-l-[3px] border-accent pl-3">
                      <p className="mb-0.5 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                        What you need to do
                      </p>
                      <p className="text-sm">{nextStep(h.reason)}</p>
                    </div>
                  )}
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
                        <li
                          key={i}
                          className={cn(
                            "max-w-[85%] rounded-2xl px-3 py-1.5",
                            t.role === "agent"
                              ? "self-start bg-muted"
                              : "self-end bg-primary text-primary-foreground",
                          )}
                        >
                          {t.text}
                        </li>
                      ))}
                    </ol>
                  </details>
                </div>
                <div className="border-t border-border bg-[#fffcf8] px-5 py-4">
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
            );
          })}
        </ul>
      )}
    </>
  );
}
