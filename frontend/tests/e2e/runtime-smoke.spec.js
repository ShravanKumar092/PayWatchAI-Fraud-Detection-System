import { expect, test } from "@playwright/test";

test("dashboard renders without runtime errors in fallback mode", async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];

  page.on("pageerror", (error) => {
    pageErrors.push(String(error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.addInitScript(() => {
    localStorage.setItem("paywatch_token", "demo-token");
    localStorage.setItem("paywatch_role", "ADMIN");
    localStorage.setItem("paywatch_email", "demo@paywatch.ai");
  });

  await page.goto("/dashboard");
  await page.waitForTimeout(3000);

  expect(pageErrors, `Page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  expect(consoleErrors, `Console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
  await expect(page.locator("body")).not.toBeEmpty();
});
