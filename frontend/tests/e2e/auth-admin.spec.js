import { expect, test } from "@playwright/test";

const adminEmail = process.env.PAYWATCH_BOOTSTRAP_ADMIN_EMAIL || "admin@paywatch.ai";
const adminPassword = process.env.PAYWATCH_BOOTSTRAP_ADMIN_PASSWORD || "PaywatchAdmin123!";
const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL || "http://127.0.0.1:8020";

async function login(page, email, password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Access Dashboard" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 20000 });
}

test("admin dashboard loads with realtime sections", async ({ page }) => {
  await login(page, adminEmail, adminPassword);

  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByText("Live monitoring and explainable decisions")).toBeVisible();
  await expect(page.locator(".stats-grid").getByText("Transactions")).toBeVisible();
  await expect(page.locator(".stats-grid").getByText("High Risk")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alert Panel" })).toBeVisible();
});

test("admin can approve a pending user from settings", async ({ page, request }) => {
  const pendingEmail = `pending_${Date.now()}@paywatch.ai`;
  const pendingPassword = "PendingUser123!";
  const pendingName = "Pending Analyst";

  const signupResponse = await request.post(`${apiBaseUrl}/auth/signup`, {
    data: {
      name: pendingName,
      email: pendingEmail,
      password: pendingPassword,
      role: "USER"
    }
  });
  expect(signupResponse.ok()).toBeTruthy();

  await login(page, adminEmail, adminPassword);
  await page.getByRole("link", { name: /Settings/ }).click();
  await expect(page).toHaveURL(/settings/);
  await expect(page.getByRole("heading", { name: "Access Control" })).toBeVisible();

  const userCard = page.locator(".alert-card", { hasText: pendingEmail }).first();
  await expect(userCard).toContainText("PENDING");
  await userCard.getByRole("button", { name: "Approve" }).click();
  await expect(userCard).toContainText("ACTIVE");

  await page.getByRole("button", { name: "Logout" }).click();
  await login(page, pendingEmail, pendingPassword);
  await expect(page).not.toHaveURL(/login/);
  await expect(page.locator(".user-chip")).toContainText(pendingEmail);
});
