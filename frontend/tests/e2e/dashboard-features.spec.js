import { expect, test } from "@playwright/test";

const adminEmail = process.env.PAYWATCH_BOOTSTRAP_ADMIN_EMAIL || "admin@paywatch.ai";
const adminPassword = process.env.PAYWATCH_BOOTSTRAP_ADMIN_PASSWORD || "PaywatchAdmin123!";
const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL || "http://127.0.0.1:8020";
const serviceApiKey = process.env.PAYWATCH_API_KEY || "paywatch-secure-key";

async function login(page, email, password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Access Dashboard" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 20000 });
}

async function seedDashboardData(request) {
  const headers = { "X-API-Key": serviceApiKey };
  const transactions = [
    {
      step: 3,
      type: "PAYMENT",
      amount: 320,
      oldbalanceOrg: 4000,
      newbalanceOrig: 3680,
      oldbalanceDest: 1000,
      newbalanceDest: 1320,
      source_account: "ui-seed-user-1",
      destination_account: "ui-seed-merchant-1"
    },
    {
      step: 5,
      type: "TRANSFER",
      amount: 12500,
      oldbalanceOrg: 22000,
      newbalanceOrig: 9500,
      oldbalanceDest: 2000,
      newbalanceDest: 14500,
      source_account: "ui-seed-user-2",
      destination_account: "ui-seed-ring-node"
    },
    {
      step: 7,
      type: "CASH_OUT",
      amount: 25000,
      oldbalanceOrg: 50000,
      newbalanceOrig: 25000,
      oldbalanceDest: 3000,
      newbalanceDest: 28000,
      source_account: "ui-seed-user-2",
      destination_account: "ui-seed-ring-node"
    },
    {
      step: 8,
      type: "CASH_OUT",
      amount: 30000,
      oldbalanceOrg: 60000,
      newbalanceOrig: 30000,
      oldbalanceDest: 4000,
      newbalanceDest: 34000,
      source_account: "ui-seed-user-2",
      destination_account: "ui-seed-ring-node-2"
    },
    {
      step: 10,
      type: "DEBIT",
      amount: 850,
      oldbalanceOrg: 3200,
      newbalanceOrig: 2350,
      oldbalanceDest: 1200,
      newbalanceDest: 2050,
      source_account: "ui-seed-user-3",
      destination_account: "ui-seed-merchant-2"
    },
    {
      step: 12,
      type: "TRANSFER",
      amount: 18000,
      oldbalanceOrg: 26000,
      newbalanceOrig: 8000,
      oldbalanceDest: 1000,
      newbalanceDest: 19000,
      source_account: "ui-seed-user-4",
      destination_account: "ui-seed-ring-node-3"
    }
  ];

  for (const transaction of transactions) {
    const response = await request.post(`${apiBaseUrl}/predict`, {
      headers,
      data: transaction
    });
    expect(response.ok()).toBeTruthy();
  }

  const alertsResponse = await request.get(`${apiBaseUrl}/alerts?limit=10`, { headers });
  expect(alertsResponse.ok()).toBeTruthy();
  const alertsPayload = await alertsResponse.json();
  const alerts = alertsPayload.alerts || [];
  expect(alerts.length).toBeGreaterThan(0);

  await request.post(`${apiBaseUrl}/alerts/assign`, {
    headers,
    data: {
      timestamp: alerts[0].timestamp,
      assigned_to: adminEmail
    }
  });

  await request.post(`${apiBaseUrl}/models/scheduler/check`, {
    headers,
    data: { force: false }
  });
}

test("dashboard exposes the 10 executive monitoring features in the running UI", async ({ page, request }) => {
  await seedDashboardData(request);
  await login(page, adminEmail, adminPassword);
  await expect(page).toHaveURL(/dashboard/);

  const refreshButton = page.getByRole("button", { name: /Refresh Dashboard/i });
  await expect(refreshButton).toBeVisible();
  await refreshButton.click();

  await expect(page.getByRole("heading", { name: "Executive Command Center" })).toBeVisible();

  await test.step("1. Executive KPI strip with today, last 1h, 7d delta, and trend arrows", async () => {
    const cards = page.locator(".executive-kpi-grid .stat-card");
    await expect(cards).toHaveCount(4);
    await expect(cards.filter({ hasText: "Transactions" })).toContainText("Today");
    await expect(cards.filter({ hasText: "Transactions" })).toContainText("Last 1h");
    await expect(cards.filter({ hasText: "Transactions" })).toContainText("7d");
    await expect(cards.filter({ hasText: "High Risk" })).toBeVisible();
    await expect(cards.filter({ hasText: "Fraud Rate" })).toBeVisible();
    await expect(cards.filter({ hasText: "Anomaly Layer" })).toBeVisible();
  });

  await test.step("2. Real-time line and area charts for volume, fraud rate, anomaly score, and alert spikes", async () => {
    await expect(page.getByRole("heading", { name: "Transaction Volume" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fraud Rate" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Anomaly Score" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alert Spikes" })).toBeVisible();
    await expect(page.locator(".dashboard-chart-grid .trend-chart")).toHaveCount(4);
  });

  await test.step("3. Top anomalies panel with suspicious transactions and reason codes", async () => {
    await expect(page.getByRole("heading", { name: "Top Anomalies" })).toBeVisible();
    const anomalyCards = page.locator(".anomaly-card");
    await expect(anomalyCards.first()).toBeVisible();
    expect(await page.locator(".reason-chip").count()).toBeGreaterThan(0);
  });

  await test.step("4. Risk heatmap by hour and transaction type", async () => {
    await expect(page.getByRole("heading", { name: "Risk Heatmap" })).toBeVisible();
    await expect(page.locator(".heatmap-row").first()).toBeVisible();
    await expect(page.locator(".heatmap-cell").first()).toBeVisible();
  });

  await test.step("5. Global filters update the dashboard snapshot", async () => {
    const riskSelect = page.locator("label").filter({ hasText: "Risk" }).locator("select");
    await expect(page.locator("label").filter({ hasText: "Time Range" }).locator("select")).toBeVisible();
    await expect(page.locator("label").filter({ hasText: "Transaction Type" }).locator("select")).toBeVisible();
    await expect(page.locator("label").filter({ hasText: "Model View" }).locator("select")).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/dashboard/snapshot") && response.status() === 200),
      riskSelect.selectOption("HIGH")
    ]);
    await expect(page.getByRole("heading", { name: "Smart Summary" })).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/dashboard/snapshot") && response.status() === 200),
      riskSelect.selectOption("ALL")
    ]);
  });

  await test.step("6. Live activity ticker shows operational events", async () => {
    await expect(page.getByRole("heading", { name: "Live Activity Ticker" })).toBeVisible();
    const ticker = page.locator(".ticker-item");
    await expect(ticker.first()).toBeVisible();
  });

  await test.step("7. Drill-down cards navigate to filtered transactions", async () => {
    await page.locator(".executive-kpi-grid .stat-card").filter({ hasText: "High Risk" }).click();
    await expect(page).toHaveURL(/transactions\?risk=HIGH/);
    await page.getByRole("link", { name: /Dashboard/ }).click();
    await expect(page).toHaveURL(/dashboard/);

    await page.locator(".executive-kpi-grid .stat-card").filter({ hasText: "Anomaly Layer" }).click();
    await expect(page).toHaveURL(/transactions\?anomaly=0\.5/);
    await page.getByRole("link", { name: /Dashboard/ }).click();
    await expect(page).toHaveURL(/dashboard/);
  });

  await test.step("8. System health widget surfaces platform state", async () => {
    await expect(page.getByRole("heading", { name: "System Health" })).toBeVisible();
    await expect(page.locator(".health-card").filter({ hasText: "API Latency" })).toBeVisible();
    await expect(page.locator(".health-card").filter({ hasText: "Kafka" })).toBeVisible();
    await expect(page.locator(".health-card").filter({ hasText: "Redis" })).toBeVisible();
    await expect(page.locator(".health-card").filter({ hasText: "Stream Freshness" })).toBeVisible();
    await expect(page.locator(".health-card").filter({ hasText: "Model Version" })).toBeVisible();
  });

  await test.step("9. Personal analyst workspace shows assigned alerts and recent actions", async () => {
    await expect(page.getByRole("heading", { name: "Personal Analyst Workspace" })).toBeVisible();
    await expect(page.locator(".workspace-metric").filter({ hasText: "Assigned Alerts" })).toBeVisible();
    await expect(page.locator(".workspace-metric").filter({ hasText: "Pending Reviews" })).toBeVisible();
    await expect(page.locator(".workspace-card").first()).toBeVisible();
  });

  await test.step("10. Smart summary explains the current fraud window in natural language", async () => {
    await expect(page.getByRole("heading", { name: "Smart Summary" })).toBeVisible();
    const summary = page.locator(".smart-summary-text");
    await expect(summary).toBeVisible();
    await expect(summary).not.toContainText("Waiting for enough events");
  });
});
