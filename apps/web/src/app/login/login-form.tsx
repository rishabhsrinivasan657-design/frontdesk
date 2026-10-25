"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MESSAGES: Record<number, string> = {
  401: "That email and password don't match.",
  429: "Too many attempts. Try again in 15 minutes.",
  503: "The dashboard isn't set up yet: set OWNER_EMAIL and OWNER_PASSWORD_HASH for the api.",
};

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/owner/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (res.status === 204) {
        router.replace(next);
        router.refresh();
        return;
      }
      setError(MESSAGES[res.status] ?? "Can't reach Front Desk right now. Try again in a moment.");
    } catch {
      setError("Can't reach Front Desk right now. Try again in a moment.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="mt-6 flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-critical-soft px-3 py-2 text-sm text-critical"
        >
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="mt-2">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
