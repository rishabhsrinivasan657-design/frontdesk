"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
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
  const input = useRef<HTMLInputElement>(null);
  // A disabled input loses focus; give it back when the reply is done so typing just works.
  useEffect(() => {
    if (!disabled) input.current?.focus();
  }, [disabled]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (onSend(text)) setText("");
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        ref={input}
        data-testid="composer-input"
        aria-label="Message"
        placeholder="Type a message…"
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
      />
      <Button type="submit" disabled={disabled || !text.trim()}>
        Send
      </Button>
    </form>
  );
}
