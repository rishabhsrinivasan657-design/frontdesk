import type { ChatMessage } from "@/chat/state";
import { cn } from "@/lib/utils";

export function MessageList({ messages, typing }: { messages: ChatMessage[]; typing: boolean }) {
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {messages.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Ask about a table, the menu or our hours.
        </p>
      )}
      {messages.map((m) => (
        <div
          key={m.id}
          data-testid={m.role === "caller" ? "caller-message" : "agent-message"}
          className={cn(
            "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
            m.role === "caller"
              ? "self-end rounded-br-sm bg-primary text-primary-foreground"
              : "self-start rounded-bl-sm bg-secondary text-secondary-foreground",
          )}
        >
          {m.text}
        </div>
      ))}
      {typing && (
        <div className="self-start px-3 py-2 text-sm text-muted-foreground" data-testid="typing">
          …
        </div>
      )}
    </div>
  );
}
