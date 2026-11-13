import type { ChatMessage } from "@/chat/state";
import { cn } from "@/lib/utils";

export function MessageList({ messages, typing }: { messages: ChatMessage[]; typing: boolean }) {
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {messages.map((m) => (
        <div
          key={m.id}
          data-testid={m.role === "caller" ? "caller-message" : "agent-message"}
          className={cn(
            "fd-pop max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap",
            m.role === "caller"
              ? "self-end rounded-br-sm bg-primary text-primary-foreground"
              : "self-start rounded-bl-sm border border-border bg-card text-card-foreground",
          )}
        >
          {m.text}
        </div>
      ))}
      {typing && (
        <div
          className="fd-pop fd-dots flex gap-1.5 self-start rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-3.5"
          data-testid="typing"
          aria-label="The receptionist is replying"
        >
          <i />
          <i />
          <i />
        </div>
      )}
    </div>
  );
}
