import type { Metadata } from "next";
import Link from "next/link";
import {
  AuditStageChip,
  Chip,
  DemoBadge,
  OutcomeChip,
  reasonLabel,
} from "@/components/dashboard/chips";
import { LatencyStrip } from "@/components/dashboard/latency-strip";
import { Panel, PanelHeader } from "@/components/dashboard/page";
import { Icon } from "@/components/icons";
import { formatClock, formatSlot, formatTime, formatUsd } from "@/dashboard/format";
import { type AuditRow, type ConversationDetail, sourceParam } from "@/dashboard/types";
import { ownerFetch } from "@/lib/owner-api";

export const metadata: Metadata = { title: "Conversation" };

const KIND = { book: "New booking", reschedule: "Reschedule", cancel: "Cancellation" } as const;

/** The audit log grouped by action, oldest first: one block per proposed write. */
function byAction(audit: AuditRow[]): AuditRow[][] {
  const groups = new Map<string, AuditRow[]>();
  for (const row of audit) groups.set(row.actionId, [...(groups.get(row.actionId) ?? []), row]);
  return [...groups.values()];
}

function describeArgs(args: Record<string, unknown> | null): string[] {
  if (!args) return [];
  const out: string[] = [];
  if (typeof args.name === "string") out.push(args.name);
  if (typeof args.partySize === "number") out.push(`party of ${args.partySize}`);
  if (typeof args.slotId === "string") out.push(formatSlot(args.slotId));
  if (typeof args.reservationId === "string")
    out.push(`reservation ${args.reservationId.slice(-8)}`);
  return out;
}

const FLAG_LABELS: Record<string, string> = {
  injection_pattern: "Prompt-injection pattern",
  email_failed: "Email failed",
  audit_failed: "Audit write failed",
};

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const source = sourceParam((await searchParams).source);
  const { summary, turns, audit, handoff } = await ownerFetch<ConversationDetail>(
    `/conversations/${encodeURIComponent(id)}`,
  );
  const tokens = turns.reduce((n, t) => n + t.tokensIn + t.tokensOut, 0);

  return (
    <>
      <Link
        href={`/dashboard/conversations${source === "pilot" ? "?source=pilot" : ""}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <Icon name="chevronLeft" className="size-3.5" /> All conversations
      </Link>
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-bold tracking-wide sm:text-3xl">
            {formatTime(summary.startedAt)}
          </h1>
          <OutcomeChip c={summary} />
          {summary.seeded && <DemoBadge />}
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <div className="flex gap-1">
            <dt>Session</dt>
            <dd className="font-mono text-xs leading-5 text-foreground">{summary.id}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Messages</dt>
            <dd className="text-foreground tabular-nums">{summary.turnCount}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Tokens</dt>
            <dd className="text-foreground tabular-nums">{tokens.toLocaleString("en-US")}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Cost</dt>
            <dd className="text-foreground tabular-nums">{formatUsd(summary.costUsd)}</dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHeader
            title="Transcript"
            description="Each reply shows how long it took against the latency budget."
          />
          <ol className="flex flex-col gap-6 px-5 py-5" data-testid="transcript">
            {turns.map((t) => (
              <li key={t.id} className="flex flex-col gap-3">
                <div className="flex max-w-[85%] gap-3 self-end">
                  <p className="rounded-2xl rounded-tr-sm bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">
                    {t.callerText}
                  </p>
                  <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Icon name="user" className="size-3.5" />
                    <span className="sr-only">Guest</span>
                  </span>
                </div>
                <div className="flex max-w-[90%] gap-3">
                  <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Icon name="bot" className="size-3.5" />
                    <span className="sr-only">Front Desk</span>
                  </span>
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5 text-sm">
                      {t.agentText}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {formatClock(t.createdAt)}
                      </span>
                      {t.toolCalls.map((c, i) => (
                        <Chip
                          key={i}
                          tone={c.ok ? "info" : "bad"}
                          icon="tool"
                          className="text-[11px]"
                        >
                          {c.name}
                          {!c.ok && " failed"}
                        </Chip>
                      ))}
                      {t.flags
                        .filter((f) => FLAG_LABELS[f])
                        .map((f) => (
                          <Chip key={f} tone="bad" icon="alert" className="text-[11px]">
                            {FLAG_LABELS[f]}
                          </Chip>
                        ))}
                    </div>
                    <LatencyStrip turn={t} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="flex flex-col gap-6">
          {handoff && (
            <Panel data-testid="handoff-panel">
              <PanelHeader
                title="Handoff"
                description={reasonLabel(handoff.reason)}
                actions={
                  handoff.resolvedAt ? (
                    <Chip tone="good" icon="check">
                      Resolved
                    </Chip>
                  ) : (
                    <Chip tone="warn" icon="clock">
                      Open
                    </Chip>
                  )
                }
              />
              <div className="flex flex-col gap-3 px-5 py-4 text-sm">
                <p>{handoff.summary}</p>
                {handoff.notes && (
                  <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
                    <span className="font-medium text-foreground">Your notes: </span>
                    {handoff.notes}
                  </p>
                )}
                {!handoff.resolvedAt && (
                  <Link
                    href={`/dashboard/handoffs${source === "pilot" ? "?source=pilot" : ""}#${handoff.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    Resolve in the handoff queue →
                  </Link>
                )}
              </div>
            </Panel>
          )}

          <Panel data-testid="audit-trail">
            <PanelHeader
              title="Audit trail"
              description="Every booking change, from proposal to Calendar. Nothing is written without the guest's yes."
            />
            {audit.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                No booking changes in this conversation.
              </p>
            ) : (
              <ol className="flex flex-col divide-y divide-border">
                {byAction(audit).map((rows) => (
                  <li key={rows[0]!.actionId} className="px-5 py-4">
                    <p className="text-sm font-semibold">{KIND[rows[0]!.kind]}</p>
                    <p className="text-xs text-muted-foreground">
                      {describeArgs(rows[0]!.args).join(" · ")}
                    </p>
                    <ol className="mt-3 flex flex-col gap-2 border-l-2 border-border pl-4">
                      {rows.map((r) => (
                        <li
                          key={r.seq}
                          className="relative flex flex-wrap items-center gap-2 text-xs"
                        >
                          <span
                            className="absolute top-1.5 -left-[21px] size-2 rounded-full border-2 border-card bg-border"
                            aria-hidden
                          />
                          <AuditStageChip stage={r.stage} />
                          <span className="text-muted-foreground tabular-nums">
                            {formatClock(r.at)}
                          </span>
                          {r.reason && (
                            <span className="text-muted-foreground">
                              ({r.reason.replaceAll("_", " ")})
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
