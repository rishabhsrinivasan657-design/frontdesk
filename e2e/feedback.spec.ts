import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { openDashboard, say } from "./helpers";

/** The post-conversation rating (spec §12): caller rates in /talk, owner reads it in Feedback. */
test("caller rates the chat and the owner sees it", async ({ page }) => {
  const comment = `Lovely and quick ${randomUUID().slice(0, 8)}`;
  await page.goto("/talk");
  await expect(page.getByTestId("connection")).toHaveText("Connected");
  await say(page, "What are your hours?");
  await expect(page.getByTestId("agent-message").last()).not.toBeEmpty();
  await page.getByRole("button", { name: "End chat" }).click();

  const form = page.getByTestId("feedback-form");
  await expect(page.getByTestId("composer-input")).toBeDisabled();
  await form.getByRole("button", { name: "4 stars" }).click();
  await form.getByLabel("Comment (optional)").fill(comment);
  await form.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("feedback-thanks")).toHaveText("Thanks for the feedback.");

  await openDashboard(page, "/dashboard/feedback");
  const row = page.getByTestId("feedback-row").filter({ hasText: comment });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("feedback-rating")).toHaveAttribute(
    "aria-label",
    "4 out of 5 stars",
  );
});
