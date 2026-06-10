import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAppData } from "../context/AppDataContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { getAnalytics, getDashboardSnapshot } from "../services/api";

function downloadText(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatDecimal(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function reportRoute(routeFromContext, pathname) {
  return routeFromContext || pathname || "/dashboard";
}

function headlineForRoute(pathname) {
  const headlineByRoute = {
    "/dashboard": "Executive Dashboard Snapshot",
    "/analytics": "Model Analytics Executive Summary",
    "/alerts": "Alert Operations Executive Summary",
    "/transactions": "Transaction Investigation Executive Summary",
    "/settings": "Platform Controls Executive Summary",
  };
  return headlineByRoute[pathname] || "PayWatch AI Executive Summary";
}

function deriveReportMetrics({ pathname, dashboardSnapshot, analyticsSnapshot, stats, alerts, transactions }) {
  const kpiStrip = dashboardSnapshot?.kpi_strip || [];
  const chartSeries = dashboardSnapshot?.chart_series || [];
  const latestBucket = chartSeries[chartSeries.length - 1] || {};
  const previousBucket = chartSeries[chartSeries.length - 2] || latestBucket;
  const fraudRateFromKpi = kpiStrip.find((item) => item.label === "Fraud Rate")?.value;
  const transactionsMetric = kpiStrip.find((item) => item.label === "Transactions")?.value;
  const highRiskMetric = kpiStrip.find((item) => item.label === "High Risk")?.value;
  const anomalyMetric = kpiStrip.find((item) => item.label === "Anomaly Layer")?.value;
  const totalTransactions = Number(
    transactionsMetric ??
      dashboardSnapshot?.transactions?.length ??
      stats?.total_transactions ??
      transactions?.length ??
      0
  );
  const highRisk = Number(
    highRiskMetric ??
      stats?.high_risk_count ??
      alerts?.filter?.((item) => String(item.risk_level || "").toUpperCase() === "HIGH").length ??
      0
  );
  const fraudRate = fraudRateFromKpi ?? (totalTransactions ? highRisk / Math.max(totalTransactions, 1) : 0);
  const activeModel =
    analyticsSnapshot?.active_model?.version ||
    analyticsSnapshot?.model_registry?.active_version ||
    dashboardSnapshot?.system_health?.model_version ||
    "baseline";
  const movingAverage = Number(latestBucket.moving_average || 0);
  const anomalyScore = Number(latestBucket.anomaly_score ?? latestBucket.anomaly ?? anomalyMetric ?? 0);
  const alertVolume = Number(dashboardSnapshot?.alerts?.length || alerts?.length || 0);
  const kafkaStatus =
    dashboardSnapshot?.system_health?.kafka_status ||
    (dashboardSnapshot?.system_health?.kafka_connected ? "online" : "offline");
  const apiLatency = Number(dashboardSnapshot?.system_health?.api_latency_ms || 0);
  const trendDelta = Number(latestBucket.fraud_rate || 0) - Number(previousBucket.fraud_rate || 0);
  const summaryText =
    dashboardSnapshot?.smart_summary ||
    `Fraud rate is ${trendDelta >= 0 ? "up" : "down"} ${formatPercent(Math.abs(trendDelta))} versus the previous live bucket.`;

  return {
    pathname,
    headline: headlineForRoute(pathname),
    totalTransactions,
    highRisk,
    fraudRate,
    activeModel,
    movingAverage,
    anomalyScore,
    alertVolume,
    kafkaStatus,
    apiLatency,
    summaryText,
    latestBucket,
    chartSeries,
    analyticsSnapshot,
    dashboardSnapshot,
  };
}

function buildReport(metrics) {
  const {
    headline,
    totalTransactions,
    highRisk,
    fraudRate,
    activeModel,
    movingAverage,
    anomalyScore,
    alertVolume,
    kafkaStatus,
    apiLatency,
    summaryText,
    latestBucket,
    chartSeries,
    analyticsSnapshot,
  } = metrics;
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const threshold = analyticsSnapshot?.threshold_simulator?.recommended_threshold?.threshold;
  const precision = analyticsSnapshot?.performance_panels?.summary?.precision;
  const recall = analyticsSnapshot?.performance_panels?.summary?.recall;
  const forecastHour = analyticsSnapshot?.forecast?.next_hour_alerts ?? 0;

  const summary = [
    headline,
    "",
    `Generated at: ${generatedAt}`,
    `Total transactions: ${totalTransactions}`,
    `High risk: ${highRisk}`,
    `Fraud rate: ${formatPercent(fraudRate)}`,
    `Open alerts: ${alertVolume}`,
    `Moving average: ${formatDecimal(movingAverage, 1)}`,
    `Anomaly score: ${formatPercent(anomalyScore)}`,
    `Kafka status: ${String(kafkaStatus || "unknown").toUpperCase()}`,
    `API latency: ${Math.round(apiLatency)} ms`,
    `Active model: ${activeModel}`,
    "",
    "Operational Highlights:",
    `- ${summaryText}`,
    `- Latest bucket volume is ${latestBucket.count || latestBucket.volume || 0} with fraud rate ${formatPercent(latestBucket.fraud_rate || fraudRate)}.`,
    `- Recommended threshold is ${threshold !== undefined ? threshold.toFixed(2) : "n/a"}, with precision ${precision !== undefined ? formatPercent(precision) : "n/a"} and recall ${recall !== undefined ? formatPercent(recall) : "n/a"}.`,
    `- Forecast expects ${forecastHour} alerts over the next hour.`,
  ].join("\n");

  const trendRows = chartSeries
    .slice(-8)
    .map(
      (item) => `
            <tr>
              <td>${item.bucket || ""}</td>
              <td>${item.count || item.volume || 0}</td>
              <td>${formatDecimal(item.moving_average || 0, 1)}</td>
              <td>${formatPercent(item.fraud_rate || 0)}</td>
              <td>${formatPercent(item.anomaly_score ?? item.anomaly ?? 0)}</td>
            </tr>`
    )
    .join("");

  const html = `
    <html>
      <head>
        <title>${headline}</title>
        <style>
          body { font-family: Segoe UI, sans-serif; padding: 32px; color: #12233d; }
          h1 { margin-bottom: 8px; }
          .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 24px 0; }
          .card { border: 1px solid #d4deec; border-radius: 16px; padding: 16px; }
          .card strong { display: block; margin-bottom: 6px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { border-bottom: 1px solid #e8edf5; padding: 10px; text-align: left; }
          pre { white-space: pre-wrap; font-family: Segoe UI, sans-serif; }
        </style>
      </head>
      <body>
        <h1>${headline}</h1>
        <p>Generated from the current PayWatch AI workspace state.</p>
        <div class="grid">
          <div class="card"><strong>Total Transactions</strong><div>${totalTransactions}</div></div>
          <div class="card"><strong>High Risk</strong><div>${highRisk}</div></div>
          <div class="card"><strong>Anomaly Score</strong><div>${formatPercent(anomalyScore)}</div></div>
          <div class="card"><strong>Active Model</strong><div>${activeModel}</div></div>
        </div>
        <h2>Executive Summary</h2>
        <pre>${summary}</pre>
        <h2>Recent Live Buckets</h2>
        <table>
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Volume</th>
              <th>Moving Avg</th>
              <th>Fraud Rate</th>
              <th>Anomaly</th>
            </tr>
          </thead>
          <tbody>${trendRows}</tbody>
        </table>
      </body>
    </html>
  `;
  return { headline, summary, html };
}

export default function ReportCenter() {
  const { token } = useAuth();
  const { reportOpen, closeReport, reportContext } = useWorkspace();
  const { pathname } = useLocation();
  const { stats, alerts, transactions, analytics } = useAppData();
  const [dashboardSnapshot, setDashboardSnapshot] = useState(null);
  const [analyticsSnapshot, setAnalyticsSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const activePath = reportRoute(reportContext?.route, pathname);

  async function loadReportData() {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const [dashboardPayload, analyticsPayload] = await Promise.all([
        getDashboardSnapshot(token, {}),
        getAnalytics(token),
      ]);
      setDashboardSnapshot(dashboardPayload);
      setAnalyticsSnapshot(analyticsPayload);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Unable to refresh report data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!reportOpen || !token) {
      return undefined;
    }

    let cancelled = false;
    loadReportData();
    const timer = window.setInterval(() => {
      if (!cancelled) {
        loadReportData();
      }
    }, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [reportOpen, token, activePath]);

  const metrics = useMemo(
    () =>
      deriveReportMetrics({
        pathname: activePath,
        dashboardSnapshot,
        analyticsSnapshot: analyticsSnapshot || analytics,
        stats,
        alerts,
        transactions,
      }),
    [activePath, alerts, analytics, analyticsSnapshot, dashboardSnapshot, stats, transactions]
  );

  const report = useMemo(() => buildReport(metrics), [metrics]);

  if (!reportOpen) {
    return null;
  }

  return (
    <div className="report-backdrop" role="dialog" aria-modal="true" aria-label="Executive report" onClick={closeReport}>
      <div className="report-center" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <h3>{report.headline}</h3>
            <p>Print-ready snapshot and executive summary for demos, reviews, and PDF export.</p>
          </div>
          <div className="inline-form">
            <button
              className="secondary-button"
              type="button"
              onClick={loadReportData}
            >
              {loading ? "Refreshing..." : "Refresh Report"}
            </button>
            <button className="ghost-button" type="button" onClick={closeReport}>
              Close
            </button>
          </div>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        <pre className="report-preview">{report.summary}</pre>
        <div className="inline-form">
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              const popup = window.open("", "_blank", "width=900,height=700");
              if (popup) {
                popup.document.write(report.html);
                popup.document.close();
                popup.print();
              }
            }}
          >
            Print / Save PDF
          </button>
          <button className="secondary-button" type="button" onClick={() => downloadText("paywatch-executive-summary.txt", "text/plain;charset=utf-8", report.summary)}>
            Download TXT
          </button>
          <button className="secondary-button" type="button" onClick={() => downloadText("paywatch-executive-summary.html", "text/html;charset=utf-8", report.html)}>
            Download HTML
          </button>
        </div>
      </div>
    </div>
  );
}
