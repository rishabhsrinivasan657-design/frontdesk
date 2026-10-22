# M1: Config Schema and Availability Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Zod-validated business config, `businesses/casa-fiorella.yaml`, and the pure availability engine `findSlots` that the M3 agent tools will call.

**Architecture:**
- **Config:** `packages/core` owns the Zod schema and `parseBusinessConfig(yamlText)`. Core never reads files. `apps/api` gets a tiny `loadBusinessConfig(path)` that reads the file and calls core; the api will use it at startup (spec §11: refuse to start on an invalid config).
- **Engine:** `findSlots(config, reservations, request, now)` is a pure function. All wall-clock arithmetic is done in the business timezone with Luxon; hold overlap is done on absolute instants.
- **Tables:** physical tables are derived from `seating.tables` with stable ids (`t2-1` … `t2-8`, `t4-1` … `t4-6`, `t6-1`, `t6-2`). Reservations carry a `tableId`.

**Tech Stack:** TypeScript 5, Zod 4 (`zod`), `yaml` 2.x, Luxon 3.x (+ `@types/luxon`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-frontdesk-design.md` (§2 Casa Fiorella, §4 Business config, §5 Availability engine, §13 Testing, §14 M1 row)

## Global Constraints

- `packages/core` stays pure: no Node built-ins, no I/O, no `process`/`fetch`/`Buffer`. `zod`, `yaml` and `luxon` are pure and allowed. Core's tsconfig keeps `"types": []` (explicit imports of `luxon` still resolve `@types/luxon`).
- Timezone `America/New_York`. Hours: Tue–Thu 17:00–22:00 · Fri–Sat 17:00–23:00 · Sun 12:00–21:00 · Mon closed.
- Tables: 8 × 2, 6 × 4, 2 × 6. Hold 90 min, 120 min for parties of 5+. `slotIntervalMinutes: 15`, `lastSeatingBeforeCloseMinutes: 60`.
- Policies: `bookingWindowDays: 30`, `minLeadMinutes: 60`, `maxPartyForAgent: 8`, `freeChangeUntilHoursBefore: 4`, `graceMinutes: 15`. Tables are never combined.
- Private room: `{ name: La Cantina, min: 10, max: 30, agentMayBook: false }`.
- `pnpm verify` passes at the end of every task. Unit tests live in `{apps,packages}/*/src/**/*.test.ts`.
- If a package gains a `workspace:*` dep, its tsconfig `references` must match (enforced by `tests/lint/workspace-references.test.ts`). M1 adds none.
- Branch `m1-config-availability`. Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Engine rulings (decisions the spec leaves open)

1. **Grid:** candidates are local wall-clock times on the `slotIntervalMinutes` grid (anchored at local midnight) with `open ≤ t ≤ close − lastSeatingBeforeCloseMinutes`. The hold may run past close.
2. **Lead time:** a slot is offered iff `start ≥ now + minLeadMinutes` (exactly 60 minutes is allowed).
3. **Booking window:** date-based. The slot's local date must be `≤ localDate(now) + bookingWindowDays`. `localDate(now)` is `now` converted to the business timezone.
4. **Occupancy:** a reservation blocks its table on `[start, end)` using the reservation's own `end` (Calendar is the truth). A candidate occupies `[start, start + hold)`. Back-to-back is allowed.
5. **Table choice:** the smallest table size `≥ partySize` that has a free table, then the lowest-numbered free table of that size. If every table of the smallest fitting size is taken, the next size up is used.
6. **Request with a time:** if that exact slot is available, return `[slot]`. Otherwise return alternatives on the same date: the nearest earlier slot and the nearest later slot (each if it exists), then the next nearest overall until 3 (ties → earlier). Returned in chronological order. Off-grid or out-of-hours times are just "unavailable" and get alternatives.
7. **Request without a time:** every available slot on the date, chronological.
8. **DST:** nonexistent wall times (spring forward) are skipped. Ambiguous wall times (fall back) appear once, at the earlier offset. Hold length is real minutes.
9. **Party size:** the engine checks only table fit. Parties of 7–8 are allowed by policy but no table fits, so they get `[]` (see Review Focus 1). `maxPartyForAgent` and the change window are enforced by M3 tools, not the engine.
10. **Grace minutes** do not extend the hold; they are a no-show policy for M3.
11. **Slot id:** deterministic, `${date}T${time}@${tableId}#${partySize}` (e.g. `2026-11-03T19:00@t4-1#4`), so M3's execution-time re-check can recompute and compare it.

## Review Focus

1. **Party of 7 or 8:** policy says the agent books them, but the largest table seats 6 and tables are never combined. `findSlots` returns `[]` for them (no error), so M3 can hand off. Test in Task 4.
2. **Calendar event pointing at a table the config doesn't have** (config edited after bookings): silently ignoring it could double-book. `findSlots` throws `UnknownTableError` naming the reservation id and table id. Test in Task 4.
3. **`now` given in UTC that is already the next UTC day** (e.g. `2026-11-03T03:30Z` is Nov 2, 22:30 in New York): the booking window counts from the business-local date. Test in Task 3.
4. **Malformed request** (`"2026-02-30"`, `"7pm"`, `partySize: 0` or `2.5`): throws `RangeError` with the bad field in the message instead of returning a misleading `[]`. Test in Task 3.
5. **Caller asks for a time the restaurant isn't seating** (23:00 on a Tuesday, or off-grid 19:07): gets the nearest alternatives, not an error. Test in Task 5.

---

### Task 1: Business config schema and parser

**Files:**
- Modify: `packages/core/package.json` (deps `zod`, `yaml`, `luxon`; devDep `@types/luxon`)
- Create: `packages/core/src/config/schema.ts`, `packages/core/src/config/parse.ts`
- Modify: `packages/core/src/index.ts` (re-export; keep `CORE_PACKAGE`)
- Test: `packages/core/src/config/parse.test.ts`, `packages/core/src/config/test-config.ts` (shared fixture)

**Interfaces:**
- Produces:
  - `BusinessConfigSchema` (Zod) and `type BusinessConfig = z.infer<typeof BusinessConfigSchema>`, shaped exactly as spec §4: `business{name, phone, email, address, timezone}`, `hours` with all seven keys `sun|mon|tue|wed|thu|fri|sat` → `{ open: "HH:mm"; close: "HH:mm" }[]`, `closures[{date, reason}]`, `seating{tables[{size,count}], holdMinutes{default, partyOf5Plus}, slotIntervalMinutes, lastSeatingBeforeCloseMinutes}`, `policies{…5 fields}`, `privateRoom{name,min,max,agentMayBook}`, `menu[{item, price, tags[]}]`, `faq[{id, q, a, keywords[]}]`, `handoffTriggers` (enum of the six §2 names), `agent{persona, greeting, voice{lang, rate}}`.
  - `type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"`.
  - `parseBusinessConfig(yamlText: string): BusinessConfig` — throws `BusinessConfigError` (extends `Error`, `name = "BusinessConfigError"`) for YAML syntax errors and schema failures. Schema failures use `z.prettifyError` so the message names each failing path.
  - Test fixture `testConfig(): BusinessConfig` in `test-config.ts`: the Casa Fiorella values as a TS object (closures: `2026-11-26` Thanksgiving, `2026-12-25` Christmas). Not exported from the package index.

- [ ] **Step 1: Write the failing tests** in `parse.test.ts`. Each builds YAML with `stringify` from `yaml` over `testConfig()` (mutated per case):
  - `parses a valid config` → result deep-equals `testConfig()`.
  - `rejects YAML syntax errors` → throws `BusinessConfigError`.
  - Each of these throws `BusinessConfigError` whose message contains the path: missing `hours.mon` (`hours.mon`); `timezone: "Mars/Olympus"` (`business.timezone`); `close` ≤ `open` (`hours.tue`); overlapping intervals on one day (`hours.sun`); `open: "17:10"` with a 15-minute grid (`hours.wed`); `close: "24:00"`; duplicate table size (`seating.tables`); `count: 0`; `privateRoom.min > max`; closure date `"2026-13-01"`; unknown handoff trigger `"bored"`.
  - `ignores nothing silently`: an unknown top-level key `extra: 1` is rejected (`z.strictObject` at the top level).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/core/src/config > /tmp/m1.log 2>&1; tail -20 /tmp/m1.log`
Expected: FAIL, cannot resolve `./parse`.

- [ ] **Step 3: Add deps and implement `schema.ts` and `parse.ts`**

`pnpm --filter @frontdesk/core add zod yaml luxon && pnpm --filter @frontdesk/core add -D @types/luxon`. Times match `/^([01]\d|2[0-3]):[0-5]\d$/`. Timezone validity via Luxon `IANAZone.isValidZone`. Interval, grid and min/max checks are `superRefine`s on the owning object so the issue path is that object's path. Dates are validated with Luxon `DateTime.fromISO(…).isValid` plus the `YYYY-MM-DD` regex.

- [ ] **Step 4: Run to verify they pass, then `pnpm verify`**

Expected: all config tests pass; verify exits 0 (lint confirms the new imports are allowed in core).

- [ ] **Step 5: Commit** — `feat(core): add business config schema and yaml parser`

---

### Task 2: `casa-fiorella.yaml` and the api loader

**Files:**
- Create: `businesses/casa-fiorella.yaml`, `apps/api/src/business-config.ts`
- Test: `apps/api/src/business-config.test.ts`

**Interfaces:**
- Consumes: `parseBusinessConfig`, `BusinessConfig`, `BusinessConfigError` from `@frontdesk/core`.
- Produces: `loadBusinessConfig(path: string): BusinessConfig` (reads UTF-8 with `node:fs`, delegates to core; a missing file throws `BusinessConfigError` with the path in the message).

- [ ] **Step 1: Write the failing tests**
  - `loads casa-fiorella.yaml` → `timezone === "America/New_York"`; `hours.mon` is `[]`; `hours.fri` is `[{ open: "17:00", close: "23:00" }]`; `hours.sun` is `[{ open: "12:00", close: "21:00" }]`; `seating.tables` equals `[{size:2,count:8},{size:4,count:6},{size:6,count:2}]`; total seats = 50; `holdMinutes` `{ default: 90, partyOf5Plus: 120 }`; `policies` equal the five Global Constraints values; `privateRoom.agentMayBook === false`; `handoffTriggers` has all six names; `faq` ids cover the eight §2 topics (`parking`, `kids`, `dietary`, `corkage`, `patio`, `gift-cards`, `dress-code`, `accessibility`).
  - `throws BusinessConfigError naming the path for a missing file`.

- [ ] **Step 2: Run to verify they fail** (module not found).

- [ ] **Step 3: Write the YAML and the loader.** Content beyond §2's numbers (address, phone, menu items and prices, FAQ answers, persona, greeting) is invented but plausible. FAQ answers must not claim any dish is allergen-safe. Use a `@example.com` email and a 555 phone number. Sunday brunch is noted in the Sunday-hours FAQ/greeting only; hours stay one 12:00–21:00 interval. Closures: `2026-11-26`, `2026-12-25`, `2027-01-01`.

- [ ] **Step 4: Run to verify they pass, then `pnpm verify`.**

- [ ] **Step 5: Commit** — `feat: add casa fiorella config and api config loader`

---

### Task 3: `findSlots` candidates — hours, cutoff, closures, lead time, window, DST

**Files:**
- Create: `packages/core/src/availability/types.ts`, `packages/core/src/availability/local-time.ts`, `packages/core/src/availability/find-slots.ts`
- Test: `packages/core/src/availability/candidates.test.ts`

**Interfaces:**
- Consumes: `BusinessConfig`, `DayKey`, `testConfig()`.
- Produces (in `types.ts`):
  ```ts
  export interface Reservation { id: string; start: Date; end: Date; tableId: string; partySize: number }
  export interface SlotRequest { date: string; time?: string; partySize: number } // "YYYY-MM-DD", "HH:mm"
  export interface Slot {
    id: string; date: string; time: string;   // local date and "HH:mm"
    start: string; end: string;               // ISO with offset, no ms: "2026-11-03T19:00:00-05:00"
    tableId: string; tableSize: number; partySize: number;
  }
  ```
  - `findSlots(config: BusinessConfig, reservations: readonly Reservation[], request: SlotRequest, now: Date): Slot[]`.
  - `local-time.ts` internal helpers (not exported from the index): `localWallTimesOnGrid(config, date): DateTime[]` applying rulings 1 and 8, and `localToday(now, zone): string`.
  - In this task the table is always the smallest fitting size's first table and reservations are ignored; Task 4 adds occupancy.

- [ ] **Step 1: Write the failing tests** (all with `testConfig()`, party 2, no reservations; `now` in New York local unless stated):
  - `Tuesday 2026-11-03 has 17 slots 17:00–21:00` (now `2026-11-02T09:00-05:00`): first `time` `"17:00"`, last `"21:00"`, step 15.
  - `Friday 2026-11-06 runs to 22:00` (21 slots); `Sunday 2026-11-08 runs 12:00–20:00` (33 slots); `Monday 2026-11-09 is closed` → `[]`.
  - `closure date 2026-11-26 returns []`.
  - `lead time is inclusive`: now `2026-11-03T16:30-05:00` → first `"17:30"`; now `16:31` → first `"17:45"`; a past date → `[]`.
  - `booking window is 30 local days`: now `2026-11-02T09:00-05:00` → `2026-12-02` has slots, `2026-12-03` → `[]`.
  - `window counts from the business-local date` (Review Focus 3): now `2026-11-03T03:30:00Z` → `2026-12-02` has slots, `2026-12-03` → `[]`.
  - `slot shape`: Tuesday 19:00 slot equals `{ id: "2026-11-03T19:00@t2-1#2", date: "2026-11-03", time: "19:00", start: "2026-11-03T19:00:00-05:00", end: "2026-11-03T20:30:00-05:00", tableId: "t2-1", tableSize: 2, partySize: 2 }`.
  - `DST fall back`: Saturday `2026-10-31` 17:00 `start` ends in `-04:00`; Sunday `2026-11-01` 12:00 is `"2026-11-01T12:00:00-05:00"`.
  - `DST spring forward, synthetic night hours`: config with `sun: [{open:"00:00", close:"04:00"}]`, now `2027-03-01T09:00-05:00`, date `2027-03-14` → times `00:00 … 01:45, 03:00` (9 slots, 02:00–02:45 skipped); the 01:00 slot's `end` is `"2027-03-14T03:30:00-04:00"` (90 real minutes).
  - `DST fall back, synthetic night hours`: same config, now `2026-10-20T09:00-04:00`, date `2026-11-01` → 13 slots `00:00 … 03:00`, each `time` once, `01:00` start is `"2026-11-01T01:00:00-04:00"`, starts strictly increasing.
  - `rejects malformed requests` (Review Focus 4): `date "2026-02-30"`, `date "11/03/2026"`, `time "7pm"`, `partySize 0`, `partySize 2.5` each throw `RangeError` whose message names the field.

- [ ] **Step 2: Run to verify they fail** (module not found).

- [ ] **Step 3: Implement** `local-time.ts` and the candidate half of `findSlots`. Build wall times with `DateTime.fromObject({…}, { zone })`; a wall time is nonexistent when the result's `hour`/`minute` differ from what was asked (Luxon shifts it forward). For ambiguous times Luxon picks the earlier offset by default; dedupe by local `HH:mm`. Format with `toISO({ suppressMilliseconds: true })`.

- [ ] **Step 4: Run to verify they pass, then `pnpm verify`.**

- [ ] **Step 5: Commit** — `feat(core): generate availability candidates in business timezone`

---

### Task 4: Table fit and holds

**Files:**
- Create: `packages/core/src/availability/tables.ts`
- Modify: `packages/core/src/availability/find-slots.ts`
- Test: `packages/core/src/availability/tables.test.ts`

**Interfaces:**
- Consumes: Task 3 types and `findSlots`.
- Produces:
  - `interface Table { id: string; size: number }`; `tablesFromConfig(config): Table[]` sorted by size then number; ids `t${size}-${n}` with `n` from 1.
  - `holdMinutesFor(config, partySize): number` (`partySize >= 5` → `partyOf5Plus`, else `default`).
  - `class UnknownTableError extends Error` with `reservationId` and `tableId` fields.

- [ ] **Step 1: Write the failing tests** (Tuesday `2026-11-03`, now `2026-11-02T09:00-05:00`; `res(tableId, "19:00", "20:30")` helper builds a local-time `Reservation`):
  - `tablesFromConfig` yields 16 tables: `t2-1…t2-8, t4-1…t4-6, t6-1, t6-2`.
  - `smallest fitting table`: party 2 → `t2-1`; party 3 → `t4-1`; party 5 → `t6-1`.
  - `hold length`: party 4 at 19:00 ends `20:30`; party 5 ends `21:00`.
  - `next size up when the smallest size is full`: all eight two-tops reserved 19:00–20:30 → party 2 at 19:00 gets `t4-1`; plus all four-tops → `t6-1`; plus both six-tops → no 19:00 slot.
  - `holds are half-open`: `t2-1` reserved 19:00–20:30 → party 2 at 17:30 gets `t2-1` (ends 19:00), 17:45 gets `t2-2`, 20:30 gets `t2-1`.
  - `120-minute hold for 5+`: both six-tops reserved 19:00–21:00 → party 5 gets 17:00 but not 17:15; nothing from 17:15 to 20:45; 21:00 is offered.
  - `reservations on other days don't block`.
  - `parties of 7, 8 and 9 get no slots` (Review Focus 1).
  - `unknown table id throws` (Review Focus 2): a reservation on `"t10-1"` → `UnknownTableError` with message containing the reservation id and `t10-1`.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** `tables.ts` and occupancy in `findSlots` per rulings 4 and 5. Validate reservation table ids once up front.

- [ ] **Step 4: Run to verify they pass (Task 3 tests still pass), then `pnpm verify`.**

- [ ] **Step 5: Commit** — `feat(core): assign smallest free table for the full hold`

---

### Task 5: Requested time and alternatives; public exports

**Files:**
- Modify: `packages/core/src/availability/find-slots.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/availability/alternatives.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces: the core index exports `findSlots`, `tablesFromConfig`, `holdMinutesFor`, `UnknownTableError`, and types `Slot`, `SlotRequest`, `Reservation`, `Table`, alongside the Task 1 config exports.

- [ ] **Step 1: Write the failing tests** (Tuesday `2026-11-03`, party 2, now `2026-11-02T09:00-05:00`; "blocked 17:30–19:00" means every table reserved 18:45–19:15, which blocks starts 17:30 through 19:00):
  - `available time returns just that slot`: request 19:00, no reservations → one slot, `time "19:00"`.
  - `unavailable time returns nearest on both sides`: blocked as above, request 19:00 → times `["17:15", "19:15", "19:30"]`.
  - `only one side available`: request `"23:00"` (Review Focus 5) → `["20:30", "20:45", "21:00"]`.
  - `off-grid time gets alternatives`: request `"19:07"`, no reservations → `["18:45", "19:00", "19:15"]` (19:00 and 19:15 are the nearest on each side; 18:45 is 22 min away vs 19:30 at 23).
  - `tie goes to the earlier time`: every table reserved 19:30–20:00 (blocks starts 18:15–19:45), request 19:00 → `["17:45", "18:00", "20:00"]` (17:45 and 20:15 tie at 75 min).
  - `fewer than 3 available`: every table reserved 17:00–20:45, request 19:00 → `["20:45", "21:00"]`.
  - `nothing free on the date` → `[]`.
  - `exports`: importing `findSlots` and `UnknownTableError` from `@frontdesk/core` (test lives in core, imports `../index`) works.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** ruling 6 in `findSlots` and the index exports.

- [ ] **Step 4: Run to verify they pass, then `pnpm verify`.**

- [ ] **Step 5: Commit** — `feat(core): return nearest alternatives for unavailable times`
