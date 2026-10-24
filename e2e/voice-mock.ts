import { type Page, expect } from "@playwright/test";

export interface VoiceMockOptions {
  /** False: recognition is missing, as in Firefox. */
  supported?: boolean;
  /** The microphone permission is refused. */
  deny?: boolean;
  /** Each sentence keeps "playing" until cancelled, so a test can barge in. */
  holdSpeech?: boolean;
}

/** What the test can read and drive in the page (window.__voiceTest). */
export interface VoiceTest {
  spoken: string[];
  cancels: number;
  listening: boolean;
  hear(partial: string): void;
  finish(text: string): Promise<void>;
}

type Handlers = {
  onSpeechStart(): void;
  onInterim(text: string): void;
  onFinal(text: string, timings: { speechEnd?: number; sttFinal: number }): void;
  onError(error: string): void;
  onEnd(): void;
};

/**
 * Mocks voice at the SpeechToText / TextToSpeech interfaces (spec §13) through the e2e-only
 * `window.__frontdeskVoice` hook. Runs before the page's own scripts.
 */
export async function installVoiceMock(page: Page, opts: VoiceMockOptions = {}): Promise<void> {
  await page.addInitScript((o: VoiceMockOptions) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let handlers: Handlers | undefined;
    let playing: { onStart(): void; onEnd(): void } | undefined;
    const test = {
      spoken: [] as string[],
      cancels: 0,
      listening: false,
      hear(partial: string) {
        handlers?.onSpeechStart();
        handlers?.onInterim(partial);
      },
      async finish(text: string) {
        const h = handlers;
        if (!h) throw new Error("not listening");
        const speechEnd = Date.now();
        await sleep(150);
        handlers = undefined;
        test.listening = false;
        h.onFinal(text, { speechEnd, sttFinal: Date.now() });
        h.onEnd();
      },
    };
    const stt = {
      supported: o.supported ?? true,
      start(h: Handlers) {
        if (o.deny) {
          setTimeout(() => {
            h.onError("not-allowed");
            h.onEnd();
          }, 0);
          return;
        }
        handlers = h;
        test.listening = true;
      },
      stop() {
        const h = handlers;
        handlers = undefined;
        test.listening = false;
        h?.onEnd();
      },
    };
    const tts = {
      supported: true,
      speak(text: string, h: { onStart(): void; onEnd(): void }) {
        test.spoken.push(text);
        playing = h;
        setTimeout(() => {
          if (playing !== h) return;
          h.onStart();
          if (o.holdSpeech) return;
          setTimeout(() => {
            if (playing !== h) return;
            playing = undefined;
            h.onEnd();
          }, 20);
        }, 30);
      },
      cancel() {
        test.cancels += 1;
        const h = playing;
        playing = undefined;
        h?.onEnd();
      },
    };
    Object.assign(window, { __voiceTest: test, __frontdeskVoice: { stt, tts } });
  }, opts);
}

const voiceTest = (page: Page) =>
  page.evaluate(() => {
    const t = (window as unknown as { __voiceTest: VoiceTest }).__voiceTest;
    return { spoken: [...t.spoken], cancels: t.cancels, listening: t.listening };
  });

export const spoken = async (page: Page) => (await voiceTest(page)).spoken;
export const cancels = async (page: Page) => (await voiceTest(page)).cancels;

/** Presses the mic once the chat is free, waits until it listens, and starts an utterance. */
export async function startSpeaking(page: Page, partial: string): Promise<void> {
  await expect(page.getByTestId("composer-input")).toBeEnabled();
  await page.getByTestId("mic-button").click();
  await expect.poll(async () => (await voiceTest(page)).listening).toBe(true);
  await page.evaluate(
    (p) => (window as unknown as { __voiceTest: VoiceTest }).__voiceTest.hear(p),
    partial,
  );
}

export async function finishSpeaking(page: Page, text: string): Promise<void> {
  await page.evaluate(
    (t) => (window as unknown as { __voiceTest: VoiceTest }).__voiceTest.finish(t),
    text,
  );
}

/** One whole utterance: press the mic, speak, stop. */
export async function speak(page: Page, text: string): Promise<void> {
  await startSpeaking(page, text.slice(0, Math.ceil(text.length / 2)));
  await finishSpeaking(page, text);
}
