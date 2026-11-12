import type { VoiceStatus } from "@/voice/controller";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "unavailable";

/**
 * What the orb shows. Every state maps to something real: the open microphone, the speaker's
 * queue playing, or a turn running on the server. Listening wins, because pressing the orb
 * during a reply is barge-in and the caller should see they're being heard.
 */
export function orbState(s: { voice: VoiceStatus; speaking: boolean; busy: boolean }): OrbState {
  if (s.voice === "listening") return "listening";
  if (s.speaking) return "speaking";
  if (s.busy) return "thinking";
  if (s.voice === "idle") return "idle";
  return "unavailable";
}

export const ORB_CAPTION: Record<OrbState, string> = {
  idle: "Tap to talk",
  listening: "Listening… tap to send",
  thinking: "Checking…",
  speaking: "Speaking · tap to interrupt",
  unavailable: "Voice is off · type below",
};
