import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";
import { Brand } from "@/components/dashboard/brand";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { Nav } from "@/components/dashboard/nav";
import { SourceSwitch } from "@/components/dashboard/source-switch";
import { ownerFetch } from "@/lib/owner-api";

export const metadata: Metadata = { title: { template: "%s — Front Desk", default: "Front Desk" } };

/** The owner's shell: sidebar on desktop, top bar on phones. proxy.ts already checked the session. */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await ownerFetch<{ email: string }>("/me");
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-border bg-card px-4 py-5 lg:flex">
        <Brand className="px-2" />
        <Suspense>
          <Nav orientation="vertical" />
        </Suspense>
        <div className="mt-auto flex flex-col gap-4">
          <Suspense>
            <SourceSwitch />
          </Suspense>
          <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
            <span className="truncate text-xs text-muted-foreground" title={me.email}>
              {me.email}
            </span>
            <LogoutButton compact />
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Brand />
            <LogoutButton compact />
          </div>
          <div className="flex items-center gap-3 px-4 pb-3">
            <Suspense>
              <Nav orientation="horizontal" />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mb-4 lg:hidden">
            <Suspense>
              <SourceSwitch />
            </Suspense>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
