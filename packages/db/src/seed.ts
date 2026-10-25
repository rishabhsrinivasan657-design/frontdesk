import { sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { auditLog, conversations, handoffs, turns } from "./schema.js";

/**
 * Demo data for the owner dashboard (`pnpm db:seed`): realistic Casa Fiorella conversations
 * over the last three weeks. Every row is `source='live'`, `seeded=true` and has an id starting
 * `demo_`, so it is easy to spot and never counts under pilot (spec §10). Ids are fixed, so a
 * second run inserts nothing (the audit log is append-only and can't be cleaned up).
 */
export const DEMO_CONVERSATIONS = 120;
const DAYS = 21;
const TZ = "America/New_York";
/** Gemini Flash-Lite paid-tier prices per token, so cost charts have something to show. */
const PRICE = { input: 0.1 / 1e6, output: 0.4 / 1e6 };

/** The seed writes demo rows into the main database only. */
export function assertSeedable(databaseUrl: string): void {
  if (new URL(databaseUrl).pathname.replace(/^\//, "").endsWith("_eval")) {
    throw new Error("Refusing to seed demo data into the eval database");
  }
}

/**
 * Deletes the demo rows so `seedDemo` can write a fresh story (its dates are relative to now).
 * Demo rows are not real audit records, so this one transaction lifts the append-only trigger
 * (`session_replication_role = replica`, which needs the database owner) for seeded `demo_`
 * rows only. Every other row, and the trigger itself, are untouched.
 */
export async function resetDemo(db: Db): Promise<void> {
  const demo = sql`(select id from conversations where seeded and id like 'demo\_%')`;
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`delete from audit_log where session_id in ${demo}`);
    await tx.execute(sql`delete from handoffs where session_id in ${demo}`);
    await tx.execute(sql`delete from turns where conversation_id in ${demo}`);
    await tx.execute(sql`delete from feedback where conversation_id in ${demo}`);
    await tx.execute(sql`delete from conversations where seeded and id like 'demo\_%'`);
  });
}

/** mulberry32: a tiny deterministic PRNG, so every seed run produces the same story. */
function prng(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    /** Log-normal around a median: most turns near it, a realistic slow tail. */
    latency: (median: number, sigma: number) => {
      const u = Math.max(next(), 1e-9);
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
      return Math.round(median * Math.exp(sigma * z));
    },
  };
}
type Rng = ReturnType<typeof prng>;

const GUESTS = [
  ["Maria Rossi", "maria.rossi@example.com"],
  ["James Carter", "+1 617 555 0142"],
  ["Priya Natarajan", "priya.n@example.com"],
  ["Tom Becker", "tom.becker@example.com"],
  ["Aiko Tanaka", "+1 617 555 0178"],
  ["Daniel Okafor", "dokafor@example.com"],
  ["Sofia Marino", "sofia.marino@example.com"],
  ["Liam O'Brien", "+1 617 555 0109"],
  ["Elena Petrova", "elena.p@example.com"],
  ["Marcus Lee", "marcus.lee@example.com"],
  ["Hannah Schultz", "+1 617 555 0163"],
  ["Diego Alvarez", "diego.alvarez@example.com"],
] as const;
const TIMES = ["17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30"] as const;

interface ScriptTurn {
  caller: string;
  agent: string;
  tools: { name: string; ok?: boolean }[];
}
interface ScriptAction {
  kind: "book" | "reschedule" | "cancel";
  /** Turn index (0-based) the action was proposed in, and the stages it went through. */
  proposedAt: number;
  stages: ("proposed" | "confirmed" | "executed" | "failed" | "voided" | "email_sent")[];
  reason?: string;
  slot: { date: string; time: string };
}
interface Script {
  turns: ScriptTurn[];
  actions: ScriptAction[];
  handoff?: { reason: string; summary: string };
}

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, dateStyle: "short" }).format(d);
const weekday = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
const spoken = (time: string) => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")} PM`;
};

/** The UTC instant of a New York wall time (DST-correct). */
function zoned(date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const local = new Date(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(guess)
      .replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+)/, "$3-$1-$2T$4:$5:00Z"),
  );
  return new Date(guess.getTime() + (guess.getTime() - local.getTime()));
}

type BookingVariant = "plain" | "changed" | "taken";

function bookingScript(
  r: Rng,
  guest: readonly [string, string],
  party: number,
  date: string,
  variant: BookingVariant,
): Script {
  const time = r.pick(TIMES);
  const when = `${weekday(date)} at ${spoken(time)}`;
  const changed = variant === "changed";
  const taken = variant === "taken";
  const turns: ScriptTurn[] = [
    {
      caller: r.pick([
        `Hi, do you have a table for ${party} on ${weekday(date)} around ${spoken(time)}?`,
        `Can I book dinner for ${party} people, ${weekday(date)}, ${spoken(time)}?`,
        `Table for ${party} on ${weekday(date)} please, ideally ${spoken(time)}.`,
      ]),
      agent: `Yes, ${when} is open for ${party}. May I have a name and a phone number or email for the reservation?`,
      tools: [{ name: "check_availability" }],
    },
    {
      caller: `${guest[0]}, ${guest[1]}`,
      agent: `To confirm: a table for ${party} on ${when}, under ${guest[0]}. Shall I book it?`,
      tools: [{ name: "book" }],
    },
  ];
  const actions: ScriptAction[] = [];
  if (changed) {
    const later = TIMES[Math.min(TIMES.indexOf(time) + 2, TIMES.length - 1)]!;
    actions.push({
      kind: "book",
      proposedAt: 1,
      stages: ["proposed", "voided"],
      slot: { date, time },
    });
    turns.push({
      caller: `Actually, could we make it ${spoken(later)} instead?`,
      agent: `Of course. A table for ${party} on ${weekday(date)} at ${spoken(later)}, under ${guest[0]}. Shall I book it?`,
      tools: [{ name: "check_availability" }, { name: "book" }],
    });
    actions.push({
      kind: "book",
      proposedAt: 2,
      stages: ["proposed", "confirmed", "executed", "email_sent"],
      slot: { date, time: later },
    });
  } else if (taken) {
    const other = TIMES[Math.max(TIMES.indexOf(time) - 1, 0)]!;
    actions.push({
      kind: "book",
      proposedAt: 1,
      stages: ["proposed", "confirmed", "failed"],
      reason: "slot_taken",
      slot: { date, time },
    });
    turns.push({
      caller: "Yes please.",
      agent: `I'm sorry, that table was just taken. I can do ${spoken(other)} the same evening. Would that work?`,
      tools: [],
    });
    turns.push({
      caller: `${spoken(other)} is fine.`,
      agent: `A table for ${party} on ${weekday(date)} at ${spoken(other)}, under ${guest[0]}. Shall I book it?`,
      tools: [{ name: "check_availability" }, { name: "book" }],
    });
    actions.push({
      kind: "book",
      proposedAt: 3,
      stages: ["proposed", "confirmed", "executed", "email_sent"],
      slot: { date, time: other },
    });
  } else {
    actions.push({
      kind: "book",
      proposedAt: 1,
      stages: ["proposed", "confirmed", "executed", "email_sent"],
      slot: { date, time },
    });
  }
  turns.push({
    caller: r.pick(["Yes, please.", "Perfect, book it.", "Yes, that's great."]),
    agent: `You're booked! We'll see you ${weekday(date)}. ${guest[1].includes("@") ? "A confirmation is on its way to your inbox." : "See you then."}`,
    tools: [],
  });
  if (r.next() < 0.3) {
    turns.push({
      caller: r.pick([
        "Is there parking nearby?",
        "Do you have gluten-free pasta?",
        "Can we bring a cake?",
      ]),
      agent: r.pick([
        "There's street parking on Hanover Street and a garage two blocks away on Commercial Street.",
        "Yes, we make gluten-free pasta in-house; just mention it to your server.",
        "You're welcome to bring a cake; there's a small plating fee per person.",
      ]),
      tools: [{ name: "lookup_faq" }],
    });
  }
  return { turns, actions };
}

function faqScript(r: Rng): Script {
  const pairs = [
    [
      "What are your hours on Sunday?",
      "On Sundays we're open from 12:00 PM to 9:00 PM.",
      "lookup_faq",
    ],
    [
      "Do you take walk-ins?",
      "We keep a few tables for walk-ins every night, but booking is the safest bet on weekends.",
      "lookup_faq",
    ],
    [
      "Is the tiramisu made in house?",
      "Yes, our tiramisu is made fresh every morning.",
      "get_menu_item",
    ],
    [
      "How much is the osso buco?",
      "The osso buco is $38 and comes with saffron risotto.",
      "get_menu_item",
    ],
    ["Is there a dress code?", "No dress code: come as you are.", "lookup_faq"],
  ] as const;
  const n = r.int(1, 3);
  const used = new Set<number>();
  const turns: ScriptTurn[] = [];
  while (turns.length < n) {
    const i = r.int(0, pairs.length - 1);
    if (used.has(i)) continue;
    used.add(i);
    const [caller, agent, tool] = pairs[i]!;
    turns.push({ caller, agent, tools: [{ name: tool }] });
  }
  return { turns, actions: [] };
}

function changeScript(
  r: Rng,
  guest: readonly [string, string],
  party: number,
  date: string,
): Script {
  const cancel = r.next() < 0.5;
  const time = r.pick(TIMES);
  const turns: ScriptTurn[] = [
    {
      caller: `Hi, I have a reservation under ${guest[0]} and need to ${cancel ? "cancel it" : "move it"}.`,
      agent: "I can help with that. What phone number or email is the reservation under?",
      tools: [],
    },
    {
      caller: guest[1],
      agent: cancel
        ? `I found your table for ${party} on ${weekday(date)}. Shall I cancel it?`
        : `I found your table for ${party}. ${weekday(date)} at ${spoken(time)} is open. Shall I move it there?`,
      tools: cancel
        ? [{ name: "find_reservation" }, { name: "cancel" }]
        : [{ name: "find_reservation" }, { name: "check_availability" }, { name: "reschedule" }],
    },
    {
      caller: "Yes, thanks.",
      agent: cancel
        ? "Done, your reservation is cancelled. We hope to see you another time."
        : `Done, you're now booked for ${weekday(date)} at ${spoken(time)}.`,
      tools: [],
    },
  ];
  return {
    turns,
    actions: [
      {
        kind: cancel ? "cancel" : "reschedule",
        proposedAt: 1,
        stages: ["proposed", "confirmed", "executed", "email_sent"],
        slot: { date, time },
      },
    ],
  };
}

const HANDOFFS = [
  {
    reason: "private_event",
    caller: "We'd like to rent the back room for a rehearsal dinner, about 30 people.",
    agent:
      "Private events are handled by our events team. I've passed your details on, and someone will call you within one business day.",
    summary: "Rehearsal dinner for ~30 in the back room; wants a call about menu and pricing.",
  },
  {
    reason: "allergy_safety",
    caller: "My son has a severe tree-nut allergy. Can the kitchen guarantee no cross-contact?",
    agent:
      "For a serious allergy I want you to hear it from our chef directly. I've asked the team to call you before your visit.",
    summary: "Severe tree-nut allergy; guest wants assurance about cross-contact before booking.",
  },
  {
    reason: "party_too_large",
    caller: "Table for 14 this Saturday?",
    agent:
      "Parties over 10 are arranged by our manager. I've passed this on, and they'll be in touch today.",
    summary: "Party of 14 on Saturday evening; needs a manager to arrange seating.",
  },
  {
    reason: "complaint",
    caller: "Our pasta came out cold last night and nobody checked on us.",
    agent:
      "I'm really sorry about that. I've passed this to our manager, who will reach out to make it right.",
    summary: "Complaint about cold pasta and slow service at dinner last night.",
  },
  {
    reason: "human_requested",
    caller: "Can I just talk to a person, please?",
    agent: "Of course. I've let the team know, and someone will call you back shortly.",
    summary: "Guest asked for a person without saying why; call back.",
  },
  {
    reason: "late_change",
    caller: "Can I move tonight's 7 PM table to 9 PM?",
    agent:
      "Changes this close to the reservation need the team's OK. I've passed it on, and they'll confirm with you shortly.",
    summary: "Wants to move tonight's 7 PM booking to 9 PM, inside the change window.",
  },
] as const;
const RESOLVED_NOTES = [
  "Called back and booked the back room for June 14; deposit taken.",
  "Spoke with the chef; guest booked for Friday with a nut-free prep plan.",
];

/** Inserts the demo story once. Returns how many conversations were new. */
export async function seedDemo(db: Db, o: { now: Date }): Promise<{ inserted: number }> {
  const r = prng(20261024);
  let inserted = 0;
  let handoffIndex = 0;
  // Handoff conversations are spread through the window; the newest four stay open.
  const handoffAt = new Set([12, 32, 55, 77, 95, 110]);

  for (let i = 0; i < DEMO_CONVERSATIONS; i++) {
    const id = `demo_${String(i + 1).padStart(3, "0")}`;
    // Oldest first: i = 0 is about three weeks ago, the last one is earlier today.
    const daysAgo = Math.round(
      ((DEMO_CONVERSATIONS - 1 - i) / (DEMO_CONVERSATIONS - 1)) * (DAYS - 1),
    );
    const startedAt = new Date(o.now.getTime() - daysAgo * 86_400_000 - r.int(20, 9 * 60) * 60_000);
    const guest = r.pick(GUESTS);
    const party = r.pick([2, 2, 2, 3, 4, 4, 5, 6]);
    const visit = fmtDate(new Date(startedAt.getTime() + r.int(1, 9) * 86_400_000));

    let script: Script;
    if (handoffAt.has(i)) {
      const h = HANDOFFS[handoffIndex % HANDOFFS.length]!;
      script = {
        turns: [{ caller: h.caller, agent: h.agent, tools: [] }],
        actions: [],
        handoff: { reason: h.reason, summary: h.summary },
      };
    } else {
      const roll = r.next();
      // A few fixed conversations always show a change of mind and a slot taken mid-confirm.
      const variant: BookingVariant = i % 9 === 4 ? "changed" : i % 16 === 10 ? "taken" : "plain";
      script =
        variant !== "plain" || roll < 0.62
          ? bookingScript(r, guest, party, visit, variant)
          : roll < 0.82
            ? faqScript(r)
            : changeScript(r, guest, party, visit);
    }
    const voice = r.next() < 0.3;

    const [row] = await db
      .insert(conversations)
      .values({
        id,
        source: "live",
        seeded: true,
        startedAt: startedAt.toISOString(),
        endedAt: script.handoff ? new Date(startedAt.getTime() + 2 * 60_000).toISOString() : null,
        outcome: script.handoff ? "handoff" : null,
        handoffReason: script.handoff?.reason ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: conversations.id });
    if (script.handoff) handoffIndex++;
    // Already seeded: everything below was written with it (and audit rows can't be rewritten).
    if (!row) continue;
    inserted++;

    let at = startedAt.getTime();
    const turnIds: string[] = [];
    for (const [t, turn] of script.turns.entries()) {
      at += r.int(15, 70) * 1000;
      const toolCalls = turn.tools.map((tool) => ({
        name: tool.name,
        ms: r.latency(180, 0.6),
        ok: tool.ok ?? true,
      }));
      const llmTtftMs = r.latency(560, 0.45);
      const firstOutputMs = llmTtftMs + toolCalls.reduce((n, c) => n + c.ms, 0) + r.int(40, 120);
      const tokensIn = 1400 + t * 450 + r.int(0, 600);
      const tokensOut = r.int(35, 150);
      const turnId = `${id}_t${t + 1}`;
      turnIds.push(turnId);
      const sttMs = voice ? r.latency(360, 0.4) : null;
      const ttsStartMs = voice ? r.latency(130, 0.45) : null;
      const flags = [
        ...(llmTtftMs > 1500 ? ["over_p95_llm_ttft"] : []),
        ...(toolCalls.some((c) => c.ms > 800) ? ["over_p95_tool"] : []),
        ...(firstOutputMs > 1800 ? ["over_p95_first_token"] : []),
      ];
      await db.insert(turns).values({
        id: turnId,
        conversationId: id,
        turnIndex: t + 1,
        callerText: turn.caller,
        agentText: turn.agent,
        sttMs,
        llmTtftMs,
        llmTotalMs: llmTtftMs + r.int(200, 700),
        toolMs: toolCalls.map((c) => c.ms),
        toolCalls,
        ttsStartMs,
        firstOutputMs,
        totalMs: firstOutputMs + r.int(300, 900),
        tokensIn,
        tokensOut,
        costUsd: tokensIn * PRICE.input + tokensOut * PRICE.output,
        flags,
        createdAt: new Date(at).toISOString(),
      });
    }

    for (const [a, action] of script.actions.entries()) {
      const actionId = `${id}_a${a + 1}`;
      const start = zoned(action.slot.date, action.slot.time);
      const booking = {
        id: action.kind === "book" ? `demo-ev-${id}-${a + 1}` : `demo-ev-${id}-0`,
        start: start.toISOString(),
        end: new Date(start.getTime() + 90 * 60_000).toISOString(),
        tableId: party > 4 ? "t6-1" : "t4-1",
        partySize: party,
        name: guest[0],
        contact: guest[1],
        notes: "",
      };
      const args =
        action.kind === "book"
          ? {
              kind: "book",
              slotId: `${action.slot.date}T${action.slot.time}@${booking.tableId}#${party}`,
              name: guest[0],
              contact: guest[1],
              partySize: party,
              notes: "",
            }
          : action.kind === "reschedule"
            ? {
                kind: "reschedule",
                reservationId: booking.id,
                slotId: `${action.slot.date}T${action.slot.time}@${booking.tableId}#${party}`,
              }
            : { kind: "cancel", reservationId: booking.id };
      let stageAt = at;
      for (const stage of action.stages) {
        stageAt += r.int(2, 40) * 1000;
        if (stage === "email_sent" && !guest[1].includes("@")) continue;
        await db.insert(auditLog).values({
          at: new Date(stageAt).toISOString(),
          sessionId: id,
          turnId: turnIds[action.proposedAt] ?? null,
          actionId,
          kind: action.kind,
          stage,
          args: stage === "email_sent" ? null : args,
          result: stage === "executed" ? booking : stage === "email_sent" ? { attempt: 1 } : null,
          reason:
            action.reason && stage === "failed"
              ? action.reason
              : stage === "voided"
                ? "changed"
                : null,
        });
      }
    }

    if (script.handoff) {
      const open = handoffIndex > 2;
      await db
        .insert(handoffs)
        .values({
          id: `${id}_handoff`,
          sessionId: id,
          reason: script.handoff.reason,
          summary: script.handoff.summary,
          transcript: script.turns.flatMap((t, n) => [
            { role: "caller", text: t.caller, turnId: turnIds[n]! },
            { role: "agent", text: t.agent, turnId: turnIds[n]! },
          ]),
          createdAt: new Date(at).toISOString(),
          resolvedAt: open ? null : new Date(at + 5 * 3_600_000).toISOString(),
          notes: open ? null : RESOLVED_NOTES[handoffIndex - 1]!,
        })
        .onConflictDoNothing();
    }
  }
  return { inserted };
}
