import type { Metadata } from "next";
import Link from "next/link";
import { DemoBadge, OutcomeChip } from "@/components/dashboard/chips";
import { EmptyState, PageHeader, Panel } from "@/components/dashboard/page";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTime, formatUsd } from "@/dashboard/format";
import { type ConversationSummary, sourceParam } from "@/dashboard/types";
import { ownerFetch } from "@/lib/owner-api";

export const metadata: Metadata = { title: "Conversations" };
const PAGE = 50;

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const source = sourceParam(params.source);
  const q = typeof params.q === "string" ? params.q.slice(0, 200) : "";
  const before = typeof params.before === "string" ? params.before : "";
  const query = new URLSearchParams({ source, limit: String(PAGE) });
  if (q) query.set("q", q);
  if (before) query.set("before", before);
  const rows = await ownerFetch<ConversationSummary[]>(`/conversations?${query}`);
  const older = new URLSearchParams({ source, before: rows.at(-1)?.startedAt ?? "" });
  if (q) older.set("q", q);
  const detail = (id: string) =>
    `/dashboard/conversations/${encodeURIComponent(id)}${source === "pilot" ? "?source=pilot" : ""}`;

  return (
    <>
      <PageHeader
        title="Conversations"
        description="Every conversation Front Desk has had, with its transcript, tool calls, audit trail and latency."
      />
      <form role="search" className="mb-4 flex gap-2" action="/dashboard/conversations">
        {source === "pilot" && <input type="hidden" name="source" value="pilot" />}
        <label htmlFor="q" className="sr-only">
          Search conversations
        </label>
        <div className="relative max-w-md flex-1">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Search what guests or Front Desk said…"
            className="h-10 pl-9"
          />
        </div>
        <Button type="submit" variant="outline" className="h-10">
          Search
        </Button>
        {(q || before) && (
          <Link
            href={`/dashboard/conversations${source === "pilot" ? "?source=pilot" : ""}`}
            className="self-center text-sm text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </form>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState
            icon={q ? "search" : "conversations"}
            title={q ? `Nothing matches “${q}”` : "No conversations yet"}
          >
            {q
              ? "Try a guest's name, a date or a word they used."
              : "They'll appear here after a guest's first message."}
          </EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Started
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Last thing the guest said
                </th>
                <th scope="col" className="hidden px-5 py-3 text-right font-medium sm:table-cell">
                  Messages
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Outcome
                </th>
                <th scope="col" className="hidden px-5 py-3 text-right font-medium md:table-cell">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr
                  key={c.id}
                  data-testid="conversation-row"
                  className="group transition-colors duration-150 hover:bg-secondary/40"
                >
                  <td className="px-5 py-3 align-top whitespace-nowrap">
                    <Link
                      href={detail(c.id)}
                      className="font-medium outline-none group-hover:text-primary focus-visible:underline"
                    >
                      {formatTime(c.startedAt)}
                    </Link>
                    {c.seeded && (
                      <span className="ml-2">
                        <DemoBadge />
                      </span>
                    )}
                  </td>
                  <td className="max-w-0 px-5 py-3 align-top">
                    <p className="truncate text-muted-foreground">{c.lastCallerText ?? "—"}</p>
                  </td>
                  <td className="hidden px-5 py-3 text-right align-top tabular-nums sm:table-cell">
                    {c.turnCount}
                  </td>
                  <td className="px-5 py-3 align-top">
                    <OutcomeChip c={c} />
                  </td>
                  <td className="hidden px-5 py-3 text-right align-top text-muted-foreground tabular-nums md:table-cell">
                    {formatUsd(c.costUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {rows.length === PAGE && (
        <div className="mt-4 flex justify-center">
          <Link
            href={`/dashboard/conversations?${older}`}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-secondary"
          >
            Older conversations <Icon name="chevronRight" className="size-3.5" />
          </Link>
        </div>
      )}
    </>
  );
}
