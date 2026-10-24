import type { VoiceStatus } from "@/voice/controller";
import { Button } from "@/components/ui/button";

export const VOICE_NOTICE: Partial<Record<VoiceStatus, string>> = {
  unsupported:
    "Voice isn't available in this browser. Try Chrome, Edge or Safari — or just type below.",
  denied: "Microphone access is blocked. Allow it in your browser to talk, or just type below.",
  error: "Voice stopped working. Press Speak to try again, or just type below.",
};

/** Push-to-talk: press, speak one sentence; pressing while we talk interrupts us. */
export function MicButton({
  status,
  disabled,
  onPress,
}: {
  status: VoiceStatus;
  disabled: boolean;
  onPress: () => void;
}) {
  const listening = status === "listening";
  return (
    <Button
      type="button"
      data-testid="mic-button"
      variant={listening ? "default" : "outline"}
      aria-pressed={listening}
      disabled={disabled || status === "unsupported"}
      onClick={onPress}
    >
      {listening ? "Listening…" : "Speak"}
    </Button>
  );
}
