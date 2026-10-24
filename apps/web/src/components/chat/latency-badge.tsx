import type { Latency } from "@/chat/state";
import type { VoiceLatency } from "@/voice/use-voice";

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The last turn's speed: speech-to-text and speech start (voice), first reply as the browser saw
 * it, and the server's whole turn.
 */
export function LatencyBadge({ latency, voice = {} }: { latency: Latency; voice?: VoiceLatency }) {
  const parts = [
    ...(voice.sttMs !== undefined ? [`stt ${formatMs(voice.sttMs)}`] : []),
    ...(latency.firstReplyMs !== undefined
      ? [`first reply ${formatMs(latency.firstReplyMs)}`]
      : []),
    ...(voice.ttsStartMs !== undefined ? [`speech start ${formatMs(voice.ttsStartMs)}`] : []),
    `total ${formatMs(latency.totalMs)}`,
  ];
  return (
    <span data-testid="latency" className="text-xs text-muted-foreground tabular-nums">
      {parts.join(" · ")}
    </span>
  );
}
