import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-wide sm:text-3xl">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)} {...props}>
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-secondary text-primary">
        <Icon name={icon} className="size-5" />
      </span>
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** One headline number: the job is "read one value", so no chart (dataviz: stat tile). */
export function KpiTile({
  label,
  value,
  detail,
  tone = "neutral",
  testId,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: "neutral" | "good" | "warn";
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="rounded-xl border border-border bg-card px-5 py-4">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-3xl font-semibold tabular-nums tracking-tight",
          tone === "good" && "text-success",
          tone === "warn" && "text-warning",
        )}
      >
        {value}
      </p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}
