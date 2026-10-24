"use client";

import type { ServerMessage } from "@frontdesk/core";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { type ChatConnection, connectChat } from "./socket";
import { chatReducer, initialChatState } from "./state";

type Timings = { speechEnd?: number; sttFinal?: number };
type Listener = (message: ServerMessage) => void;

/** The chat socket and its state for one page. `send` refuses while busy or disconnected. */
export function useChat(url: string) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const connection = useRef<ChatConnection | undefined>(undefined);
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    const chat = connectChat({
      url,
      storage: window.sessionStorage,
      onEvent: (event) => {
        dispatch(event);
        if (event.type === "server") for (const l of listeners.current) l(event.message);
      },
    });
    connection.current = chat;
    return () => chat.close();
  }, [url]);

  const send = useCallback(
    (text: string, timings?: Timings): boolean => {
      const trimmed = text.trim();
      if (!trimmed || state.busy || state.handoff || state.status !== "open") return false;
      if (!connection.current?.sendText(trimmed, timings)) return false;
      dispatch({ type: "local_send", text: trimmed, at: performance.now() });
      return true;
    },
    [state.busy, state.handoff, state.status],
  );

  const interrupt = useCallback(() => void connection.current?.sendInterrupt(), []);
  const ttsStarted = useCallback(
    (turnId: string, at: number) => void connection.current?.sendTtsStarted(turnId, at),
    [],
  );
  /** Each server message as it arrives (voice speaks sentences from here); returns unsubscribe. */
  const onServerMessage = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);

  return { state, send, interrupt, ttsStarted, onServerMessage };
}

export type Chat = ReturnType<typeof useChat>;
