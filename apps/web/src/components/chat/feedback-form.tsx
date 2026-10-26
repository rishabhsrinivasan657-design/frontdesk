"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const RATINGS = [1, 2, 3, 4, 5] as const;

/** The post-conversation rating (spec §12): 1–5 stars and an optional comment. */
export function FeedbackForm({
  status,
  onSend,
  onSkip,
}: {
  status: "open" | "sending" | "saved";
  onSend: (rating: number, comment: string) => void;
  onSkip: () => void;
}) {
  const [rating, setRating] = useState<number | undefined>();
  const [comment, setComment] = useState("");
  if (status === "saved") {
    return (
      <p role="status" data-testid="feedback-thanks" className="text-sm text-muted-foreground">
        Thanks for the feedback.
      </p>
    );
  }
  return (
    <form
      data-testid="feedback-form"
      className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (rating !== undefined) onSend(rating, comment.trim());
      }}
    >
      <fieldset className="flex items-center gap-1">
        <legend className="mb-1 text-sm font-medium">How did we do?</legend>
        {RATINGS.map((r) => (
          <button
            key={r}
            type="button"
            aria-label={`${r} star${r === 1 ? "" : "s"}`}
            aria-pressed={rating === r}
            onClick={() => setRating(r)}
            className={cn(
              "size-9 cursor-pointer rounded-md text-xl leading-none",
              rating !== undefined && r <= rating ? "text-accent" : "text-muted-foreground",
            )}
          >
            ★
          </button>
        ))}
      </fieldset>
      <Textarea
        aria-label="Comment (optional)"
        placeholder="Anything we could do better? (optional)"
        maxLength={1000}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
          Skip
        </Button>
        <Button type="submit" size="sm" disabled={rating === undefined || status === "sending"}>
          Send
        </Button>
      </div>
    </form>
  );
}
