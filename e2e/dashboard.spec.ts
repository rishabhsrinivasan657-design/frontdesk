import { expect, test } from "@playwright/test";
import { details, bookAt, demoBookingSession, logIn, openDashboard, say } from "./helpers";

/** The owner dashboard (spec §10) on seeded demo data (global-setup.ts runs pnpm db:seed). */

const VIEWS = [
  "/dashboard",
  "/dashboard/conversations",
  "/dashboard/bookings",
  "/dashboard/handoffs",
  "/dashboard/feedback",
  "/dashboard/metrics",
];

test("redirects to login and back, and signs out", async ({ page }) => {
  for (const view of VIEWS) {
    await page.goto(view);
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(view)}`);
  }
  const deepLink = "/dashboard/bookings?source=pilot";
  await page.goto(deepLink);
  await logIn(page);
  await expect(page).toHaveURL(deepLink);
  await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("rejects a wrong password", async ({ page }) => {
  await page.goto("/login");
  await logIn(page, "not the password");
  // Next adds its own route-announcer alert, so pick ours by its text.
  await expect(
    page.getByRole("alert").filter({ hasText: "That email and password don't match." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("owner API is 401 without the cookie and never serves eval data", async ({
  page,
  request,
}) => {
  for (const path of ["metrics", "conversations", "bookings", "handoffs", "live", "me"]) {
    expect((await request.get(`/api/owner/${path}`)).status(), path).toBe(401);
  }
  await openDashboard(page);
  expect((await page.request.get("/api/owner/metrics")).status()).toBe(200);
  expect((await page.request.get("/api/owner/metrics?source=eval")).status()).toBe(400);
});

test("live shows a caller's session and its pending read-back", async ({ page, browser }) => {
  await openDashboard(page);
  await expect(page.getByTestId("live-status")).toHaveText("Streaming");

  const guest = await (await browser.newContext()).newPage();
  await guest.goto("/talk");
  await expect(guest.getByTestId("connection")).toHaveText("Connected");
  await say(guest, bookAt("18:30"));
  await say(guest, details());
  const readBack = guest.getByTestId("confirmation-card");
  await expect(readBack).toBeVisible();

  const card = page.getByTestId("live-card").filter({ has: page.getByTestId("pending-badge") });
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("pending-badge")).toContainText("Awaiting confirmation");

  await readBack.getByRole("button", { name: "Confirm" }).click();
  await expect(guest.getByTestId("action-status")).toHaveText("Booked");
  await expect(page.getByTestId("pending-badge")).toHaveCount(0);
  await expect(page.getByTestId("live-card").filter({ hasText: "Booked" }).first()).toBeVisible();
  await guest.context().close();
});

test("conversations search opens a transcript with tool calls, audit trail and latency", async ({
  page,
}) => {
  const session = await demoBookingSession();
  await openDashboard(page, "/dashboard/conversations");
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();

  await page.getByLabel("Search conversations").fill(session);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("conversation-row")).toHaveCount(1);
  await page.getByTestId("conversation-row").getByRole("link").click();

  await expect(page).toHaveURL(`/dashboard/conversations/${session}`);
  const transcript = page.getByTestId("transcript");
  await expect(
    transcript.getByRole("list", { name: "Latency for this turn" }).first(),
  ).toContainText("First reply");
  await expect(transcript).toContainText("check_availability");
  const audit = page.getByTestId("audit-trail");
  await expect(audit).toContainText("Proposed");
  await expect(audit).toContainText("Confirmed by caller");
  await expect(audit).toContainText("Written to Calendar");
});

test("bookings list seeded reservations", async ({ page }) => {
  await openDashboard(page, "/dashboard/bookings");
  expect(await page.getByTestId("booking-row").count()).toBeGreaterThan(10);
  await expect(page.getByTestId("booking-row").filter({ hasText: "Demo" }).first()).toBeVisible();
  await expect(page.getByText("Guests expected")).toBeVisible();
});

test("handoff resolve with a note and outcome moves it to Resolved", async ({ page }) => {
  await openDashboard(page, "/dashboard/handoffs");
  const card = page.getByTestId("handoff-card").first();
  const id = await card.getAttribute("id");
  const note = `Called back at ${Date.now()}; all sorted.`;
  await card.getByLabel("What did you do?").fill(note);
  await expect(card.getByRole("button", { name: "Mark resolved" })).toBeDisabled();
  await card.getByLabel("Outcome").selectOption({ label: "Staff booked it" });
  await card.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.locator(`[id="${id}"]`)).toHaveCount(0);

  await page.getByRole("tab", { name: "Resolved" }).click();
  await expect(page.locator(`[id="${id}"]`)).toContainText(note);
  await expect(page.locator(`[id="${id}"]`)).toContainText("Staff booked it");
});

test("metrics show KPIs and charts against the budget", async ({ page }) => {
  await openDashboard(page, "/dashboard/metrics");
  await expect(page.getByTestId("kpi")).toHaveCount(5);
  await expect(page.getByTestId("demo-pill")).toBeVisible();
  await expect(page.locator("svg.recharts-surface")).toHaveCount(4);
  await expect(page.getByText("p95 budget").first()).toBeVisible();
  await expect(page.getByTestId("stage-row")).toHaveCount(5);
  await expect(page.getByTestId("handoff-outcome-count")).toHaveCount(4);
});

test("pilot shows no demo data", async ({ page }) => {
  await openDashboard(page, "/dashboard/metrics?source=pilot");
  await expect(page.getByText("No pilot conversations yet")).toBeVisible();
  await page.goto("/dashboard/bookings?source=pilot");
  await expect(page.getByText("No bookings yet")).toBeVisible();
  await page.goto("/dashboard/conversations?source=pilot");
  await expect(page.getByText("No conversations yet")).toBeVisible();
});
