import type { Metadata } from "next";
import Link from "next/link";
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
      <p
        data-testid="privacy-notice"
        className="max-w-xl text-center text-xs text-muted-foreground"
      >
        This is a demo AI receptionist for a fictional restaurant. Bookings go on a demo calendar.
        What you type, and the name, phone or email you give, is stored for up to 30 days to run and
        improve the service, then deleted. Don&apos;t share anything sensitive.{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy details
        </Link>
      </p>
    </main>
  );
}
