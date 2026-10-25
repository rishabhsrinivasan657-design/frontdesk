import type { Metadata } from "next";
import Link from "next/link";
import { BookingStatusChip, Chip, DemoBadge } from "@/components/dashboard/chips";
import { EmptyState, KpiTile, PageHeader, Panel } from "@/components/dashboard/page";
import { Icon } from "@/components/icons";
import { formatTime } from "@/dashboard/format";
import { type BookingRow, sourceParam } from "@/dashboard/types";
import { ownerFetch } from "@/lib/owner-api";

export const metadata: Metadata = { title: "Bookings" };

function EmailCell({ emailed }: { emailed: boolean | null }) {
  if (emailed === true)
    return (
      <Chip tone="good" icon="mail">
        Sent
      </Chip>
    );
  if (emailed === false)
    return (
      <Chip tone="bad" icon="mail">
        Failed
      </Chip>
    );
  return <span className="text-muted-foreground">—</span>;
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const source = sourceParam((await searchParams).source);
  const rows = await ownerFetch<BookingRow[]>(`/bookings?source=${source}`);
  const now = Date.now();
  const upcoming = rows.filter((b) => b.status !== "cancelled" && Date.parse(b.start) > now);
  const covers = upcoming.reduce((n, b) => n + b.partySize, 0);
  const cancelled = rows.filter((b) => b.status === "cancelled").length;
  // Upcoming first, soonest at the top; then past and cancelled ones, most recent first.
  const isUpcoming = (b: BookingRow) => b.status !== "cancelled" && Date.parse(b.start) > now;
  const sorted = [
    ...upcoming.sort((a, b) => a.start.localeCompare(b.start)),
    ...rows.filter((b) => !isUpcoming(b)).sort((a, b) => b.start.localeCompare(a.start)),
  ];
  const q = source === "pilot" ? "?source=pilot" : "";

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Reservations Front Desk wrote to your calendar, each one after the guest said yes."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiTile label="Upcoming reservations" value={String(upcoming.length)} />
        <KpiTile
          label="Guests expected"
          value={String(covers)}
          detail="Across upcoming reservations"
        />
        <KpiTile
          label="Cancelled"
          value={String(cancelled)}
          detail="By guests, through Front Desk"
        />
      </div>
      <Panel>
        {rows.length === 0 ? (
          <EmptyState icon="bookings" title="No bookings yet">
            When a guest confirms a table, it appears here with a link to the calendar event.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Guest
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Party
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Email
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    <span className="sr-only">Links</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((b) => (
                  <tr
                    key={b.reservationId}
                    data-testid="booking-row"
                    className="transition-colors duration-150 hover:bg-secondary/40"
                  >
                    <td className="px-5 py-3">
                      <p className="flex items-center gap-2 font-medium">
                        {b.name}
                        {b.seeded && <DemoBadge />}
                      </p>
                      <p className="text-xs text-muted-foreground">{b.contact}</p>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span
                        className={
                          b.status === "cancelled" ? "text-muted-foreground line-through" : ""
                        }
                      >
                        {formatTime(b.start)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Icon name="party" className="size-3.5 text-muted-foreground" />
                        {b.partySize}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <BookingStatusChip status={b.status} />
                    </td>
                    <td className="px-5 py-3">
                      <EmailCell emailed={b.emailed} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                        {b.calendarUrl ? (
                          <a
                            href={b.calendarUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                          >
                            Calendar <Icon name="external" className="size-3.5" />
                          </a>
                        ) : (
                          <span
                            className="text-xs text-muted-foreground"
                            title="Seeded or in-memory bookings have no Google Calendar event"
                          >
                            No calendar event
                          </span>
                        )}
                        <Link
                          href={`/dashboard/conversations/${encodeURIComponent(b.sessionId)}${q}`}
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                        >
                          Conversation <Icon name="chevronRight" className="size-3.5" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
