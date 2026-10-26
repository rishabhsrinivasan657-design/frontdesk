import type { Metadata } from "next";
import { ChatWindow } from "@/components/chat/chat-window";

export const metadata: Metadata = { title: "Talk to Casa Fiorella" };

const API_WS_URL = process.env.NEXT_PUBLIC_API_WS_URL ?? "ws://localhost:4000/ws";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export default function TalkPage() {
  return (
    <main className="flex flex-col items-center gap-4 px-4 py-4 sm:gap-6 sm:py-8">
      <ChatWindow
        url={API_WS_URL}
        businessName="Casa Fiorella"
        turnstileSiteKey={TURNSTILE_SITE_KEY}
      />
      <p className="text-xs text-muted-foreground">
        Front Desk, an AI receptionist. Bookings are confirmed with you before anything is saved.
      </p>
    </main>
  );
}
