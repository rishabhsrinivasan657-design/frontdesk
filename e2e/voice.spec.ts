import { expect, test } from "@playwright/test";
import { DETAILS, auditTrail, bookAt, say, sessionId, storedTurns } from "./helpers";
import {
  cancels,
  finishSpeaking,
  installVoiceMock,
  speak,
  spoken,
  startSpeaking,
} from "./voice-mock";

const OPEN = "That time is open. What name and email should I use?";
const OTHER = "How can I help with a reservation?";

async function open(page: import("@playwright/test").Page) {
  await page.goto("/talk");
  await expect(page.getByTestId("connection")).toHaveText("Connected");
}

test("books a table by voice", async ({ page }) => {
  await installVoiceMock(page);
  await open(page);

  await startSpeaking(page, "A table for 4");
  await expect(page.getByTestId("interim-transcript")).toHaveText("A table for 4");
  await finishSpeaking(page, bookAt("19:00"));
  await expect(page.getByTestId("caller-message").last()).toHaveText(bookAt("19:00"));
  await expect(page.getByTestId("agent-message").last()).toHaveText(OPEN);
  await expect
    .poll(() => spoken(page))
    .toEqual(["That time is open.", "What name and email should I use?"]);

  await speak(page, DETAILS);
  await expect(page.getByTestId("confirmation-card")).toContainText("7:00 PM");
  await speak(page, "Yes, please");
  await expect(page.getByTestId("action-status")).toHaveText("Booked");
  await expect(page.getByTestId("latency")).toContainText("stt");

  const session = await sessionId(page);
  await expect
    .poll(async () => (await auditTrail(session)).map((a) => a.stage))
    .toEqual(["proposed", "confirmed", "executed"]);
  await expect
    .poll(async () =>
      (await storedTurns(session)).map((t) => [
        t.turnIndex,
        t.sttMs !== null,
        t.ttsStartMs !== null,
      ]),
    )
    .toEqual([
      [1, true, true],
      [2, true, true],
      [3, true, true],
    ]);
});

test("a spoken yes with nothing pending runs a normal turn", async ({ page }) => {
  await installVoiceMock(page);
  await open(page);
  await speak(page, "yes");
  await expect(page.getByTestId("agent-message").last()).toHaveText(OTHER);
  await expect(page.getByTestId("confirmation-card")).toHaveCount(0);
  expect(await auditTrail(await sessionId(page))).toEqual([]);
});

test("barge-in stops speech and sends interrupt", async ({ page }) => {
  await installVoiceMock(page, { holdSpeech: true });
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  await open(page);

  await speak(page, bookAt("19:30"));
  await expect.poll(() => spoken(page)).toEqual(["That time is open."]);
  await startSpeaking(page, "Actually");
  expect(await cancels(page)).toBeGreaterThanOrEqual(1);
  expect(frames.map((f) => JSON.parse(f) as { type: string })).toContainEqual({
    type: "interrupt",
  });
  // The rest of the interrupted reply is never spoken.
  expect(await spoken(page)).toEqual(["That time is open."]);

  await finishSpeaking(page, "Actually, can I talk to someone about the menu?");
  await expect(page.getByTestId("caller-message").last()).toHaveText(
    "Actually, can I talk to someone about the menu?",
  );
  await expect(page.getByTestId("agent-message").last()).not.toHaveText(OPEN);
});

test("falls back to typing when recognition is unsupported", async ({ page }) => {
  await installVoiceMock(page, { supported: false });
  await open(page);
  await expect(page.getByTestId("voice-notice")).toHaveText(
    "Voice isn't available in this browser. Try Chrome, Edge or Safari — or just type below.",
  );
  await expect(page.getByTestId("mic-button")).toBeDisabled();
  await say(page, bookAt("19:00"));
  await expect(page.getByTestId("agent-message").last()).toHaveText(OPEN);
});

test("explains a blocked microphone and keeps typing working", async ({ page }) => {
  await installVoiceMock(page, { deny: true });
  await open(page);
  await page.getByTestId("mic-button").click();
  await expect(page.getByTestId("voice-notice")).toHaveText(
    "Microphone access is blocked. Allow it in your browser to talk, or just type below.",
  );
  await say(page, bookAt("19:00"));
  await expect(page.getByTestId("agent-message").last()).toHaveText(OPEN);
});
