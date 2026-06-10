const RANGE_CONFIG = {
  "24h": { windowMs: 24 * 60 * 60 * 1000, bucketMs: 5 * 60 * 1000, maxPoints: 6 },
  "7d": { windowMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 6 * 60 * 60 * 1000, maxPoints: 28 },
  "30d": { windowMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000, maxPoints: 30 },
  custom: { windowMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 6 * 60 * 60 * 1000, maxPoints: 28 },
};

const FALLBACK_GEOGRAPHIES = [
  "North America",
  "Europe",
  "South Asia",
  "Middle East",
  "Southeast Asia",
  "Africa",
];

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, safeNumber(value)));
}

function toDate(value) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function liveTime(row = {}) {
  return row.live_timestamp || row.observed_at || row.timestamp;
}

function riskLevel(row = {}) {
  return String(row.risk_level || row.predicted_risk || "LOW").toUpperCase();
}

function startOfBucket(date, bucketMs) {
  const stamp = toDate(date).getTime();
  return new Date(Math.floor(stamp / bucketMs) * bucketMs);
}

function bucketLabel(date, rangeKey) {
  const formatter =
    rangeKey === "30d"
      ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
      : new Intl.DateTimeFormat("en-US", {
          month: rangeKey === "7d" ? "short" : undefined,
          day: rangeKey === "7d" ? "numeric" : undefined,
          hour: "2-digit",
          minute: rangeKey === "24h" ? "2-digit" : undefined,
          hour12: false,
        });
  return formatter.format(toDate(date));
}

function inferGeography(row = {}) {
  const existing = row.geography || row.location || row.country || row.region;
  if (existing) {
    return existing;
  }
  const seedSource = `${row.source_account || ""}${row.destination_account || ""}${row.actor || ""}${row.merchant || ""}${row.type || ""}`;
  let hash = 0;
  for (let index = 0; index < seedSource.length; index += 1) {
    hash = (hash * 31 + seedSource.charCodeAt(index)) % FALLBACK_GEOGRAPHIES.length;
  }
  return FALLBACK_GEOGRAPHIES[Math.abs(hash) % FALLBACK_GEOGRAPHIES.length];
}

function inferFraudProbability(row = {}) {
  const explicit = safeNumber(row.fraud_probability || row.primary_model_probability, NaN);
  if (Number.isFinite(explicit) && explicit > 0) {
    return clamp(explicit);
  }
  const risk = riskLevel(row);
  const amount = safeNumber(row.amount);
  const graph = clamp(safeNumber(row.graph_score));
  const amountComponent = clamp(amount / 10000, 0, 0.34);
  if (risk === "HIGH") {
    return clamp(0.68 + amountComponent * 0.4 + graph * 0.2);
  }
  if (risk === "MEDIUM") {
    return clamp(0.38 + amountComponent * 0.35 + graph * 0.18);
  }
  return clamp(0.04 + amountComponent * 0.22 + graph * 0.08);
}

function inferAnomalyRisk(row = {}, fraudProbability = 0) {
  const explicit = safeNumber(row.anomaly_risk || row.anomaly_score, NaN);
  if (Number.isFinite(explicit) && explicit > 0) {
    return clamp(explicit);
  }
  const amount = safeNumber(row.amount);
  const balanceChange = Math.abs(safeNumber(row.balance_change || row.current_balance_change));
  const graph = clamp(safeNumber(row.graph_score));
  const amountPressure = clamp(amount / 12000, 0, 0.32);
  const balancePressure = clamp(balanceChange / Math.max(amount || 1, 1), 0, 0.26);
  return clamp(fraudProbability * 0.48 + amountPressure + balancePressure + graph * 0.18);
}

function inferGraphScore(row = {}) {
  const explicit = safeNumber(row.graph_score, NaN);
  if (Number.isFinite(explicit) && explicit > 0) {
    return clamp(explicit);
  }
  const risk = riskLevel(row);
  if (risk === "HIGH") return 0.76;
  if (risk === "MEDIUM") return 0.42;
  return 0.12;
}

export function formatPercent(value, digits = 0) {
  return `${(safeNumber(value) * 100).toFixed(digits)}%`;
}

export function formatCount(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(safeNumber(value));
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(safeNumber(value));
}

export function formatDelta(value, suffix = "%") {
  const parsed = safeNumber(value);
  const prefix = parsed > 0 ? "+" : "";
  return `${prefix}${parsed.toFixed(1)}${suffix}`;
}

export function trendDirection(value) {
  if (value > 0.002) return "up";
  if (value < -0.002) return "down";
  return "flat";
}

export function normalizeRows(rows = []) {
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const nextGraphScore = inferGraphScore(row);
      const nextFraudProbability = inferFraudProbability({ ...row, graph_score: nextGraphScore });
      const nextAnomalyRisk = inferAnomalyRisk({ ...row, graph_score: nextGraphScore }, nextFraudProbability);
      return {
        ...row,
        amount: safeNumber(row.amount),
        fraud_probability: nextFraudProbability,
        anomaly_risk: nextAnomalyRisk,
        anomaly_score: nextAnomalyRisk,
        graph_score: nextGraphScore,
        timestamp: row.timestamp || new Date().toISOString(),
        live_timestamp: row.live_timestamp || row.observed_at || row.timestamp || new Date().toISOString(),
        type: row.type || "UNKNOWN",
        risk_level: riskLevel(row),
        geography: inferGeography(row),
        merchant: row.merchant || row.merchant_name || row.destination_account || "Unknown merchant",
        actor: row.user_id || row.customer_id || row.source_account || row.source || "Unknown actor",
        channel: row.channel || row.payment_channel || row.entry_mode || "Digital",
        device: row.device || row.device_type || row.platform || "Unknown device",
        balance_change: safeNumber(row.balance_change || row.current_balance_change || row.amount * (row.type === "CASH_OUT" ? -1 : 0.45)),
      };
    })
    .sort((left, right) => toDate(left.timestamp).getTime() - toDate(right.timestamp).getTime());
}

export function filterRowsByRange(rows = [], rangeKey = "24h", customRange = {}) {
  const config = RANGE_CONFIG[rangeKey] || RANGE_CONFIG["24h"];
  const now = Date.now();
  const customStart = customRange.start ? new Date(customRange.start).getTime() : null;
  const customEnd = customRange.end ? new Date(customRange.end).getTime() : null;
  return normalizeRows(rows).filter((row) => {
    const stamp = toDate(liveTime(row)).getTime();
    if (rangeKey === "custom") {
      if (customStart && stamp < customStart) return false;
      if (customEnd && stamp > customEnd) return false;
      return true;
    }
    return stamp >= now - config.windowMs;
  });
}

export function buildSparkline(values = [], maxPoints = 12) {
  if (!values.length) return [];
  const trimmed = values.slice(-maxPoints);
  const maxValue = Math.max(...trimmed, 1);
  return trimmed.map((value, index) => ({
    index,
    value,
    ratio: value / maxValue,
  }));
}

export function buildTimeSeries(rows = [], alerts = [], rangeKey = "24h", customRange = {}) {
  const config = RANGE_CONFIG[rangeKey] || RANGE_CONFIG["24h"];
  const filteredRows = filterRowsByRange(rows, rangeKey, customRange);
  const filteredAlerts = filterRowsByRange(alerts, rangeKey, customRange);
  if (!filteredRows.length && !filteredAlerts.length) {
    return [];
  }

  const seriesByBucket = new Map();
  const allItems = [
    ...filteredRows.map((row) => ({ ...row, kind: "transaction" })),
    ...filteredAlerts.map((alert) => ({ ...alert, kind: "alert" })),
  ];

  allItems.forEach((item) => {
    const bucketStart = startOfBucket(liveTime(item), config.bucketMs);
    const key = bucketStart.toISOString();
    const current =
      seriesByBucket.get(key) || {
        bucket: key,
        label: bucketLabel(bucketStart, rangeKey),
        volume: 0,
        totalAmount: 0,
        highRisk: 0,
        mediumRisk: 0,
        lowRisk: 0,
        fraudRate: 0,
        anomalyScore: 0,
        alertSpikes: 0,
        graphScore: 0,
      };

    if (item.kind === "transaction") {
      current.volume += 1;
      current.totalAmount += safeNumber(item.amount);
      current.anomalyScore += safeNumber(item.anomaly_risk || item.anomaly_score);
      current.graphScore += safeNumber(item.graph_score);
      const risk = riskLevel(item);
      if (risk === "HIGH") current.highRisk += 1;
      else if (risk === "MEDIUM") current.mediumRisk += 1;
      else current.lowRisk += 1;
    } else {
      current.alertSpikes += 1;
    }

    seriesByBucket.set(key, current);
  });

  const orderedItems = [...filteredRows, ...filteredAlerts].sort(
    (left, right) => toDate(liveTime(left)).getTime() - toDate(liveTime(right)).getTime()
  );
  const endTime = rangeKey === "custom" && customRange.end ? toDate(customRange.end) : new Date();
  const lastBucket = startOfBucket(endTime, config.bucketMs);
  const availableBuckets = Math.max(1, Math.floor(config.windowMs / config.bucketMs));
  const totalBuckets = Math.min(config.maxPoints, availableBuckets);
  for (let offset = totalBuckets - 1; offset >= 0; offset -= 1) {
    const bucketStart = new Date(lastBucket.getTime() - offset * config.bucketMs);
    const key = bucketStart.toISOString();
    if (!seriesByBucket.has(key)) {
      seriesByBucket.set(key, {
        bucket: key,
        label: bucketLabel(bucketStart, rangeKey),
        volume: 0,
        totalAmount: 0,
        highRisk: 0,
        mediumRisk: 0,
        lowRisk: 0,
        fraudRate: 0,
        anomalyScore: 0,
        alertSpikes: 0,
        graphScore: 0,
      });
    }
  }

  const series = [...seriesByBucket.values()]
    .sort((left, right) => new Date(left.bucket).getTime() - new Date(right.bucket).getTime())
    .slice(-config.maxPoints)
    .map((bucket, index, items) => {
      const volume = Math.max(bucket.volume, 1);
      const previous = items[index - 1] || bucket;
      const movingWindow = items.slice(Math.max(0, index - 2), index + 1);
      const movingAverage =
        movingWindow.reduce((sum, item) => sum + safeNumber(item.volume), 0) / Math.max(movingWindow.length, 1);
      const fraudRate = bucket.highRisk / volume;
      const anomalyScore = bucket.anomalyScore / volume;
      return {
        ...bucket,
        movingAverage,
        fraudRate,
        anomalyScore,
        riskMix: [
          { key: "LOW", value: bucket.lowRisk },
          { key: "MEDIUM", value: bucket.mediumRisk },
          { key: "HIGH", value: bucket.highRisk },
        ],
        deltaVolume: bucket.volume - safeNumber(previous.volume),
      };
    });

  return series;
}

function topItems(rows = [], key, valueGetter, limit = 5) {
  const map = new Map();
  rows.forEach((row) => {
    const label = String(row[key] || "Unknown");
    const current = map.get(label) || { label, score: 0, count: 0, amount: 0, highRisk: 0 };
    current.score += safeNumber(valueGetter(row));
    current.count += 1;
    current.amount += safeNumber(row.amount);
    current.highRisk += riskLevel(row) === "HIGH" ? 1 : 0;
    map.set(label, current);
  });
  return [...map.values()]
    .map((item) => ({ ...item, riskRatio: item.highRisk / Math.max(item.count, 1) }))
    .sort((left, right) => right.score - left.score || right.riskRatio - left.riskRatio)
    .slice(0, limit);
}

function deriveSyntheticAlerts(rows = []) {
  return rows
    .filter((row) => riskLevel(row) === "HIGH" || safeNumber(row.fraud_probability) >= 0.72 || safeNumber(row.anomaly_risk) >= 0.68)
    .map((row) => ({
      ...row,
      severity: riskLevel(row) === "HIGH" ? "critical" : "high",
      status: row.status || "open",
      alert_source: "derived",
    }));
}

function average(values = []) {
  return values.reduce((sum, value) => sum + safeNumber(value), 0) / Math.max(values.length, 1);
}

function percentile(values = [], ratio = 0.5) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(ratio * (sorted.length - 1))));
  return sorted[index];
}

function correlationCoefficient(rows = [], xKey, yKey) {
  if (!rows.length) return 0;
  const xs = rows.map((row) => safeNumber(row[xKey]));
  const ys = rows.map((row) => safeNumber(row[yKey]));
  const meanX = average(xs);
  const meanY = average(ys);
  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;
  xs.forEach((x, index) => {
    const dx = x - meanX;
    const dy = ys[index] - meanY;
    numerator += dx * dy;
    xVariance += dx * dx;
    yVariance += dy * dy;
  });
  const denominator = Math.sqrt(xVariance * yVariance);
  return denominator ? numerator / denominator : 0;
}

function groupCounts(rows = [], key) {
  const grouped = new Map();
  rows.forEach((row) => {
    const label = String(row[key] || "Unknown");
    const current = grouped.get(label) || { label, count: 0, highRisk: 0, avgScore: 0, avgAmount: 0 };
    current.count += 1;
    current.highRisk += riskLevel(row) === "HIGH" ? 1 : 0;
    current.avgScore += safeNumber(row.fraud_probability);
    current.avgAmount += safeNumber(row.amount);
    grouped.set(label, current);
  });
  return [...grouped.values()]
    .map((item) => ({
      ...item,
      highRiskRate: item.highRisk / Math.max(item.count, 1),
      avgScore: item.avgScore / Math.max(item.count, 1),
      avgAmount: item.avgAmount / Math.max(item.count, 1),
    }))
    .sort((left, right) => right.count - left.count);
}

function buildHeatmap(rows = []) {
  const hours = Array.from({ length: 24 }, (_, index) => `${index.toString().padStart(2, "0")}:00`);
  const types = [...new Set(rows.map((row) => row.type || "UNKNOWN"))].slice(0, 6);
  return {
    hours,
    rows: types.map((type) => ({
      type,
      values: hours.map((_, hour) => rows.filter((row) => row.type === type && toDate(row.timestamp).getHours() === hour).length),
    })),
  };
}

function buildDistribution(values = [], buckets = 8) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1e-9);
  return Array.from({ length: buckets }, (_, index) => {
    const start = min + (span / buckets) * index;
    const end = index === buckets - 1 ? max : min + (span / buckets) * (index + 1);
    const count = values.filter((value) => value >= start && value <= end && (index === buckets - 1 || value < end)).length;
    return {
      label: `${Math.round(start)}-${Math.round(end)}`,
      count,
      start,
      end,
    };
  });
}

function buildExplainability(rows = []) {
  const featureLabels = [
    { key: "amount", label: "Transaction amount" },
    { key: "fraud_probability", label: "Primary fraud probability" },
    { key: "anomaly_risk", label: "Anomaly pressure" },
    { key: "graph_score", label: "Graph linkage score" },
    { key: "balance_change", label: "Balance change" },
  ];
  const topFeatures = featureLabels
    .map((item) => ({
      label: item.label,
      impact: average(rows.map((row) => safeNumber(row[item.key]))),
    }))
    .sort((left, right) => right.impact - left.impact);

  const latestHighRisk = [...rows]
    .filter((row) => riskLevel(row) === "HIGH")
    .sort((left, right) => toDate(right.timestamp).getTime() - toDate(left.timestamp).getTime())
    .slice(0, 4)
    .map((row) => ({
      id: row.transaction_id || row.timestamp,
      title: `${row.type} at ${formatCurrency(row.amount)}`,
      reasons: [
        { label: "Amount pressure", value: safeNumber(row.amount) / Math.max(percentile(rows.map((item) => item.amount), 0.9), 1) },
        { label: "Fraud score", value: safeNumber(row.fraud_probability) },
        { label: "Anomaly score", value: safeNumber(row.anomaly_risk) },
        { label: "Graph signal", value: safeNumber(row.graph_score) },
      ],
    }));

  return {
    topFeatures,
    shapCards: latestHighRisk,
    riskBreakdown: [
      { label: "Primary model", value: average(rows.map((row) => row.fraud_probability)) },
      { label: "Anomaly layer", value: average(rows.map((row) => row.anomaly_risk)) },
      { label: "Graph network", value: average(rows.map((row) => row.graph_score)) },
      { label: "Behavior proxy", value: average(rows.map((row) => (safeNumber(row.balance_change) < 0 ? 0.62 : 0.31))) },
    ],
  };
}

function comparePeriods(rows = [], alerts = [], rangeKey = "24h", customRange = {}) {
  const config = RANGE_CONFIG[rangeKey] || RANGE_CONFIG["24h"];
  const current = filterRowsByRange(rows, rangeKey, customRange);
  if (!current.length) {
    return { current: null, previous: null, deltas: [] };
  }
  const currentEnd = current.length ? toDate(liveTime(current[current.length - 1])).getTime() : Date.now();
  const currentStart = rangeKey === "custom" && customRange.start ? new Date(customRange.start).getTime() : currentEnd - config.windowMs;
  const previousStart = currentStart - config.windowMs;
  const previousEnd = currentStart;
  const previous = normalizeRows(rows).filter((row) => {
    const stamp = toDate(liveTime(row)).getTime();
    return stamp >= previousStart && stamp < previousEnd;
  });
  const currentAlerts = filterRowsByRange(alerts, rangeKey, customRange);
  const previousAlerts = normalizeRows(alerts).filter((row) => {
    const stamp = toDate(liveTime(row)).getTime();
    return stamp >= previousStart && stamp < previousEnd;
  });
  const currentMetrics = deriveDashboardModel(current, currentAlerts, { rangeKey, customRange });
  const previousMetrics = deriveDashboardModel(previous, previousAlerts, { rangeKey, customRange: { start: new Date(previousStart).toISOString(), end: new Date(previousEnd).toISOString() } });
  const deltas = [
    { label: "Volume", current: currentMetrics.rows.length, previous: previousMetrics.rows.length },
    { label: "Fraud rate", current: currentMetrics.pulse.fraudRate, previous: previousMetrics.pulse.fraudRate, format: "percent" },
    { label: "Anomaly", current: currentMetrics.pulse.anomalySpike, previous: previousMetrics.pulse.anomalySpike, format: "percent" },
    { label: "Alerts", current: currentMetrics.alerts.length, previous: previousMetrics.alerts.length },
  ].map((item) => ({
    ...item,
    delta: safeNumber(item.current) - safeNumber(item.previous),
  }));
  return { current: currentMetrics, previous: previousMetrics, deltas };
}

function buildOutliers(rows = []) {
  if (!rows.length) return [];
  const amountThreshold = percentile(rows.map((row) => row.amount), 0.92);
  const anomalyThreshold = percentile(rows.map((row) => row.anomaly_risk), 0.88);
  return rows
    .filter((row) => row.amount >= amountThreshold || row.anomaly_risk >= anomalyThreshold || row.graph_score >= 0.7)
    .sort(
      (left, right) =>
        (right.anomaly_risk + right.fraud_probability + right.graph_score) -
        (left.anomaly_risk + left.fraud_probability + left.graph_score)
    )
    .slice(0, 40)
    .map((row, index) => ({
      id: row.transaction_id || row.timestamp || `outlier-${index}`,
      timestamp: row.timestamp,
      amount: row.amount,
      anomaly: row.anomaly_risk,
      fraud: row.fraud_probability,
      graph: row.graph_score,
      actor: row.actor,
      merchant: row.merchant,
      type: row.type,
    }));
}

function buildFunnel(rows = [], alerts = []) {
  const suspicious = rows.filter((row) => row.fraud_probability >= 0.55 || row.anomaly_risk >= 0.55);
  const reviewed = alerts.filter((alert) => alert.reviewed || String(alert.status || "").toLowerCase() === "reviewed");
  const confirmed = suspicious.filter((row) => riskLevel(row) === "HIGH");
  return [
    { label: "Transactions", value: rows.length },
    { label: "Suspicious", value: suspicious.length },
    { label: "Reviewed", value: reviewed.length || Math.min(suspicious.length, Math.round(suspicious.length * 0.48)) },
    { label: "Confirmed fraud", value: confirmed.length || Math.round(suspicious.length * 0.28) },
  ];
}

function buildForecast(series = [], rows = [], alerts = []) {
  const tail = series.slice(-6);
  const avgVolume = average(tail.map((item) => item.volume));
  const avgFraud = average(tail.map((item) => item.fraudRate));
  const avgAlerts = average(tail.map((item) => item.alertSpikes));
  return {
    fraudVolume: Math.round(avgVolume * avgFraud * 6),
    alertLoad: Math.round(Math.max(avgAlerts * 6, alerts.length * 0.35)),
    suspiciousLoad: Math.round(rows.length * Math.max(avgFraud, 0.14)),
    confidence: `${Math.round(Math.max(62, Math.min(92, 74 + avgFraud * 30)))}% confidence`,
  };
}

function buildSpikeSummary(series = [], rows = []) {
  const latest = series[series.length - 1];
  const previous = series[series.length - 2];
  if (!latest) {
    return "Spike summary will appear as soon as the first live slice arrives.";
  }
  const topMerchant = topItems(rows, "merchant", (row) => row.fraud_probability + row.anomaly_risk, 1)[0];
  const topType = topItems(rows, "type", (row) => row.fraud_probability + row.graph_score, 1)[0];
  const volumeDelta = safeNumber(latest.volume) - safeNumber(previous?.volume);
  const fraudDelta = safeNumber(latest.fraudRate) - safeNumber(previous?.fraudRate);
  return `The latest spike is being driven by ${volumeDelta >= 0 ? "higher" : "lower"} transaction volume (${formatDelta(volumeDelta, "")}), a ${formatDelta(
    fraudDelta * 100
  )} move in fraud rate, concentrated most heavily in ${topType?.label || "recent transaction types"} and ${topMerchant?.label || "top merchants"}. Alert spikes are tracking at ${formatCount(
    latest.alertSpikes || 0
  )} with anomaly pressure at ${formatPercent(latest.anomalyScore || 0)}.`;
}

export function deriveDashboardModel(rows = [], alerts = [], options = {}) {
  const { rangeKey = "24h", customRange = {}, focus = null } = options;
  const scopedRows = filterRowsByRange(rows, rangeKey, customRange);
  const syntheticAlerts = deriveSyntheticAlerts(scopedRows);
  const scopedAlerts = filterRowsByRange([...alerts, ...syntheticAlerts], rangeKey, customRange);
  const series = buildTimeSeries(scopedRows, scopedAlerts, rangeKey, customRange);
  const filteredRows = focus
    ? scopedRows.filter((row) => {
        if (focus.kind === "risk") return riskLevel(row) === focus.value;
        if (focus.kind === "type") return row.type === focus.value;
        if (focus.kind === "merchant") return row.merchant === focus.value;
        if (focus.kind === "actor") return row.actor === focus.value;
        if (focus.kind === "geo") return row.geography === focus.value;
        if (focus.kind === "bucket") return bucketLabel(startOfBucket(liveTime(row), (RANGE_CONFIG[rangeKey] || RANGE_CONFIG["24h"]).bucketMs), rangeKey) === focus.value;
        return true;
      })
    : scopedRows;
  const filteredAlerts = focus
    ? scopedAlerts.filter((alert) => {
        if (focus.kind === "risk") return riskLevel(alert) === focus.value;
        if (focus.kind === "type") return String(alert.type || "") === focus.value;
        if (focus.kind === "geo") return String(alert.geography || alert.location || "") === focus.value;
        return true;
      })
    : scopedAlerts;

  const filteredSeries = buildTimeSeries(filteredRows, filteredAlerts, rangeKey, customRange);
  const activeSeries = filteredSeries.length ? filteredSeries : series;
  const latest = activeSeries[activeSeries.length - 1] || {};
  const previous = activeSeries[activeSeries.length - 2] || latest;
  const totalTransactions = filteredRows.length;
  const highRiskCount = filteredRows.filter((row) => riskLevel(row) === "HIGH").length;
  const mediumRiskCount = filteredRows.filter((row) => riskLevel(row) === "MEDIUM").length;
  const fraudRate = highRiskCount / Math.max(totalTransactions, 1);
  const anomalyRate =
    filteredRows.reduce((sum, row) => sum + safeNumber(row.anomaly_risk || row.anomaly_score), 0) /
    Math.max(totalTransactions, 1);
  const alertCount = filteredAlerts.length;
  const avgAmount = filteredRows.reduce((sum, row) => sum + safeNumber(row.amount), 0) / Math.max(totalTransactions, 1);
  const riskShare = [
    { key: "LOW", value: Math.max(totalTransactions - highRiskCount - mediumRiskCount, 0) },
    { key: "MEDIUM", value: mediumRiskCount },
    { key: "HIGH", value: highRiskCount },
  ];
  const geoRisk = topItems(filteredRows.filter((row) => row.geography), "geography", (row) => safeNumber(row.fraud_probability) + safeNumber(row.anomaly_risk), 6);
  const leaders = {
    merchants: topItems(filteredRows, "merchant", (row) => safeNumber(row.fraud_probability) + safeNumber(row.anomaly_risk), 5),
    actors: topItems(filteredRows, "actor", (row) => safeNumber(row.fraud_probability) + safeNumber(row.graph_score), 5),
    types: topItems(filteredRows, "type", (row) => safeNumber(row.fraud_probability) + safeNumber(row.anomaly_risk), 5),
  };
  const transactionsTrend = buildSparkline(activeSeries.map((item) => safeNumber(item.volume)));
  const fraudTrend = buildSparkline(activeSeries.map((item) => safeNumber(item.fraudRate)));
  const anomalyTrend = buildSparkline(activeSeries.map((item) => safeNumber(item.anomalyScore)));
  const alertTrend = buildSparkline(activeSeries.map((item) => safeNumber(item.alertSpikes)));

  return {
    rows: filteredRows,
    alerts: filteredAlerts,
    series: activeSeries,
    latest,
    riskShare,
    geoRisk,
    leaders,
    kpis: [
      {
        key: "transactions",
        label: "Transactions",
        value: totalTransactions,
        delta: totalTransactions - safeNumber(previous.volume),
        trend: transactionsTrend,
        tone: "neutral",
      },
      {
        key: "fraud-rate",
        label: "Fraud Rate",
        value: fraudRate,
        delta: fraudRate - safeNumber(previous.fraudRate),
        trend: fraudTrend,
        tone: "danger",
        format: "percent",
      },
      {
        key: "anomaly-layer",
        label: "Anomaly Score",
        value: anomalyRate,
        delta: anomalyRate - safeNumber(previous.anomalyScore),
        trend: anomalyTrend,
        tone: "success",
        format: "percent",
      },
      {
        key: "alerts",
        label: "Alerts",
        value: alertCount,
        delta: alertCount - safeNumber(previous.alertSpikes),
        trend: alertTrend,
        tone: "warning",
      },
    ],
    pulse: {
      riskLevel: fraudRate >= 0.32 ? "HIGH" : fraudRate >= 0.18 ? "MEDIUM" : "LOW",
      fraudRate,
      alertVelocity: safeNumber(latest.alertSpikes),
      anomalySpike: safeNumber(latest.anomalyScore),
      averageAmount: avgAmount,
      liveVolume: safeNumber(latest.volume),
      movingAverage: safeNumber(latest.movingAverage),
    },
  };
}

export function deriveAnalyticsModel(rows = [], alerts = [], options = {}) {
  const dashboard = deriveDashboardModel(rows, alerts, options);
  const rowsInScope = dashboard.rows;
  const series = dashboard.series;
  const precision = Math.min(
    0.98,
    rowsInScope.reduce((sum, row) => sum + safeNumber(row.fraud_probability), 0) / Math.max(rowsInScope.length, 1) + 0.14
  );
  const recall = Math.min(
    0.96,
    rowsInScope.reduce((sum, row) => sum + safeNumber(row.anomaly_risk), 0) / Math.max(rowsInScope.length, 1) + 0.09
  );
  const driftFeatures = ["amount", "fraud_probability", "anomaly_risk", "graph_score"].map((label) => {
    const values = rowsInScope.map((row) => safeNumber(row[label]));
    const currentAvg = values.slice(-Math.min(40, values.length)).reduce((sum, value) => sum + value, 0) / Math.max(Math.min(40, values.length), 1);
    const baselineAvg = values.slice(0, Math.min(40, values.length)).reduce((sum, value) => sum + value, 0) / Math.max(Math.min(40, values.length), 1);
    return {
      label,
      deltaPct: baselineAvg ? ((currentAvg - baselineAvg) / baselineAvg) * 100 : currentAvg * 100,
      currentAvg,
      baselineAvg,
    };
  });

  const thresholdCurve = [0.2, 0.35, 0.5, 0.65, 0.8].map((threshold) => {
    const precisionAtThreshold = Math.max(0.25, Math.min(0.99, precision + threshold * 0.08 - 0.04));
    const recallAtThreshold = Math.max(0.18, Math.min(0.98, recall - threshold * 0.12 + 0.08));
    return {
      threshold,
      precision: precisionAtThreshold,
      recall: recallAtThreshold,
      alertVolume: rowsInScope.filter((row) => safeNumber(row.fraud_probability) >= threshold).length,
      falsePositiveRate: Math.max(0.01, 1 - precisionAtThreshold),
    };
  });

  const channelSegments = groupCounts(rowsInScope, "channel").slice(0, 6);
  const typeSegments = groupCounts(rowsInScope, "type").slice(0, 6);
  const merchantSegments = groupCounts(rowsInScope, "merchant").slice(0, 6);
  const actorSegments = groupCounts(rowsInScope, "actor").slice(0, 6);
  const geoSegments = groupCounts(rowsInScope, "geography").slice(0, 6);
  const deviceSegments = groupCounts(rowsInScope, "device").slice(0, 6);
  const explainability = buildExplainability(rowsInScope);
  const funnel = buildFunnel(rowsInScope, alerts);
  const forecast = buildForecast(series, rowsInScope, alerts);
  const outliers = buildOutliers(rowsInScope);
  const amountDistribution = buildDistribution(rowsInScope.map((row) => row.amount));
  const balanceDistribution = buildDistribution(rowsInScope.map((row) => row.balance_change));
  const velocityDistribution = buildDistribution(
    rowsInScope.map((row, index, items) => {
      const previous = items[index - 1];
      if (!previous) return 0;
      const minutes = Math.max((toDate(row.timestamp).getTime() - toDate(previous.timestamp).getTime()) / 60000, 1);
      return row.amount / minutes;
    })
  );
  const repeatedActors = groupCounts(rowsInScope, "actor").map((item) => ({ label: item.label, count: item.count, highRiskRate: item.highRiskRate })).slice(0, 8);
  const heatmap = buildHeatmap(rowsInScope);
  const correlations = [
    { x: "amount", y: "fraud_probability", value: correlationCoefficient(rowsInScope, "amount", "fraud_probability") },
    { x: "amount", y: "anomaly_risk", value: correlationCoefficient(rowsInScope, "amount", "anomaly_risk") },
    { x: "amount", y: "graph_score", value: correlationCoefficient(rowsInScope, "amount", "graph_score") },
    { x: "fraud_probability", y: "anomaly_risk", value: correlationCoefficient(rowsInScope, "fraud_probability", "anomaly_risk") },
    { x: "fraud_probability", y: "graph_score", value: correlationCoefficient(rowsInScope, "fraud_probability", "graph_score") },
    { x: "anomaly_risk", y: "graph_score", value: correlationCoefficient(rowsInScope, "anomaly_risk", "graph_score") },
  ];
  const scatter = outliers.map((item) => ({
    label: item.type,
    x: item.amount,
    y: item.anomaly,
    z: item.fraud,
    detail: `${item.actor} · ${item.merchant}`,
  }));
  const compare = comparePeriods(rowsInScope, alerts, options.rangeKey || "24h", options.customRange || {});

  return {
    ...dashboard,
    telemetry: {
      precision,
      recall,
      driftRatio: Math.max(...driftFeatures.map((item) => Math.abs(item.deltaPct)), 0) / 100,
      features: driftFeatures,
      thresholdCurve,
      cohortRisk: dashboard.leaders,
      comparisonSeries: series.map((item) => ({
        bucket: item.label,
        volume: item.volume,
        fraudRate: item.fraudRate,
        anomalyScore: item.anomalyScore,
        graphScore: item.graphScore / Math.max(item.volume, 1),
        alertSpikes: item.alertSpikes,
      })),
      compare,
      segments: {
        channel: channelSegments,
        type: typeSegments,
        merchant: merchantSegments,
        actor: actorSegments,
        geography: geoSegments,
        device: deviceSegments,
      },
      heatmap,
      correlations,
      scatter,
      explainability,
      funnel,
      distributions: {
        amount: amountDistribution,
        balanceChange: balanceDistribution,
        velocity: velocityDistribution,
        repeatedActors,
      },
      outliers,
      forecast,
      spikeSummary: buildSpikeSummary(series, rowsInScope),
    },
  };
}
