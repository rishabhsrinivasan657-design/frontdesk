"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Chat } from "@/chat/use-chat";
import { VoiceController, type VoiceStatus } from "./controller";
import { HandsFree } from "./hands-free";
import { createVoiceProviders } from "./providers";
import { Speaker } from "./speaker";
import { createSileroVad } from "./vad";

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
  /** The last transcript wasn't sent (it barged in on a reply that couldn't be cancelled). */
  const [dropped, setDropped] = useState(false);
  const chatRef = useRef(chat);
  const voice = useRef<
    | { controller: VoiceController; speaker: Speaker; handsFree: HandsFree; warmUp?: () => void }
    | undefined
  >(undefined);
  /** Hands-free conversation is on: the mic reopens by itself and talking over the agent barges in. */
  const [handsFree, setHandsFree] = useState(false);
  /** The agent is speaking (for the orb). */
  const [agentSpeaking, setAgentSpeaking] = useState(false);

  useEffect(() => {
    chatRef.current = chat;
  });

  useEffect(() => {
    const { stt, tts, warmUp } = createVoiceProviders();
    const speaker = new Speaker(tts, {
      onTtsStarted: (turnId, at, sinceSentenceMs) => {
        chatRef.current.ttsStarted(turnId, at);
        setLatency((l) => ({ ...l, ttsStartMs: Math.round(sinceSentenceMs) }));
      },
      onChange: (speaking) => {
        setAgentSpeaking(speaking);
        hands.update();
      },
    });
    const controller = new VoiceController({
      stt,
      speaker,
      sendText: (text, timings) => {
        const sent = chatRef.current.send(text, timings);
        if (sent) hands.heard();
        return sent;
      },
      sendInterrupt: () => chatRef.current.interrupt(),
      onStatus: (s) => {
        setStatus(s);
        hands.update();
      },
      onInterim: setInterim,
      onSttMs: (ms) => setLatency(ms !== undefined ? { sttMs: Math.round(ms) } : {}),
      onDropped: () => setDropped(true),
    });
    const hands: HandsFree = new HandsFree({
      controller,
      speaker,
      vad: createSileroVad(),
      isChatBusy: () => chatRef.current.state.busy,
      timers: {
        set: (fn, ms) => setTimeout(fn, ms),
        clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      now: Date.now,
      onChange: setHandsFree,
    });
    voice.current = { controller, speaker, handsFree: hands, warmUp };
    setStatus(controller.status);
    const off = chatRef.current.onServerMessage((m) => {
      if (m.type === "agent_sentence" && controller.used) speaker.enqueue(m.turnId, m.text);
      // How the turn we may have barged in on ended (see VoiceController.turnEnded).
      if (m.type === "turn_metrics") controller.turnEnded("completed");
      if (m.type === "interrupted" || m.type === "error") controller.turnEnded("interrupted");
      if (m.type === "turn_metrics" || m.type === "interrupted" || m.type === "error")
        hands.turnDone();
    });
    return () => {
      off();
      hands.stop();
      speaker.stop();
      stt.stop();
    };
  }, []);

  // The reply (or its cancellation) is done: a transcript held during barge-in goes now.
  useEffect(() => {
    if (!chat.state.busy) voice.current?.controller.chatIdle();
    voice.current?.handsFree.update();
  }, [chat.state.busy]);

  // A dropped socket: a transcript held for the old connection must not be sent on the new one.
  useEffect(() => {
    if (chat.state.status !== "open") voice.current?.controller.reset();
  }, [chat.state.status]);

  const press = useCallback(() => {
    setDropped(false);
    voice.current?.warmUp?.();
    voice.current?.controller.press(chatRef.current.state.busy);
  }, []);
  /** The caller typed or clicked instead: speak that turn's reply, forget unsent speech. */
  const typed = useCallback(() => {
    voice.current?.controller.typed();
    setDropped(false);
    setLatency({});
  }, []);

  /** Starts or ends a hands-free conversation (tap once, then just talk). */
  const toggleHandsFree = useCallback(() => {
    const v = voice.current;
    if (!v) return;
    if (v.handsFree.on) {
      v.handsFree.stop();
      return;
    }
    setDropped(false);
    v.warmUp?.();
    v.handsFree.start();
  }, []);

  return {
    status,
    interim,
    latency,
    dropped,
    press,
    typed,
    handsFree,
    toggleHandsFree,
    agentSpeaking,
  };
}
