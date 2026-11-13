import { Fragment } from "react";
import type { VoiceStatus } from "@/voice/controller";
import { cn } from "@/lib/utils";
import { ORB_CAPTION, type OrbState } from "./orb-state";

export const DROPPED_NOTICE =
  "The receptionist had already answered, so that wasn't sent. Listen, then tap the orb again.";

export const VOICE_NOTICE: Partial<Record<VoiceStatus, string>> = {
  unsupported:
    "Voice isn't available in this browser. Try Chrome, Edge or Safari — or just type below.",
  denied: "Microphone access is blocked. Allow it in your browser to talk, or just type below.",
  error: "Voice stopped working. Tap the orb to try again, or just type below.",
};

/**
 * Push-to-talk, as the page's centrepiece: tap, speak, and it sends when you pause (or tap again).
 * Tapping while the receptionist talks is barge-in. Its look follows `state` and nothing else.
 */
export function Orb({
  state,
  disabled,
  compact,
  handsFree = false,
  onPress,
}: {
  state: OrbState;
  disabled: boolean;
  compact: boolean;
  /** A hands-free conversation is on: no need to tap, just talk. */
  handsFree?: boolean;
  onPress: () => void;
}) {
  const caption =
    handsFree && state === "idle" ? "Hands-free · just start talking" : ORB_CAPTION[state];
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        data-testid="mic-button"
        data-state={state}
        aria-pressed={state === "listening"}
        aria-label={caption}
        disabled={disabled || state === "unavailable"}
        onClick={onPress}
        className={cn(
          "fd-orb outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
          "transition-[width,height] duration-700",
          compact ? "size-28 lg:size-36" : "size-36 sm:size-48",
        )}
      >
        <span className="fd-orb-float">
          <span className="fd-orb-ball" />
          <span className="fd-orb-ring" />
          <span className="fd-orb-ring" />
          <span className="fd-orb-ring" />
        </span>
      </button>
      <div className="mt-2 flex h-5 items-center" aria-hidden>
        {state === "speaking" && (
          <span className="fd-bars flex h-5 items-center gap-1">
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {caption}
      </p>
    </div>
  );
}

/** What the recogniser hears so far, word by word. Words already shown keep their place. */
export function LiveTranscript({ text }: { text: string }) {
  return (
    <p
      data-testid="interim-transcript"
      className="min-h-8 max-w-md text-center text-xl leading-snug text-foreground"
    >
      {text.split(/\s+/).map((w, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="fd-word">{w}</span>
        </Fragment>
      ))}
    </p>
  );
}

/** Hands-free: tap once, then just talk; the mic reopens after each reply and talking over the
 * receptionist interrupts it. */
export function HandsFreeButton({
  on,
  disabled,
  onToggle,
}: {
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="hands-free-button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-secondary",
      )}
    >
      {on ? "End conversation" : "🎧 Hands-free conversation"}
    </button>
  );
}
