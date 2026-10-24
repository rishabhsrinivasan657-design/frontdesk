import type { PendingCard } from "@/chat/state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

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
  return (
    <Card data-testid="confirmation-card" className="border-primary/30">
      <CardHeader>
        <CardTitle className="text-sm">{TITLES[card.kind]}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm" data-testid="confirmation-summary">
        {card.summary}
      </CardContent>
      <CardFooter>
        {card.outcome ? (
          <Badge
            data-testid="action-status"
            variant={card.outcome === "executed" ? "default" : "secondary"}
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
      </CardFooter>
    </Card>
  );
}
