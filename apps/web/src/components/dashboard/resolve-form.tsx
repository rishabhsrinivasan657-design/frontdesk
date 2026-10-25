"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ERRORS: Record<number, string> = {
  400: "Add a short note about what you did (up to 2000 characters).",
  404: "This handoff no longer exists.",
  409: "Someone already resolved this handoff.",
};

/** Resolve a handoff with the owner's notes (spec §10 Handoffs). */
export function ResolveForm({ id }: { id: string }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch(`/api/owner/handoffs/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    }).catch(() => null);
    if (res?.status === 204 || res?.status === 409) {
      router.refresh();
      return;
    }
    setError((res && ERRORS[res.status]) ?? "Couldn't save. Try again in a moment.");
    setPending(false);
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-2">
      <Label htmlFor={`notes-${id}`}>What did you do?</Label>
      <Textarea
        id={`notes-${id}`}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
        placeholder="e.g. Called back and booked the private room for Friday."
        rows={2}
        className="placeholder:text-muted-foreground/60"
      />
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || notes.trim() === ""}>
          {pending ? "Saving…" : "Mark resolved"}
        </Button>
      </div>
    </form>
  );
}
