import type { Metadata } from "next";
import { Brand } from "@/components/dashboard/brand";
import { safeNext } from "@/lib/safe-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Owner login — Front Desk" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Brand size="lg" className="mb-8 justify-center" />
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <h1 className="font-heading text-xl font-bold">Owner sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            See what your receptionist booked, who it handed to you, and how it&rsquo;s doing.
          </p>
          <LoginForm next={safeNext(typeof next === "string" ? next : null)} />
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Guests talk to Front Desk at{" "}
          <a className="underline underline-offset-2 hover:text-foreground" href="/talk">
            /talk
          </a>
          .
        </p>
      </div>
    </main>
  );
}
