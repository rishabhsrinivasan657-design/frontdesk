import { expect, test } from "@playwright/test";
import { details, auditTrail, bookAt, handoffCount, say, sessionId, storedTurns } from "./helpers";

const OPEN = "That time is open. What name and email should I use?";

test.beforeEach(async ({ page }) => {
  await page.goto("/talk");
  await expect(page.getByTestId("connection")).toHaveText("Connected");
});

test("books a table end to end", async ({ page }) => {
  await say(page, bookAt("19:00"));
  await expect(page.getByTestId("agent-message").last()).toHaveText(OPEN);
  await say(page, details());
  const card = page.getByTestId("confirmation-card");
  await expect(card).toContainText("a table for 4 on Saturday, November 7 at 7:00 PM");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("action-status")).toHaveText("Booked");
  await expect(page.getByTestId("latency")).toContainText("total");

  const session = await sessionId(page);
  await expect
    .poll(async () => (await auditTrail(session)).map((a) => a.stage))
    .toEqual(["proposed", "confirmed", "executed"]);
  await expect
    .poll(async () => (await storedTurns(session)).map((t) => [t.turnIndex, t.totalMs !== null]))
    .toEqual([
      [1, true],
      [2, true],
      [3, true],
    ]);
});

test("change before confirm voids the pending action", async ({ page }) => {
  await say(page, bookAt("20:00"));
  await expect(page.getByTestId("agent-message").last()).toHaveText(OPEN);
  await say(page, details());
  const card = page.getByTestId("confirmation-card");
  await expect(card).toContainText("8:00 PM");
  await card.getByRole("button", { name: "Change" }).click();
  await expect(page.getByTestId("action-status")).toHaveText("Withdrawn");

  await say(page, "Make it 20:30");
  await expect(page.getByTestId("agent-message").last()).toHaveText(OPEN);
  await say(page, details());
  await expect(card).toContainText("8:30 PM");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("action-status")).toHaveText("Booked");

  const trail = await auditTrail(await sessionId(page));
  const [first, second] = [...new Set(trail.map((a) => a.actionId))];
  expect(trail.filter((a) => a.actionId === first).map((a) => a.stage)).toEqual([
    "proposed",
    "voided",
  ]);
  expect(trail.filter((a) => a.actionId === second).map((a) => a.stage)).toEqual([
    "proposed",
    "confirmed",
    "executed",
  ]);
});

test("hands off to a person", async ({ page }) => {
  await say(page, "Can I talk to a person?");
  await expect(page.getByTestId("handoff-banner")).toBeVisible();
  await expect(page.getByTestId("composer-input")).toBeDisabled();
  const session = await sessionId(page);
  await expect.poll(() => handoffCount(session)).toBe(1);
});

test("reconnects mid-conversation and confirms", async ({ page }) => {
  await say(page, bookAt("21:00"));
  await expect(page.getByTestId("agent-message").last()).toHaveText(OPEN);
  await say(page, details());
  await expect(page.getByTestId("confirmation-card")).toContainText("9:00 PM");
  const before = await sessionId(page);

  await page.reload();
  await expect(page.getByTestId("connection")).toHaveText("Connected");
  expect(await sessionId(page)).toBe(before);
  await expect(page.getByTestId("caller-message")).toHaveCount(2);
  const card = page.getByTestId("confirmation-card");
  await expect(card).toContainText("9:00 PM");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("action-status")).toHaveText("Booked");
});

test("keeps the latest reply and the card in view, and the cursor in the box", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });
  const input = page.getByTestId("composer-input");
  for (const text of ["Hello", "Are you open late?", "Do you have parking?"]) {
    await say(page, text);
    await expect(input).toBeEnabled();
    // Typing straight on must work: focus comes back after every reply.
    await expect(input).toBeFocused();
  }
  await say(page, bookAt("18:00"));
  await expect(page.getByTestId("agent-message").last()).toHaveText(OPEN);
  await say(page, details());
  const confirm = page.getByTestId("confirmation-card").getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeInViewport();
  await confirm.click();
  await expect(page.getByTestId("action-status")).toBeInViewport();
  await expect(page.getByTestId("agent-message").last()).toBeInViewport();
});

test("a new chat passes the Turnstile check before connecting", async ({ page }) => {
  await expect(page.getByTestId("turnstile")).toBeAttached();
  await say(page, "What are your hours?");
  await expect(page.getByTestId("agent-message").last()).not.toBeEmpty();
});
