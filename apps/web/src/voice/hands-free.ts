import type { VoiceController } from "./controller";
import type { Speaker } from "./speaker";
import type { Vad } from "./vad";
import type { Timers } from "./web-speech";

/** Speech this long over the agent is a real barge-in; shorter ("mm-hm", a cough) is not. */
export const COMMIT_MS = 250;
/** With nothing said for this long, hands-free switches itself off (frees the mic). */
export const IDLE_MS = 30_000;

export interface HandsFreeDeps {
  controller: VoiceController;
  speaker: Speaker;
  /** A VAD on the echo-cancelled mic, used while the agent thinks or speaks. */
  vad: Vad;
  isChatBusy(): boolean;
  timers: Timers;
  now(): number;
  onChange?(on: boolean): void;
}

/**
 * Hands-free conversation (spec §5.5): tap once, then just talk. When the agent has finished
 * replying, the mic opens again by itself. While it thinks or speaks, a VAD listens for the
 * caller talking over it: the agent's voice is ducked at once, and only if the caller keeps
 * talking for `COMMIT_MS` is it a barge-in (the controller's usual `press`: stop speech,
 * `interrupt`, listen). Everything is sent through the same VoiceController, so a spoken "yes"
 * still only ever reaches the agent as caller text.
 */
export class HandsFree {
  private _on = false;
  private monitoring = false;
  private commit: unknown;
  private lastActivity = 0;
  /** Caller text was sent and its turn hasn't ended yet (the chat may not show busy yet). */
  private awaitingReply = false;
  /** The agent was thinking or speaking at the last update. */
  private agentActive = false;
  /** We're inside a controller call; its own status/speech changes mustn't trigger another. */
  private acting = false;

  constructor(private readonly d: HandsFreeDeps) {}

  get on(): boolean {
    return this._on;
  }

  start(): void {
    if (this._on) return;
    this._on = true;
    this.lastActivity = this.d.now();
    this.d.onChange?.(true);
    this.update();
  }

  stop(): void {
    if (!this._on) return;
    this._on = false;
    this.stopMonitor();
    if (this.d.controller.status === "listening") this.act(() => this.d.controller.press(false));
    this.d.onChange?.(false);
  }

  /** The caller said something that was sent. */
  heard(): void {
    this.lastActivity = this.d.now();
    this.awaitingReply = true;
  }

  /** The turn ended (`turn_metrics`, `interrupted` or `error`): its reply is all queued. */
  turnDone(): void {
    this.awaitingReply = false;
    this.update();
  }

  /** Something changed (listening state, speech, chat busy): decide what to do next. */
  update(): void {
    if (!this._on || this.acting) return;
    const { controller, speaker } = this.d;
    const status = controller.status;
    if (status === "listening") {
      this.stopMonitor();
      return;
    }
    if (status !== "idle") {
      // Mic denied, unsupported or broken: hands-free can't work.
      this.stop();
      return;
    }
    if (this.awaitingReply || speaker.speaking || this.d.isChatBusy()) {
      this.agentActive = true;
      this.startMonitor();
      return;
    }
    if (this.agentActive) {
      // The agent thinking or talking isn't silence: the idle clock starts when it goes quiet.
      this.agentActive = false;
      this.lastActivity = this.d.now();
    }
    if (this.d.now() - this.lastActivity > IDLE_MS) {
      this.stop();
      return;
    }
    this.stopMonitor();
    this.act(() => controller.press(false));
  }

  private act(fn: () => void): void {
    this.acting = true;
    try {
      fn();
    } finally {
      this.acting = false;
    }
    // Catch up once on what the call changed (e.g. the mic failed to start).
    this.update();
  }

  private startMonitor(): void {
    if (this.monitoring) return;
    this.monitoring = true;
    void this.d.vad
      .start({
        onSpeechStart: () => {
          if (!this.monitoring) return;
          this.d.speaker.duck(true);
          this.clearCommit();
          this.commit = this.d.timers.set(() => {
            this.commit = undefined;
            this.bargeIn();
          }, COMMIT_MS);
        },
        onSpeechEnd: () => {
          if (this.commit === undefined) return;
          // Too short to be the caller taking the turn: carry on at full volume.
          this.clearCommit();
          this.d.speaker.duck(false);
        },
      })
      .catch(() => {
        // No VAD: the caller can still tap to barge in.
        this.monitoring = false;
      });
  }

  private bargeIn(): void {
    this.d.speaker.duck(false);
    this.stopMonitor();
    this.lastActivity = this.d.now();
    this.awaitingReply = false;
    // The controller's barge-in: stops speech, sends `interrupt`, starts listening.
    this.act(() => this.d.controller.press(this.d.isChatBusy()));
  }

  private stopMonitor(): void {
    this.clearCommit();
    if (!this.monitoring) return;
    this.monitoring = false;
    this.d.vad.stop();
  }

  private clearCommit(): void {
    if (this.commit !== undefined) this.d.timers.clear(this.commit);
    this.commit = undefined;
  }
}
