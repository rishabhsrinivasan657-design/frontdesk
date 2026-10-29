import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy" };

/** Who to write to for deletion requests; the sentence is left out when unset. */
const CONTACT = process.env.NEXT_PUBLIC_PRIVACY_CONTACT ?? "";

/** The pilot's privacy details (M10), linked from the notice on /talk. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8 text-sm leading-6">
      <h1 className="font-heading text-2xl tracking-wide">Privacy</h1>
      <p>
        Casa Fiorella is a fictional restaurant. This site is a demo of Front Desk, an AI
        receptionist, and bookings made here go on a demo calendar, not a real restaurant&apos;s.
      </p>
      <h2 className="font-heading text-lg">What is collected</h2>
      <ul className="list-disc pl-5">
        <li>What you type or say in the chat, and the agent&apos;s replies.</li>
        <li>The name, phone number or email you give for a booking.</li>
        <li>Your rating and comment, if you leave one.</li>
        <li>
          Your IP address, only to limit how many chats one network can start. Only a keyed one-way
          hash of it is stored, and it expires within a day.
        </li>
      </ul>
      <h2 className="font-heading text-lg">Why</h2>
      <p>
        To make and confirm your booking, to send the confirmation email, and to measure and improve
        how well the receptionist works.
      </p>
      <h2 className="font-heading text-lg">How long</h2>
      <p>
        Up to 30 days. After that, names, contact details, notes and chat text are deleted
        automatically. Only counts and timings (for example, how many chats ended in a booking) are
        kept.
      </p>
      <ul data-testid="privacy-exceptions" className="list-disc pl-5">
        <li>
          A booking keeps your name and contact on the demo calendar until 30 days after the
          reservation date, so a table booked months ahead keeps them longer.
        </li>
        <li>
          Copies of sent confirmation emails in the demo Gmail account are deleted by hand once a
          month, so they can stay up to about 60 days.
        </li>
        <li>
          Nightly database backups are kept for 3 days, so a copy can outlast the 30 days by up to 3
          days.
        </li>
      </ul>
      <h2 className="font-heading text-lg">Who else is involved</h2>
      <ul className="list-disc pl-5">
        <li>Cloudflare Turnstile checks that you&apos;re not a bot before a chat starts.</li>
        <li>
          Google: the booking is stored in a demo Google Calendar, and the confirmation email is
          sent from the demo Gmail account. The chat is processed by Google&apos;s Gemini model on
          its free tier, where Google may use what is sent to improve its products.
        </li>
      </ul>
      <p>Please don&apos;t share anything sensitive, such as health details or payment cards.</p>
      {CONTACT && <p>To have your data deleted sooner, write to {CONTACT}.</p>}
      <p>
        <Link href="/talk" className="text-primary underline underline-offset-2">
          Back to the chat
        </Link>
      </p>
    </main>
  );
}
