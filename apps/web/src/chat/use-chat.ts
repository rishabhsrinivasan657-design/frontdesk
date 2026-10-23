"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { type ChatConnection, connectChat } from "./socket";
import { chatReducer, initialChatState } from "./state";

/** The chat socket and its state for one page. `send` refuses while busy or disconnected. */
export function useChat(url: string) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const connection = useRef<ChatConnection | undefined>(undefined);

  useEffect(() => {
    const chat = connectChat({ url, storage: window.sessionStorage, onEvent: dispatch });
    connection.current = chat;
    return () => chat.close();
  }, [url]);

  const send = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim();
      if (!trimmed || state.busy || state.handoff || state.status !== "open") return false;
      if (!connection.current?.sendText(trimmed)) return false;
      dispatch({ type: "local_send", text: trimmed, at: performance.now() });
      return true;
    },
    [state.busy, state.handoff, state.status],
  );

  return { state, send };
}
