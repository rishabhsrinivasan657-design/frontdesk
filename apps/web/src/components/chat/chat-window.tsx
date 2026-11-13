"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatState } from "@/chat/state";
import { useChat } from "@/chat/use-chat";
import { useTurnstile } from "@/chat/use-turnstile";
import { wakeApi, wakingUp } from "@/chat/wake";
import { useVoice } from "@/voice/use-voice";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { CalendarPane } from "@/components/talk/calendar-pane";
import {
  DROPPED_NOTICE,
  HandsFreeButton,
  LiveTranscript,
  Orb,
  VOICE_NOTICE,
} from "@/components/talk/orb";
import { orbState } from "@/components/talk/orb-state";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import { ConfirmationCard } from "./confirmation-card";
import { FeedbackForm } from "./feedback-form";
import { HandoffBanner } from "./handoff-banner";
import { LatencyBadge } from "./latency-badge";
import { MessageList } from "./message-list";

const STATUS = {
  connecting: "Connecting…",
  open: "Connected",
  reconnecting: "Reconnecting…",
  replaced: "Open in another tab",
  limited: "Unavailable",
  bot_check_failed: "Unavailable",
  unreachable: "Unavailable",
} as const;

const WAKING_NOTICE =
  "Waking up the receptionist. After a quiet spell our free server takes about a minute to start.";

/** Whether to explain a slow first connection (see chat/wake.ts); re-checked every second. */
function useWaking(url: string, status: ChatState["status"]): boolean {
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(mountedAt);
  const everOpened = useRef(false);
  if (status === "open") everOpened.current = true;
  useEffect(() => wakeApi(url), [url]);
  const settled = everOpened.current || status === "limited" || status === "bot_check_failed";
  useEffect(() => {
    if (settled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [settled]);
  return wakingUp(status, everOpened.current, now - mountedAt);
}

/**
 * The guest's page: the orb alone at first; the conversation pane slides in once someone speaks
 * or types; the calendar pane slides in once the gate has written a booking (launch polish).
 */
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
  // A refusal the server explained wins over the "waking up" note.
  const waking = useWaking(url, state.status) && !state.notice;
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
  const orb = orbState({ voice: voice.status, speaking: voice.agentSpeaking, busy: state.busy });
  const talking = state.messages.length > 0;
  const executed =
    state.pending?.outcome === "executed" && state.pending.details ? state.pending : undefined;
  // The card sits right under the read-back it belongs to, so "yes" and the reply follow it.
  const readBackAt = state.pending
    ? state.messages.findLastIndex(
        (m) => m.role === "agent" && m.text.trim() === state.pending!.summary.trim(),
      )
    : -1;
  const cardAt = readBackAt >= 0 ? readBackAt + 1 : state.messages.length;
  // Dots only until the reply's first words arrive; then the words themselves show progress.
  const typing = state.busy && state.messages.at(-1)?.role === "caller";

  const end = useRef<HTMLDivElement>(null);
  const last = state.messages.at(-1);
  // Follow the newest content: a new or growing reply, the card and its outcome, the banner.
  // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect may only
  // return a cleanup function.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [state.messages.length, last?.text, state.busy, state.pending, state.handoff, state.feedback]);

  const notices = (
    <>
      {turnstile.failed && (
        <p role="alert" className="text-xs text-destructive">
          The security check couldn&apos;t load. Please disable blockers for this site and reload.
        </p>
      )}
      {waking ? (
        <p data-testid="waking-notice" role="status" className="text-xs text-muted-foreground">
          {WAKING_NOTICE}
        </p>
      ) : (
        state.notice && (
          <p role="alert" className="text-xs text-destructive">
            {state.notice}
          </p>
        )
      )}
      {voiceNotice && (
        <p data-testid="voice-notice" className="text-xs text-muted-foreground">
          {voiceNotice}
        </p>
      )}
    </>
  );
  const composer = (
    <Composer
      disabled={closed || state.busy}
      onSend={send}
      placeholder={talking ? "Type a message…" : "Or type a message…"}
    />
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 px-4 pt-5 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Icon name="utensils" className="size-5" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-heading text-xl font-bold tracking-wide">{businessName}</span>
            <span className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">
              AI receptionist
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              state.status === "open" ? "bg-success" : "animate-pulse bg-warning",
            )}
          />
          <span data-testid="connection">{waking ? "Waking up…" : STATUS[state.status]}</span>
        </div>
      </header>

      <div
        className={cn(
          "grid flex-1 grid-cols-1 gap-6 px-4 py-6 sm:px-8",
          "lg:min-h-0 lg:transition-[grid-template-columns] lg:duration-700 lg:ease-[cubic-bezier(.2,.8,.2,1)]",
          executed
            ? "lg:grid-cols-[minmax(220px,0.6fr)_1fr_0.9fr]"
            : talking
              ? "lg:grid-cols-[1fr_1fr_0fr]"
              : "lg:grid-cols-[1fr_0fr_0fr]",
        )}
      >
        {/* The orb, what it hears, and (before the conversation starts) the type-instead box. */}
        <section
          aria-label="Talk to the receptionist"
          className={cn(
            "flex min-w-0 flex-col items-center justify-center gap-6",
            !talking && "min-h-[60dvh]",
          )}
        >
          <Orb
            state={orb}
            disabled={closed}
            compact={talking}
            handsFree={voice.handsFree}
            onPress={voice.press}
          />
          <HandsFreeButton
            on={voice.handsFree}
            disabled={closed || voice.status === "unsupported"}
            onToggle={voice.toggleHandsFree}
          />
          {voice.interim && <LiveTranscript text={voice.interim} />}
          {!talking && (
            <div className="flex w-full max-w-sm flex-col items-center gap-2">
              <p className="text-center text-sm text-muted-foreground">
                Ask about a table, the menu or our hours.
              </p>
              {composer}
              {notices}
            </div>
          )}
          {turnstileSiteKey && <div ref={turnstile.el} data-testid="turnstile" />}
        </section>

        {/* The conversation. */}
        <div className={cn("min-w-0 overflow-hidden", !talking && "hidden lg:block")}>
          {talking && (
            <section
              aria-label="Conversation"
              className="fd-slide-in flex h-[min(720px,calc(100dvh-9rem))] flex-col rounded-2xl border border-border bg-card shadow-[0_30px_60px_-30px_rgb(59_13_12/0.25)]"
            >
              <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 text-sm text-muted-foreground">
                <span>Conversation</span>
                {state.lastLatency && (
                  <span className="rounded-full bg-muted px-2.5 py-0.5">
                    <LatencyBadge latency={state.lastLatency} voice={voice.latency} />
                  </span>
                )}
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
                <MessageList messages={state.messages.slice(0, cardAt)} typing={false} />
                {state.pending && (
                  <ConfirmationCard
                    card={state.pending}
                    disabled={closed || state.busy}
                    onReply={reply}
                  />
                )}
                <MessageList messages={state.messages.slice(cardAt)} typing={typing} />
                {state.handoff && <HandoffBanner message={state.handoff.message} />}
                {state.feedback && state.feedback !== "skipped" && (
                  <FeedbackForm
                    status={state.feedback}
                    onSend={chat.sendFeedback}
                    onSkip={chat.skipFeedback}
                  />
                )}
                <div ref={end} />
              </div>
              <footer className="flex flex-col gap-2 border-t border-border px-4 py-3">
                {notices}
                {composer}
                {canEnd && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={chat.endChat}
                  >
                    End chat
                  </Button>
                )}
              </footer>
            </section>
          )}
        </div>

        {/* What was just written to the restaurant's calendar. */}
        <div className={cn("min-w-0 overflow-hidden", !executed && "hidden lg:block")}>
          {executed && (
            <div className="h-[min(720px,calc(100dvh-9rem))]">
              <CalendarPane kind={executed.kind} details={executed.details!} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
