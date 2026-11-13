"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { minuteLabel, occupancy, STEP_MINUTES, tableLabel, visibleRange } from "@/dashboard/day";
import { BUSINESS_TZ, relativeTime } from "@/dashboard/format";
import type { CalendarDay, CalendarReservation } from "@/dashboard/types";
import { cn } from "@/lib/utils";

const HOUR_PX = 120;
const NEW_FOR_MS = 30 * 60_000;

/** Minutes since midnight now, in the restaurant's timezone. */
function nowMinute(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/**
 * The restaurant's day like a calendar app's day view: time runs down, one column per table.
 * Everything drawn comes from the calendar (GET /owner/calendar); nothing here is invented.
 */
export function DayCalendar({ day, sourceQuery }: { day: CalendarDay; sourceQuery: string }) {
  const sizes = useMemo(
    () => [...new Set(day.tables.map((t) => t.size))].sort((a, b) => a - b),
    [day.tables],
  );
  const [size, setSize] = useState<number | "all">("all");
  const [open, setOpen] = useState<{ r: CalendarReservation; x: number; y: number } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [clock, setClock] = useState(0);
  const pop = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [headH, setHeadH] = useState(0);
  useLayoutEffect(() => {
    setHeadH(headRef.current?.offsetHeight ?? 0);
  });

  const isToday = day.date === day.today;
  useEffect(() => {
    if (!isToday) return;
    const tick = () => {
      setNow(nowMinute());
      setClock(Date.now());
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [isToday]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !pop.current?.contains(e.target as Node)
      )
        setOpen(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const range = visibleRange(day.hours, day.reservations);
  const height = ((range.to - range.from) / 60) * HOUR_PX;
  const y = (minute: number) => ((minute - range.from) / 60) * HOUR_PX;
  const tables = day.tables.filter((t) => size === "all" || t.size === size);
  const occ = occupancy(day.reservations, range);
  const total = day.tables.length;

  return (
    <section
      data-testid="day-calendar"
      aria-label={`Reservations, ${day.label}`}
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="font-heading text-lg font-bold">{isToday ? "Tonight" : day.label}</h2>
        <div role="group" aria-label="Show tables" className="flex flex-wrap gap-1.5">
          {(["all", ...sizes] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={size === s}
              onClick={() => setSize(s)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                size === s
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-muted",
              )}
            >
              {s === "all" ? `All ${total} tables` : `${s}-tops`}
            </button>
          ))}
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border-l-[3px] border-primary bg-[#fdecea]" />
            Booked by Front Desk
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border-l-[3px] border-muted-foreground bg-muted" />
            On the calendar, no Front Desk record
          </span>
        </div>
      </header>

      {!day.open && day.reservations.length === 0 ? (
        <p className="px-5 py-16 text-center text-sm text-muted-foreground">
          {day.label}: the restaurant is closed.
        </p>
      ) : (
        <div className="relative max-h-[760px] overflow-auto">
          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `76px 14px repeat(${tables.length}, minmax(170px, 1fr))`,
            }}
          >
            <div
              ref={headRef}
              className="sticky top-0 left-0 z-30 border-b border-border bg-[#fffaf4]"
            />
            <div className="sticky top-0 left-[76px] z-30 border-b border-border bg-[#fffaf4]" />
            {tables.map((t) => {
              const n = day.reservations.filter((r) => r.tableId === t.id).length;
              return (
                <div
                  key={t.id}
                  className="sticky top-0 z-20 border-b border-l border-border bg-[#fffaf4] px-2 py-3 text-center"
                >
                  <p className="text-sm font-semibold">{tableLabel(t.id)}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.size} seats · {n} booking{n === 1 ? "" : "s"}
                  </p>
                </div>
              );
            })}

            <div
              className="sticky left-0 z-10 border-r border-border bg-[#fffaf4]"
              style={{ height }}
              aria-hidden
            >
              {Array.from({ length: (range.to - range.from) / 60 + 1 }, (_, i) => (
                <span
                  key={i}
                  className="absolute right-2.5 -translate-y-1/2 text-xs whitespace-nowrap text-muted-foreground"
                  style={{ top: Math.max(8, i * HOUR_PX) }}
                >
                  {minuteLabel(range.from + i * 60)}
                </span>
              ))}
            </div>
            <div
              className="sticky left-[76px] z-10 border-r border-border bg-[#fffaf4]"
              style={{ height }}
              title="How full: tables in use each 15 minutes"
            >
              {occ.map((o) => (
                <span
                  key={o.minute}
                  title={`${minuteLabel(o.minute)}: ${o.tables} of ${total} tables`}
                  className="absolute right-[3px] left-[3px] rounded-sm"
                  style={{
                    top: y(o.minute) + 1,
                    height: (STEP_MINUTES / 60) * HOUR_PX - 2,
                    background:
                      o.tables === 0
                        ? "transparent"
                        : o.tables / total >= 0.8
                          ? "#d9655d"
                          : o.tables / total >= 0.5
                            ? "#eeb3ac"
                            : "#f6e1dd",
                  }}
                />
              ))}
            </div>

            {tables.map((t, ci) => (
              <div
                key={t.id}
                className="relative border-l border-border"
                style={{
                  height,
                  backgroundImage:
                    "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(#f6efe7 1px, transparent 1px)",
                  backgroundSize: `100% ${HOUR_PX}px, 100% ${HOUR_PX / 2}px`,
                }}
              >
                {day.reservations
                  .filter((r) => r.tableId === t.id)
                  .map((r, j) => {
                    const fresh = !!r.bookedAt && clock - Date.parse(r.bookedAt) < NEW_FOR_MS;
                    const ours = r.sessionId !== null;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        data-testid="calendar-booking"
                        onClick={(e) => setOpen({ r, x: e.clientX, y: e.clientY })}
                        className={cn(
                          "fd-drop absolute right-1.5 left-1.5 flex flex-col gap-1 overflow-hidden rounded-xl border-l-4 px-3 py-2.5 text-left transition-[transform,box-shadow] duration-150 hover:z-10 hover:-translate-y-0.5 hover:shadow-lg",
                          ours
                            ? "border-primary bg-[#fdecea] text-[#5b1410]"
                            : "border-muted-foreground bg-muted text-foreground",
                          fresh && "ring-2 ring-primary",
                        )}
                        style={{
                          top: y(r.startMinute) + 3,
                          height: Math.max(36, y(r.endMinute) - y(r.startMinute) - 6),
                          animationDelay: `${(ci * 0.03 + j * 0.06).toFixed(2)}s`,
                        }}
                      >
                        <span className="truncate text-sm leading-tight font-semibold">
                          {r.name || "Guest"}
                        </span>
                        <span className="text-xs opacity-85">
                          {r.startLabel} – {r.endLabel}
                        </span>
                        <span className="mt-auto flex flex-wrap gap-1 text-[11px] font-semibold">
                          <span className="rounded-full bg-card px-2 py-0.5">👥 {r.partySize}</span>
                          {ours && (
                            <span className="rounded-full bg-card px-2 py-0.5 text-primary">
                              {fresh ? "NEW · " : ""}
                              {r.voice ? "Voice" : "Chat"}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
          {now !== null && now >= range.from && now <= range.to && (
            <div
              aria-hidden
              className="pointer-events-none absolute right-0 left-[90px] z-20 h-0.5 bg-accent"
              style={{ top: y(now) + headH }}
            >
              <span className="absolute -top-2.5 -left-[84px] rounded-md bg-accent px-1.5 text-[11px] font-bold text-accent-foreground">
                Now {minuteLabel(now).replace(" PM", "").replace(" AM", "")}
              </span>
            </div>
          )}
        </div>
      )}

      {open && (
        <div
          ref={pop}
          role="dialog"
          aria-label={`Booking for ${open.r.name}`}
          data-testid="booking-details"
          className="fd-pop fixed z-50 w-80 rounded-2xl border border-border bg-card p-4 shadow-2xl"
          style={{
            left: Math.min(open.x, window.innerWidth - 340),
            top: Math.min(open.y + 12, window.innerHeight - 320),
          }}
        >
          <p className="text-base font-semibold">{open.r.name || "Guest"}</p>
          <dl className="mt-3 grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">When</dt>
            <dd>
              {day.label.split(",")[0]} · {open.r.startLabel}–{open.r.endLabel}
            </dd>
            <dt className="text-muted-foreground">Party</dt>
            <dd>
              {open.r.partySize} {open.r.partySize === 1 ? "guest" : "guests"}
            </dd>
            <dt className="text-muted-foreground">Table</dt>
            <dd>{tableLabel(open.r.tableId)}</dd>
            {open.r.contact && (
              <>
                <dt className="text-muted-foreground">Contact</dt>
                <dd className="break-all">{open.r.contact}</dd>
              </>
            )}
            {open.r.bookedAt && (
              <>
                <dt className="text-muted-foreground">Booked</dt>
                <dd>
                  {relativeTime(open.r.bookedAt)} by {open.r.voice ? "voice" : "chat"}
                </dd>
              </>
            )}
            {open.r.emailed !== null && (
              <>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{open.r.emailed ? "✓ Confirmation sent" : "Not delivered yet"}</dd>
              </>
            )}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {open.r.sessionId && (
              <Link
                href={`/dashboard/conversations/${encodeURIComponent(open.r.sessionId)}${sourceQuery}`}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
              >
                Open conversation
              </Link>
            )}
            {open.r.calendarUrl && (
              <a
                href={open.r.calendarUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold"
              >
                Open in Calendar <Icon name="external" className="size-3.5" />
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
