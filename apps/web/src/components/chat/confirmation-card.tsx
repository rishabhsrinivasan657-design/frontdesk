import type { PendingCard } from "@/chat/state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** The words the buttons send. They go through the confirmation gate like any typed reply. */
export const CONFIRM_TEXT = "Yes, please";
export const CHANGE_TEXT = "I'd like to change something";

const TITLES = { book: "New booking", reschedule: "Move booking", cancel: "Cancel booking" };
const DONE = { book: "Booked", reschedule: "Rescheduled", cancel: "Cancelled" };

function outcomeLabel(card: PendingCard): string {
  if (card.outcome === "executed") return DONE[card.kind];
  if (card.outcome === "failed") return "Not completed";
  return "Withdrawn";
}

export function ConfirmationCard({
  card,
  disabled,
  onReply,
}: {
  card: PendingCard;
  disabled: boolean;
  onReply: (text: string) => void;
}) {
  const done = card.outcome === "executed";
  return (
    <div
      data-testid="confirmation-card"
      className={cn(
        "fd-pop flex flex-col gap-3 rounded-2xl border-[1.5px] p-4 transition-colors duration-500",
        done
          ? "border-success/35 bg-success-soft"
          : card.outcome
            ? "border-border bg-muted/60"
            : "border-dashed border-primary/45 bg-[#fffaf5]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-semibold tracking-[0.12em] uppercase",
          done ? "text-success" : card.outcome ? "text-muted-foreground" : "text-primary",
        )}
      >
        {done && <Icon name="check" className="size-3.5" />}
        {TITLES[card.kind]}
      </div>
      {card.details ? (
        <div className="flex flex-col gap-0.5" data-testid="confirmation-summary">
          <p
            className={cn(
              "text-[15px] font-medium",
              card.kind === "cancel" && done && "text-muted-foreground line-through",
            )}
          >
            {card.details.date} · {card.details.time} · Party of {card.details.partySize} ·{" "}
            {card.details.name}
          </p>
          {card.details.from && (
            <p className="text-xs text-muted-foreground">
              Moved from {card.details.from.date} at {card.details.from.time}
            </p>
          )}
        </div>
      ) : (
        // Servers from before the calendar view send only the read-back sentence.
        <p className="text-sm leading-relaxed" data-testid="confirmation-summary">
          {card.summary}
        </p>
      )}
      <div className="flex items-center gap-2">
        {card.outcome ? (
          <Badge
            data-testid="action-status"
            variant={done ? "default" : "secondary"}
            className={cn(done && "bg-success text-white")}
          >
            {outcomeLabel(card)}
          </Badge>
        ) : (
          <>
            <Button size="sm" disabled={disabled} onClick={() => onReply(CONFIRM_TEXT)}>
              Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => onReply(CHANGE_TEXT)}
            >
              Change
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
