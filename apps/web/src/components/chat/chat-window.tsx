"use client";

import { useEffect, useRef } from "react";
import { useChat } from "@/chat/use-chat";
import { useVoice } from "@/voice/use-voice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Composer } from "./composer";
import { ConfirmationCard } from "./confirmation-card";
import { HandoffBanner } from "./handoff-banner";
import { LatencyBadge } from "./latency-badge";
import { MessageList } from "./message-list";
import { MicButton, VOICE_NOTICE } from "./mic-button";

const STATUS = {
  connecting: "Connecting…",
  open: "Connected",
  reconnecting: "Reconnecting…",
  replaced: "Open in another tab",
} as const;

export function ChatWindow({ url, businessName }: { url: string; businessName: string }) {
  const chat = useChat(url);
  const { state } = chat;
  const voice = useVoice(chat);
  const closed = state.status !== "open" || state.handoff !== undefined;
  // Typed text and card buttons: same path as before; voice hears that turn's reply too.
  const send = (text: string) => {
    const ok = chat.send(text);
    if (ok) voice.typed();
    return ok;
  };
  const reply = (text: string) => void send(text);
  const voiceNotice = VOICE_NOTICE[voice.status];
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
          <CardDescription>Chat or talk with our receptionist to book a table.</CardDescription>
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
        {voiceNotice && (
          <p data-testid="voice-notice" className="text-xs text-muted-foreground">
            {voiceNotice}
          </p>
        )}
        {voice.interim && (
          <p data-testid="interim-transcript" className="text-sm text-muted-foreground italic">
            {voice.interim}
          </p>
        )}
        <div className="flex gap-2">
          <div className="flex-1">
            <Composer disabled={closed || state.busy} onSend={send} />
          </div>
          {/* Usable while we answer: pressing it then is barge-in. */}
          <MicButton status={voice.status} disabled={closed} onPress={voice.press} />
        </div>
        <div className="flex h-4 justify-end">
          {state.lastLatency && <LatencyBadge latency={state.lastLatency} voice={voice.latency} />}
        </div>
      </div>
    </Card>
  );
}
