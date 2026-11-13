import type { Metadata } from "next";
import Link from "next/link";
import { reasonLabel } from "@/components/dashboard/chips";
import { DayCalendar } from "@/components/dashboard/day-calendar";
import { LiveBoard } from "@/components/dashboard/live-board";
import { LiveCount } from "@/components/dashboard/live-count";
import { KpiTile, PageHeader } from "@/components/dashboard/page";
import { Icon } from "@/components/icons";
import { busiest, minuteLabel, visibleRange } from "@/dashboard/day";
import { relativeTime } from "@/dashboard/format";
import type { CalendarDay, HandoffRow, LiveSession } from "@/dashboard/types";
import { sourceParam } from "@/dashboard/types";
import { ownerFetch, ownerFetchUnlessDown } from "@/lib/owner-api";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Today" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The owner's home: the restaurant's day as a calendar (one column per table), how busy it is,
 * who is talking to Front Desk right now, and what needs a human.
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const source = sourceParam(params.source);
  const date = typeof params.date === "string" && DATE.test(params.date) ? params.date : undefined;
  const q = new URLSearchParams({ source });
  if (date) q.set("date", date);
  const [day, sessions, openHandoffs] = await Promise.all([
    ownerFetchUnlessDown<CalendarDay>(`/calendar?${q}`),
    ownerFetch<LiveSession[]>("/live"),
    ownerFetch<HandoffRow[]>(`/handoffs?status=open&source=${source}`),
  ]);
  const sourceQ = source === "pilot" ? "?source=pilot" : "";
  const dayHref = (d: string) => {
    const p = new URLSearchParams();
    if (d !== day?.today) p.set("date", d);
    if (source === "pilot") p.set("source", "pilot");
    const s = p.toString();
    return `/dashboard${s ? `?${s}` : ""}`;
  };
  const guests = day?.reservations.reduce((n, r) => n + r.partySize, 0) ?? 0;
  const voice = day?.reservations.filter((r) => r.voice).length ?? 0;
  const peak = day ? busiest(day.reservations, visibleRange(day.hours, day.reservations)) : null;
  const isToday = day && day.date === day.today;

  return (
    <>
      <PageHeader
        title={day?.label ?? "Today"}
        description={
          isToday
            ? "Your restaurant's book for tonight, live from the calendar."
            : "The restaurant's book for this day, from the calendar."
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <LiveCount initial={sessions.length} />
        <KpiTile
          label={isToday ? "Bookings tonight" : "Bookings"}
          value={day ? String(day.reservations.length) : "—"}
          detail={
            day ? `${voice} by voice · ${day.reservations.length - voice} by chat` : undefined
          }
        />
        <KpiTile
          label="Guests expected"
          value={day ? String(guests) : "—"}
          detail={day ? `${day.seats} seats across ${day.tables.length} tables` : undefined}
        />
        <KpiTile
          label="Busiest"
          value={peak ? minuteLabel(peak.minute) : "—"}
          detail={
            peak && day ? `${peak.tables} of ${day.tables.length} tables taken` : "No bookings yet"
          }
        />
        <Link
          href={`/dashboard/handoffs${sourceQ}`}
          data-testid="kpi-needs-you"
          className={cn(
            "rounded-xl border px-5 py-4 transition-colors",
            openHandoffs.length > 0
              ? "border-primary/30 bg-[#fff7f5] hover:bg-[#fdecea]"
              : "border-border bg-card hover:bg-muted/40",
          )}
        >
          <p className="text-sm font-medium text-muted-foreground">Needs you</p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums sm:text-3xl",
              openHandoffs.length > 0 && "text-primary",
            )}
          >
            {openHandoffs.length}
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            {openHandoffs.length === 1 ? "handoff to resolve" : "handoffs to resolve"}
            <Icon name="chevronRight" className="size-3" />
          </p>
        </Link>
      </div>

      {day && (
        <nav aria-label="Days" className="mb-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
          {day.week.map((d) => {
            const selected = d.date === day.date;
            const full = Math.min(100, Math.round((d.guests / day.seats) * 100));
            return d.open ? (
              <Link
                key={d.date}
                href={dayHref(d.date)}
                aria-current={selected ? "date" : undefined}
                className={cn(
                  "rounded-xl border bg-card px-3 py-2.5 transition-colors hover:bg-muted/40",
                  selected ? "border-primary ring-4 ring-primary/10" : "border-border",
                )}
              >
                <p className="text-sm font-semibold">{d.label}</p>
                <p className="text-xs text-muted-foreground">
                  {d.bookings} booking{d.bookings === 1 ? "" : "s"} · {d.guests} guests
                </p>
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${full}%` }}
                  />
                </span>
              </Link>
            ) : (
              <div
                key={d.date}
                className="rounded-xl border border-border bg-card px-3 py-2.5 opacity-50"
              >
                <p className="text-sm font-semibold">{d.label}</p>
                <p className="text-xs text-muted-foreground">Closed</p>
              </div>
            );
          })}
        </nav>
      )}

      {day ? (
        <DayCalendar day={day} sourceQuery={sourceQ} />
      ) : (
        <div className="rounded-2xl border border-warning/40 bg-warning-soft px-5 py-8 text-center text-sm text-warning">
          The calendar can&apos;t be reached right now, so tonight&apos;s bookings can&apos;t be
          shown. Front Desk won&apos;t book while it&apos;s down either. Try again in a minute.
        </div>
      )}

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
        <section id="live" aria-labelledby="live-heading" className="scroll-mt-24">
          <h2 id="live-heading" className="mb-3 font-heading text-lg font-bold">
            Live now
          </h2>
          <LiveBoard initial={sessions} />
        </section>
        <section aria-labelledby="needs-heading">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="needs-heading" className="font-heading text-lg font-bold">
              Needs you
            </h2>
            <Link
              href={`/dashboard/handoffs${sourceQ}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              See all
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {openHandoffs.length === 0 && (
              <li className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing needs you right now.
              </li>
            )}
            {openHandoffs.slice(0, 4).map((h) => (
              <li key={h.id}>
                <Link
                  href={`/dashboard/handoffs${sourceQ}#${h.id}`}
                  className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning">
                      {reasonLabel(h.reason)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(h.createdAt)}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-sm">
                    {h.details?.name ? `${h.details.name}: ` : ""}
                    {h.summary}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
