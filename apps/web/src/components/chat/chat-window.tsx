"use client";

import { useEffect, useRef } from "react";
import { useChat } from "@/chat/use-chat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Composer } from "./composer";
import { ConfirmationCard } from "./confirmation-card";
import { HandoffBanner } from "./handoff-banner";
import { LatencyBadge } from "./latency-badge";
import { MessageList } from "./message-list";

const STATUS = {
  connecting: "Connecting…",
  open: "Connected",
  reconnecting: "Reconnecting…",
  replaced: "Open in another tab",
} as const;

export function ChatWindow({ url, businessName }: { url: string; businessName: string }) {
  const { state, send } = useChat(url);
  const closed = state.status !== "open" || state.handoff !== undefined;
  const reply = (text: string) => void send(text);
  const end = useRef<HTMLDivElement>(null);
  const last = state.messages.at(-1);
  // Follow the newest content: a new or growing reply, the card and its outcome, the banner.
  // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect may only
  // return a cleanup function.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [state.messages.length, last?.text, state.busy, state.pending, state.handoff]);

  return (
    <Card className="mx-auto flex h-[min(720px,calc(100dvh-2rem))] w-full max-w-xl flex-col">
      <CardHeader className="flex-row items-start justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>{businessName}</CardTitle>
          <CardDescription>Chat with our receptionist to book a table.</CardDescription>
        </div>
        <Badge data-testid="connection" variant={state.status === "open" ? "outline" : "secondary"}>
          {STATUS[state.status]}
        </Badge>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <MessageList messages={state.messages} typing={state.busy} />
        {state.pending && (
          <ConfirmationCard card={state.pending} disabled={closed || state.busy} onReply={reply} />
        )}
        {state.handoff && <HandoffBanner message={state.handoff.message} />}
        <div ref={end} />
      </CardContent>
      <div className="flex flex-col gap-2 px-4">
        {state.notice && (
          <p role="alert" className="text-xs text-destructive">
            {state.notice}
          </p>
        )}
        <Composer disabled={closed || state.busy} onSend={send} />
        <div className="flex h-4 justify-end">
          {state.lastLatency && <LatencyBadge latency={state.lastLatency} />}
        </div>
      </div>
    </Card>
  );
}
