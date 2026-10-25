"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/owner/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }
  return (
    <Button variant="ghost" size="sm" onClick={() => void logout()} aria-label="Sign out">
      <Icon name="logout" />
      {!compact && "Sign out"}
    </Button>
  );
}
