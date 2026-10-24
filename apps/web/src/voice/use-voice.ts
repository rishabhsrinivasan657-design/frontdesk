"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Chat } from "@/chat/use-chat";
import { VoiceController, type VoiceStatus } from "./controller";
import { createVoiceProviders } from "./providers";
import { Speaker } from "./speaker";

/** Voice stages measured in the browser, for the latency readout. */
export interface VoiceLatency {
  /** End of speech → final transcript. */
  sttMs?: number;
  /** First sentence arrived → it started playing. */
  ttsStartMs?: number;
}

/** Push-to-talk and spoken replies on top of the chat (spec §8). */
export function useVoice(chat: Chat) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [interim, setInterim] = useState("");
  const [latency, setLatency] = useState<VoiceLatency>({});
  const chatRef = useRef(chat);
  const voice = useRef<{ controller: VoiceController; speaker: Speaker } | undefined>(undefined);

  useEffect(() => {
    chatRef.current = chat;
  });

  useEffect(() => {
    const { stt, tts } = createVoiceProviders();
    const speaker = new Speaker(tts, {
      onTtsStarted: (turnId, at, sinceSentenceMs) => {
        chatRef.current.ttsStarted(turnId, at);
        setLatency((l) => ({ ...l, ttsStartMs: Math.round(sinceSentenceMs) }));
      },
      onChange: () => {},
    });
    const controller = new VoiceController({
      stt,
      speaker,
      sendText: (text, timings) => chatRef.current.send(text, timings),
      sendInterrupt: () => chatRef.current.interrupt(),
      onStatus: setStatus,
      onInterim: setInterim,
      onSttMs: (ms) => setLatency(ms !== undefined ? { sttMs: Math.round(ms) } : {}),
    });
    voice.current = { controller, speaker };
    setStatus(controller.status);
    const off = chatRef.current.onServerMessage((m) => {
      if (m.type === "agent_sentence" && controller.used) speaker.enqueue(m.turnId, m.text);
    });
    return () => {
      off();
      speaker.stop();
      stt.stop();
    };
  }, []);

  // The reply (or its cancellation) is done: a transcript held during barge-in goes now.
  useEffect(() => {
    if (!chat.state.busy) voice.current?.controller.chatIdle();
  }, [chat.state.busy]);

  const press = useCallback(() => voice.current?.controller.press(chatRef.current.state.busy), []);
  /** The caller typed or clicked instead: speak that turn's reply, drop stale voice timings. */
  const typed = useCallback(() => {
    voice.current?.speaker.unmute();
    setLatency({});
  }, []);

  return { status, interim, latency, press, typed };
}
