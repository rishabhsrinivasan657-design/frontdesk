import type { Metadata } from "next";
import { ChatWindow } from "@/components/chat/chat-window";

export const metadata: Metadata = { title: "Talk to Casa Fiorella" };

const API_WS_URL = process.env.NEXT_PUBLIC_API_WS_URL ?? "ws://localhost:4000/ws";

export default function TalkPage() {
  return (
    <main className="px-4 py-4 sm:py-8">
      <ChatWindow url={API_WS_URL} businessName="Casa Fiorella" />
    </main>
  );
}
