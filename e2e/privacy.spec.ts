import { expect, test } from "@playwright/test";

test("talk page shows the privacy notice and the link works", async ({ page }) => {
  await page.goto("/talk");
  const notice = page.getByTestId("privacy-notice");
  await expect(notice).toContainText(
    "What you type, and the name, phone or email you give, is stored for up to 30 days to run and improve the service, then deleted.",
  );
  await notice.getByRole("link", { name: "Privacy details" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
  await expect(page.getByText("Cloudflare Turnstile")).toBeVisible();
  await expect(page.getByText("30 days").first()).toBeVisible();
  // The exceptions are stated, not hidden behind "automatically".
  await expect(page.getByTestId("privacy-exceptions")).toContainText(
    "30 days after the reservation date",
  );
  await expect(page.getByTestId("privacy-exceptions")).toContainText("sent confirmation emails");
});
