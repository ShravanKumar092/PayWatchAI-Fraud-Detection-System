import { chromium } from "playwright";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL || "http://127.0.0.1:8020";
const adminEmail = process.env.PAYWATCH_BOOTSTRAP_ADMIN_EMAIL || "admin@paywatch.ai";
const adminPassword = process.env.PAYWATCH_BOOTSTRAP_ADMIN_PASSWORD || "PaywatchAdmin123!";
const serviceApiKey = process.env.PAYWATCH_API_KEY || "paywatch-secure-key";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function apiJson(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${path} failed: ${payload.detail || response.status}`);
  }
  return payload;
}

async function seedDashboardData() {
  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": serviceApiKey
  };

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
    await apiJson("/predict", {
      method: "POST",
      headers,
      body: JSON.stringify(transaction)
    });
  }

  const alertsPayload = await apiJson("/alerts?limit=10", {
    headers: { "X-API-Key": serviceApiKey }
  });
  const alerts = alertsPayload.alerts || [];
  assert(alerts.length > 0, "Expected seeded alerts to exist");

  for (const alert of alerts.slice(-2)) {
    await apiJson("/alerts/assign", {
      method: "POST",
      headers,
      body: JSON.stringify({
        timestamp: alert.timestamp,
        assigned_to: adminEmail
      })
    });
  }

  await apiJson("/models/scheduler/check", {
    method: "POST",
    headers,
    body: JSON.stringify({ force: false })
  });
}

async function login(page) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Access Dashboard" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 20000 });
}

async function verifyFeature(name, fn, results) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", detail: error.message });
    throw error;
  }
}

const results = [];
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true
});

try {
  await seedDashboardData();
  const context = await browser.newContext();
  const page = await context.newPage();

  await login(page);
  await page.goto(`${baseUrl}/dashboard`);
  const refreshButton = page.getByRole("button", { name: /Refresh Dashboard/i });
  await refreshButton.waitFor({ state: "visible" });
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/dashboard/snapshot") && response.status() === 200),
    refreshButton.click()
  ]);
  await page.getByRole("heading", { name: "Executive Command Center" }).waitFor({ state: "visible" });

  await verifyFeature("1. Executive KPI strip", async () => {
    const cards = page.locator(".executive-kpi-grid .stat-card");
    assert((await cards.count()) === 4, "Expected 4 KPI cards");
    const transactionsCardText = await cards.filter({ hasText: "Transactions" }).first().textContent();
    assert(transactionsCardText.includes("Today"), "Transactions KPI missing Today");
    assert(transactionsCardText.includes("Last 1h"), "Transactions KPI missing Last 1h");
    assert(transactionsCardText.includes("7d"), "Transactions KPI missing 7d delta");
  }, results);

  await verifyFeature("2. Real-time line/area charts", async () => {
    for (const title of ["Transaction Volume", "Fraud Rate", "Anomaly Score", "Alert Spikes"]) {
      await page.getByRole("heading", { name: title }).waitFor({ state: "visible" });
    }
    assert((await page.locator(".dashboard-chart-grid .trend-chart").count()) === 4, "Expected 4 dashboard charts");
  }, results);

  await verifyFeature("3. Top anomalies panel", async () => {
    await page.getByRole("heading", { name: "Top Anomalies" }).waitFor({ state: "visible" });
    assert((await page.locator(".anomaly-card").count()) > 0, "Expected anomaly cards");
    assert((await page.locator(".reason-chip").count()) > 0, "Expected anomaly reason chips");
  }, results);

  await verifyFeature("4. Risk heatmap", async () => {
    await page.getByRole("heading", { name: "Risk Heatmap" }).waitFor({ state: "visible" });
    assert((await page.locator(".heatmap-row").count()) > 0, "Expected heatmap rows");
    assert((await page.locator(".heatmap-cell").count()) > 0, "Expected heatmap cells");
  }, results);

  await verifyFeature("5. Global filters", async () => {
    const riskSelect = page.locator("label").filter({ hasText: "Risk" }).locator("select");
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/dashboard/snapshot") && response.status() === 200),
      riskSelect.selectOption("HIGH")
    ]);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/dashboard/snapshot") && response.status() === 200),
      riskSelect.selectOption("ALL")
    ]);
  }, results);

  await verifyFeature("6. Live activity ticker", async () => {
    await page.getByRole("heading", { name: "Live Activity Ticker" }).waitFor({ state: "visible" });
    assert((await page.locator(".ticker-item").count()) > 0, "Expected activity ticker items");
  }, results);

  await verifyFeature("7. Drill-down dashboard cards", async () => {
    await page.locator(".executive-kpi-grid .stat-card").filter({ hasText: "High Risk" }).first().click();
    await page.waitForURL(/transactions\?risk=HIGH/);
    await page.getByRole("link", { name: /Dashboard/ }).click();
    await page.waitForURL(/dashboard/);

    await page.locator(".executive-kpi-grid .stat-card").filter({ hasText: "Anomaly Layer" }).first().click();
    await page.waitForURL(/transactions\?anomaly=0\.5/);
    await page.getByRole("link", { name: /Dashboard/ }).click();
    await page.waitForURL(/dashboard/);
  }, results);

  await verifyFeature("8. System health widget", async () => {
    await page.getByRole("heading", { name: "System Health" }).waitFor({ state: "visible" });
    for (const label of ["API Latency", "Kafka", "Redis", "Stream Freshness", "Model Version"]) {
      assert((await page.locator(".health-card").filter({ hasText: label }).count()) > 0, `Missing system health metric ${label}`);
    }
  }, results);

  await verifyFeature("9. Personal analyst workspace", async () => {
    await page.getByRole("heading", { name: "Personal Analyst Workspace" }).waitFor({ state: "visible" });
    assert((await page.locator(".workspace-metric").filter({ hasText: "Assigned Alerts" }).count()) > 0, "Missing assigned alerts metric");
    assert((await page.locator(".workspace-metric").filter({ hasText: "Pending Reviews" }).count()) > 0, "Missing pending reviews metric");
    await page.waitForFunction(
      () => document.querySelectorAll(".workspace-panel .workspace-card").length > 0,
      { timeout: 10000 }
    );
    assert((await page.locator(".workspace-panel .workspace-card").count()) > 0, "Expected workspace cards");
  }, results);

  await verifyFeature("10. Smart summary box", async () => {
    await page.getByRole("heading", { name: "Smart Summary" }).waitFor({ state: "visible" });
    const summary = (await page.locator(".smart-summary-text").textContent()) || "";
    assert(summary.trim().length > 0, "Smart summary is empty");
    assert(!summary.includes("Waiting for enough events"), "Smart summary is still in empty state");
  }, results);

  console.log(JSON.stringify({ status: "ok", results }, null, 2));
  await context.close();
} catch (error) {
  console.log(JSON.stringify({ status: "error", results, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
