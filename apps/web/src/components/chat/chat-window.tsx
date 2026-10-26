"use client";

import { useEffect, useRef } from "react";
import { useChat } from "@/chat/use-chat";
import { useTurnstile } from "@/chat/use-turnstile";
import { useVoice } from "@/voice/use-voice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Composer } from "./composer";
import { Button } from "@/components/ui/button";
import { ConfirmationCard } from "./confirmation-card";
import { FeedbackForm } from "./feedback-form";
import { HandoffBanner } from "./handoff-banner";
import { LatencyBadge } from "./latency-badge";
import { MessageList } from "./message-list";
import { DROPPED_NOTICE, MicButton, VOICE_NOTICE } from "./mic-button";

const STATUS = {
  connecting: "Connecting…",
  open: "Connected",
  reconnecting: "Reconnecting…",
  replaced: "Open in another tab",
  limited: "Unavailable",
  bot_check_failed: "Unavailable",
} as const;

export function ChatWindow({
  url,
  businessName,
  turnstileSiteKey,
}: {
  url: string;
  businessName: string;
  /** Cloudflare Turnstile's public site key (M10); no bot check when empty. */
  turnstileSiteKey?: string;
}) {
  const turnstile = useTurnstile(turnstileSiteKey || undefined);
  const chat = useChat(url, turnstile.botToken);
  const { state } = chat;
  const voice = useVoice(chat);
  const ended = state.feedback !== undefined;
  const closed = state.status !== "open" || state.handoff !== undefined || ended;
  // Ending is offered once the receptionist has said something and nothing is mid-flight.
  const canEnd =
    !ended && !state.busy && state.messages.some((m) => m.role === "agent") && !state.handoff;
  // Typed text and card buttons: same path as before; voice hears that turn's reply too.
  const send = (text: string) => {
    const ok = chat.send(text);
    if (ok) voice.typed();
    return ok;
  };
  const reply = (text: string) => void send(text);
  const voiceNotice = voice.dropped ? DROPPED_NOTICE : VOICE_NOTICE[voice.status];
  const end = useRef<HTMLDivElement>(null);
  const last = state.messages.at(-1);
  // Follow the newest content: a new or growing reply, the card and its outcome, the banner.
  // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect may only
  // return a cleanup function.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [state.messages.length, last?.text, state.busy, state.pending, state.handoff, state.feedback]);

  return (
    <Card className="mx-auto flex h-[min(720px,calc(100dvh-2rem))] w-full max-w-xl flex-col">
      <CardHeader className="flex-row items-start justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle className="font-heading text-xl tracking-wide">{businessName}</CardTitle>
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
        {state.feedback && state.feedback !== "skipped" && (
          <FeedbackForm
            status={state.feedback}
            onSend={chat.sendFeedback}
            onSkip={chat.skipFeedback}
          />
        )}
        <div ref={end} />
      </CardContent>
      <div className="flex flex-col gap-2 px-4">
        {turnstileSiteKey && <div ref={turnstile.el} data-testid="turnstile" />}
        {turnstile.failed && (
          <p role="alert" className="text-xs text-destructive">
            The security check couldn&apos;t load. Please disable blockers for this site and reload.
          </p>
        )}
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
        <div className="flex min-h-8 items-center justify-between">
          {canEnd ? (
            <Button type="button" variant="ghost" size="sm" onClick={chat.endChat}>
              End chat
            </Button>
          ) : (
            <span />
          )}
          {state.lastLatency && <LatencyBadge latency={state.lastLatency} voice={voice.latency} />}
        </div>
      </div>
    </Card>
  );
}
