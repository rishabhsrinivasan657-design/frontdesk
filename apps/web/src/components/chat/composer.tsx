"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => boolean;
}) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (onSend(text)) setText("");
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        data-testid="composer-input"
        aria-label="Message"
        placeholder="Type a message…"
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        autoFocus
      />
      <Button type="submit" disabled={disabled || !text.trim()}>
        Send
      </Button>
    </form>
  );
}
