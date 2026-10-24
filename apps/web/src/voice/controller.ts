import type { Speaker } from "./speaker";
import type { SpeechToText, SttHandlers } from "./types";

export type VoiceStatus = "idle" | "listening" | "unsupported" | "denied" | "error";

type Timings = { speechEnd?: number; sttFinal: number };

export interface VoiceControllerDeps {
  stt: SpeechToText;
  speaker: Speaker;
  /** Sends caller text, exactly like typing. False if the chat can't take it yet. */
  sendText(text: string, timings: Timings): boolean;
  sendInterrupt(): void;
  onStatus(status: VoiceStatus): void;
  onInterim(text: string): void;
  onSttMs(ms: number | undefined): void;
  /** A transcript was not sent: the reply it barged in on couldn't be cancelled. */
  onDropped(): void;
}

/**
 * Push-to-talk voice for the chat (spec §8). The only thing it can send besides `interrupt` is
 * the caller's transcript as text, so a spoken "yes" reaches the same gate and classifier as a
 * typed one. Pressing the mic while we speak or think is barge-in.
 */
export class VoiceController {
  private _status: VoiceStatus;
  private _used = false;
  /** A final transcript the chat couldn't take yet (the interrupted turn is still unwinding). */
  private held: { text: string; timings: Timings } | undefined;
  /** We barged in on a turn in flight and don't yet know if the server could cancel it. */
  private cancelling = false;
  /** The utterance in progress started before an uncancellable reply: don't send it. */
  private stale = false;

  constructor(private readonly deps: VoiceControllerDeps) {
    this._status = deps.stt.supported ? "idle" : "unsupported";
  }

  get status(): VoiceStatus {
    return this._status;
  }

  /** True once the caller has used the mic; replies are spoken from then on. */
  get used(): boolean {
    return this._used;
  }

  press(chatBusy: boolean): void {
    if (this._status === "unsupported") return;
    if (this._status === "listening") {
      this.deps.stt.stop();
      return;
    }
    this._used = true;
    this.stale = false;
    if (this.deps.speaker.speaking || chatBusy) this.bargeIn();
    if (chatBusy) this.cancelling = true;
    this.setStatus("listening");
    this.deps.stt.start(this.handlers());
  }

  /** The chat finished a turn (or its cancellation): send a held transcript now. */
  chatIdle(): void {
    this.flush();
  }

  /**
   * The turn we may have barged in on ended. `interrupted`: cancelled, so what the caller said
   * goes through. `completed`: the server couldn't cancel it (a booking executed, a read-back
   * sent), so the caller hears that reply first, and what they said before hearing it is not
   * sent: it must never be classified against a read-back they didn't hear.
   */
  turnEnded(how: "interrupted" | "completed"): void {
    if (!this.cancelling) return;
    this.cancelling = false;
    if (how === "interrupted") return;
    this.deps.speaker.replay();
    if (this.held) {
      this.held = undefined;
      this.deps.onDropped();
    } else if (this._status === "listening") {
      this.stale = true;
    }
  }

  /** The caller typed or clicked instead: forget anything spoken but unsent. */
  typed(): void {
    this.held = undefined;
    this.stale = false;
    this.cancelling = false;
    this.deps.speaker.unmute();
  }

  /** The socket dropped: a held transcript belongs to a conversation state that's gone. */
  reset(): void {
    this.held = undefined;
    this.cancelling = false;
  }

  private bargeIn(): void {
    this.deps.speaker.stop();
    this.deps.sendInterrupt();
  }

  private handlers(): SttHandlers {
    return {
      onSpeechStart: () => {
        if (this.deps.speaker.speaking) this.bargeIn();
      },
      onInterim: (text) => this.deps.onInterim(text),
      onFinal: (text, timings) => {
        this.deps.onInterim("");
        this.deps.onSttMs(
          timings.speechEnd !== undefined ? timings.sttFinal - timings.speechEnd : undefined,
        );
        if (this.stale) {
          this.stale = false;
          this.deps.onDropped();
          return;
        }
        this.held = { text, timings };
        this.flush();
      },
      onError: (error) => {
        this.deps.onInterim("");
        if (error === "not-allowed") this.setStatus("denied");
        else if (error === "no-speech" || error === "aborted") this.setStatus("idle");
        else this.setStatus("error");
      },
      onEnd: () => {
        if (this._status === "listening") this.setStatus("idle");
      },
    };
  }

  private flush(): void {
    if (!this.held) return;
    if (!this.deps.sendText(this.held.text, this.held.timings)) return;
    this.held = undefined;
    // A new turn: its reply should be heard.
    this.deps.speaker.unmute();
  }

  private setStatus(status: VoiceStatus): void {
    this._status = status;
    this.deps.onStatus(status);
  }
}
