import type { CardDetails } from "@frontdesk/core";
import type { PendingCard } from "@/chat/state";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

const CHECKS: Record<PendingCard["kind"], string[]> = {
  book: [
    "You confirmed it before anything was saved",
    "The slot was re-checked, then saved to the calendar",
    "Logged in the restaurant's audit trail",
  ],
  reschedule: [
    "You confirmed the change before anything was saved",
    "The new slot was re-checked, then the booking was moved",
    "Logged in the restaurant's audit trail",
  ],
  cancel: [
    "You confirmed it before anything was changed",
    "Removed from the calendar",
    "Logged in the restaurant's audit trail",
  ],
};

const TITLE = {
  book: "Reservation booked",
  reschedule: "Reservation moved",
  cancel: "Reservation cancelled",
};

/**
 * The executed action on the restaurant's day, shown after the gate wrote it. Everything here
 * comes from the server's `details` (the same data the read-back was built from), never the chat.
 */
export function CalendarPane({
  kind,
  details,
}: {
  kind: PendingCard["kind"];
  details: CardDetails;
}) {
  const cancel = kind === "cancel";
  return (
    <section
      data-testid="calendar-pane"
      aria-label={TITLE[kind]}
      className="fd-slide-in flex h-full flex-col rounded-2xl border border-border bg-card shadow-[0_30px_60px_-30px_rgb(59_13_12/0.25)]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex flex-col">
          <span className="text-xs tracking-[0.12em] text-muted-foreground uppercase">
            {TITLE[kind]}
          </span>
          <span className="font-medium">{details.date}</span>
        </div>
        <span className="fd-later flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-medium whitespace-nowrap text-success [animation-delay:1.3s]">
          <Icon name="check" className="size-3.5" />
          Google Calendar
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        <ol
          className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 text-xs"
          aria-label="That evening"
        >
          {details.times.map((t) => {
            const mine = t === details.time;
            return (
              <li key={t} className="contents">
                <span className="text-right leading-8 text-muted-foreground tabular-nums">{t}</span>
                <span
                  data-kind={kind}
                  className={cn(
                    "relative h-8 overflow-hidden rounded-lg bg-muted",
                    mine && "fd-slot",
                  )}
                >
                  {mine && (
                    <span
                      data-testid="booked-slot"
                      className={cn(
                        "fd-later absolute inset-0 flex items-center px-3 font-semibold text-primary-foreground [animation-delay:1.1s]",
                        cancel && "line-through",
                      )}
                    >
                      {details.name} · party of {details.partySize}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 text-sm">
          <Field label="Guest" value={details.name} />
          <Field
            label="Party"
            value={`${details.partySize} ${details.partySize === 1 ? "person" : "people"}`}
          />
          <Field label="Date" value={details.date} />
          <Field label="Time" value={details.time} />
          {details.from && (
            <div className="col-span-2">
              <dt className="text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
                Moved from
              </dt>
              <dd className="text-muted-foreground line-through">
                {details.from.date} at {details.from.time}
                {details.from.partySize !== details.partySize &&
                  `, party of ${details.from.partySize}`}
              </dd>
            </div>
          )}
        </dl>

        <ul className="flex flex-col gap-2 text-[13px]">
          {CHECKS[kind].map((text, i) => (
            <li
              key={text}
              className="fd-later flex items-center gap-2"
              style={{ animationDelay: `${1.8 + i * 0.4}s` }}
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                <Icon name="check" className="size-3" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] tracking-[0.1em] text-muted-foreground uppercase">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
