import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { AuditStage, BookingRow, ConversationSummary } from "@/dashboard/types";

type Tone = "good" | "warn" | "bad" | "neutral" | "info";

const TONES: Record<Tone, string> = {
  good: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  bad: "bg-critical-soft text-critical",
  neutral: "bg-muted text-muted-foreground",
  info: "bg-secondary text-secondary-foreground",
};

/** Status is never color alone: every chip has an icon and a word (design system + dataviz). */
export function Chip({
  tone,
  icon,
  children,
  className,
}: {
  tone: Tone;
  icon?: IconName;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {icon && <Icon name={icon} className="size-3.5" />}
      {children}
    </span>
  );
}

export function DemoBadge() {
  return (
    <span
      title="Seeded demo data (pnpm db:seed). Never counted under pilot."
      className="inline-flex items-center rounded-full border border-accent/40 px-1.5 py-px text-[11px] font-semibold tracking-wide text-accent uppercase"
    >
      Demo
    </span>
  );
}

export function OutcomeChip({ c }: { c: Pick<ConversationSummary, "outcome" | "booked"> }) {
  if (c.outcome === "handoff")
    return (
      <Chip tone="warn" icon="handoffs">
        Handed off
      </Chip>
    );
  if (c.booked)
    return (
      <Chip tone="good" icon="check">
        Booked
      </Chip>
    );
  return (
    <Chip tone="neutral" icon="conversations">
      No booking
    </Chip>
  );
}

export function BookingStatusChip({ status }: { status: BookingRow["status"] }) {
  if (status === "cancelled")
    return (
      <Chip tone="bad" icon="x">
        Cancelled
      </Chip>
    );
  if (status === "rescheduled")
    return (
      <Chip tone="info" icon="clock">
        Rescheduled
      </Chip>
    );
  return (
    <Chip tone="good" icon="check">
      Booked
    </Chip>
  );
}

const STAGES: Record<AuditStage, { tone: Tone; icon: IconName; label: string }> = {
  proposed: { tone: "info", icon: "clock", label: "Proposed" },
  confirmed: { tone: "info", icon: "user", label: "Confirmed by caller" },
  executed: { tone: "good", icon: "check", label: "Written to Calendar" },
  failed: { tone: "bad", icon: "alert", label: "Failed" },
  voided: { tone: "neutral", icon: "x", label: "Voided" },
  email_sent: { tone: "good", icon: "mail", label: "Email sent" },
  email_failed: { tone: "bad", icon: "mail", label: "Email failed" },
};

export function AuditStageChip({ stage }: { stage: AuditStage }) {
  const s = STAGES[stage];
  return (
    <Chip tone={s.tone} icon={s.icon}>
      {s.label}
    </Chip>
  );
}

const REASONS: Record<string, string> = {
  private_event: "Private event",
  party_too_large: "Party too large",
  allergy_safety: "Allergy question",
  complaint: "Complaint",
  human_requested: "Asked for a person",
  late_change: "Change inside the window",
  low_confidence: "Low confidence",
  tool_failures: "Repeated tool failures",
  grounding_failed: "Couldn't verify an answer",
  rate_limited: "LLM rate limit",
  llm_unavailable: "LLM unavailable",
  calendar_unavailable: "Calendar unavailable",
  email_failed: "Confirmation email failed",
};

/** Handoff reasons in the owner's words. */
export const reasonLabel = (reason: string): string =>
  REASONS[reason] ?? reason.replaceAll("_", " ");
