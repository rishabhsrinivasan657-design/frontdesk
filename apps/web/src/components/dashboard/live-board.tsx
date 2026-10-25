"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Chip } from "@/components/dashboard/chips";
import { EmptyState } from "@/components/dashboard/page";
import { Icon } from "@/components/icons";
import { formatMs, relativeTime } from "@/dashboard/format";
import { type LiveCard, applyLiveEvent } from "@/dashboard/live-state";
import type { LiveEvent, LiveSession } from "@/dashboard/types";
import { cn } from "@/lib/utils";

const EVENT_TYPES: LiveEvent["type"][] = [
  "session_open",
  "session_closed",
  "turn",
  "pending",
  "pending_cleared",
  "handoff",
];

type Connection = "connecting" | "live" | "reconnecting";

/** Active conversations, streaming (spec §10 Live). Resyncs from the snapshot on every (re)connect. */
export function LiveBoard({ initial }: { initial: LiveSession[] }) {
  const [cards, setCards] = useState<LiveCard[]>(initial);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const source = new EventSource("/api/owner/live/stream");
    const resync = () =>
      fetch("/api/owner/live", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<LiveSession[]>) : null))
        .then((fresh) => fresh && setCards(fresh))
        .catch(() => undefined);
    source.onopen = () => {
      setConnection("live");
      void resync();
    };
    source.onerror = () => setConnection("reconnecting");
    const onEvent = (msg: MessageEvent<string>) => {
      const event = JSON.parse(msg.data) as LiveEvent;
      setCards((current) => applyLiveEvent(current, event));
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, onEvent);
    return () => source.close();
  }, []);

  // Countdowns and "3 min ago" stay fresh.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {cards.length === 0
            ? "No one on the line"
            : `${cards.length} ${cards.length === 1 ? "guest" : "guests"} talking now`}
        </p>
        <ConnectionPill state={connection} />
      </div>
      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card">
          <EmptyState icon="live" title="No one is talking to Front Desk right now">
            New conversations appear here the moment a guest says hello.{" "}
            <a
              href="/talk"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-2"
            >
              Open the guest chat
            </a>{" "}
            to try it.
          </EmptyState>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {cards.map((c) => (
            <LiveCardView key={c.sessionId} card={c} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectionPill({ state }: { state: Connection }) {
  const live = state === "live";
  return (
    <span
      data-testid="live-status"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        live
          ? "border-success/30 bg-success-soft text-success"
          : "border-warning/30 bg-warning-soft text-warning",
      )}
    >
      <span className="relative flex size-2">
        {live && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            live ? "bg-success" : "bg-warning",
          )}
        />
      </span>
      {live ? "Streaming" : state === "connecting" ? "Connecting…" : "Reconnecting…"}
    </span>
  );
}

function countdown(expiresAt: string, now: number): string {
  const s = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  return s === 0 ? "expired" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`;
}

function LiveCardView({ card, now }: { card: LiveCard; now: number }) {
  return (
    <li
      data-testid="live-card"
      className={cn(
        "flex flex-col rounded-xl border bg-card transition-shadow duration-200 hover:shadow-md",
        card.pending ? "border-warning/50 ring-1 ring-warning/30" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-secondary text-primary">
            <Icon name="user" />
          </span>
          <div>
            <p className="text-sm font-semibold">Guest · {card.sessionId.slice(-6)}</p>
            <p className="text-xs text-muted-foreground">
              Started {relativeTime(card.startedAt, now)} · {card.turnCount}{" "}
              {card.turnCount === 1 ? "message" : "messages"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {card.handedOff && (
            <Chip tone="warn" icon="handoffs">
              Handed off
            </Chip>
          )}
          {card.lastAction === "executed" && (
            <Chip tone="good" icon="check">
              Booked
            </Chip>
          )}
          {card.lastAction === "failed" && (
            <Chip tone="bad" icon="alert">
              Write failed
            </Chip>
          )}
          {card.lastAction === "voided" && (
            <Chip tone="neutral" icon="x">
              Changed mind
            </Chip>
          )}
        </div>
      </div>

      {card.pending && (
        <div
          data-testid="pending-badge"
          className="mx-5 mt-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning"
        >
          <p className="flex items-center gap-2 font-semibold">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-warning" />
            </span>
            Awaiting confirmation
            <span className="ml-auto font-normal tabular-nums">
              {countdown(card.pending.expiresAt, now)}
            </span>
          </p>
          <p className="mt-1 text-foreground/80">{card.pending.summary}</p>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 px-5 py-4 text-sm">
        {card.lastCallerText ? (
          <>
            <p className="flex gap-2">
              <Icon name="user" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="line-clamp-2">{card.lastCallerText}</span>
            </p>
            <p className="flex gap-2 text-muted-foreground">
              <Icon name="bot" className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="line-clamp-3">{card.lastAgentText}</span>
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">Connected, hasn&rsquo;t said anything yet.</p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
        <span>
          {card.lastFirstOutputMs != null
            ? `Last reply in ${formatMs(card.lastFirstOutputMs)}`
            : " "}
        </span>
        {card.turnCount > 0 && (
          <Link
            href={`/dashboard/conversations/${encodeURIComponent(card.sessionId)}`}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            Open conversation <Icon name="chevronRight" className="size-3.5" />
          </Link>
        )}
      </div>
    </li>
  );
}
