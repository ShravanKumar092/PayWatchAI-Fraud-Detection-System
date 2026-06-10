import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import SkeletonBlock from "../components/SkeletonBlock";
import TransactionTable from "../components/TransactionTable";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import { getDashboardSnapshot } from "../services/api";
import {
  deriveDashboardModel,
  filterRowsByRange,
  formatCount,
  formatCurrency,
  formatDelta,
  formatPercent,
  trendDirection,
} from "../utils/liveMetrics";

const RANGE_OPTIONS = ["24h", "7d", "30d", "custom"];
const RISK_LEVELS = ["ALL", "LOW", "MEDIUM", "HIGH"];

function uniqueByKey(rows = []) {
  const seen = new Set();
  return rows.filter((row, index) => {
    const key = row.transaction_id || row.timestamp || `${row.type || "row"}-${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatValue(metric) {
  return metric.format === "percent" ? formatPercent(metric.value) : formatCount(metric.value);
}

function MiniSparkline({ points = [], tone = "neutral" }) {
  if (!points.length) {
    return <div className="mini-sparkline-empty" />;
  }
  const width = 120;
  const height = 42;
  const path = points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - point.ratio * (height - 6) - 3;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`mini-sparkline tone-${tone}`} role="img" aria-hidden="true">
      <path d={path} fill="none" />
    </svg>
  );
}

function KpiStoryCard({ metric, onClick }) {
  const trend = trendDirection(metric.delta);
  const deltaText = metric.format === "percent" ? formatDelta(metric.delta * 100) : formatDelta(metric.delta, "");
  return (
    <button type="button" className={`story-kpi-card tone-${metric.tone}`} onClick={onClick}>
      <div className="story-kpi-head">
        <span>{metric.label}</span>
        <small className={`trend-${trend}`}>{trend === "up" ? "Rising" : trend === "down" ? "Cooling" : "Stable"}</small>
      </div>
      <strong>{formatValue(metric)}</strong>
      <div className="story-kpi-foot">
        <span>{deltaText} vs last live slice</span>
        <MiniSparkline points={metric.trend} tone={metric.tone} />
      </div>
    </button>
  );
}

function FocusChip({ focus, onClear }) {
  if (!focus) return null;
  return (
    <div className="live-focus-chip">
      <span>Cross-filter: {focus.label}</span>
      <button className="ghost-button" type="button" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

function RiskDonut({ riskShare = [], riskLevel = "LOW", fraudRate = 0, onSelectRisk }) {
  const total = riskShare.reduce((sum, item) => sum + Number(item.value || 0), 0) || 1;
  let offset = 0;
  const segments = riskShare.map((item) => {
    const dash = (Number(item.value || 0) / total) * 283;
    const segment = {
      ...item,
      dash,
      offset,
    };
    offset += dash;
    return segment;
  });
  return (
    <div className="risk-donut-card">
      <svg viewBox="0 0 120 120" className="risk-donut" role="img" aria-label="Risk mix donut">
        <circle cx="60" cy="60" r="45" className="risk-donut-track" />
        {segments.map((segment) => (
          <circle
            key={segment.key}
            cx="60"
            cy="60"
            r="45"
            className={`risk-donut-segment risk-${segment.key.toLowerCase()}`}
            strokeDasharray={`${segment.dash} 283`}
            strokeDashoffset={-segment.offset}
            onClick={() => onSelectRisk(segment.key)}
          />
        ))}
      </svg>
      <div className="risk-donut-copy">
        <small>Fraud Pulse</small>
        <strong>{riskLevel}</strong>
        <span>{formatPercent(fraudRate)} live fraud pressure</span>
      </div>
    </div>
  );
}

function buildAreaPath(values, width, height, minValue, maxValue) {
  const span = Math.max(maxValue - minValue, 1e-9);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((value - minValue) / span) * (height - 24) - 12;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function sparseAxisLabels(series = [], maxLabels = 8) {
  if (series.length <= maxLabels) {
    return series.map((item, index) => ({ ...item, axisLabel: item.label, axisKey: `${item.bucket}-${index}` }));
  }
  const step = Math.ceil(series.length / maxLabels);
  return series.map((item, index) => ({
    ...item,
    axisLabel: index % step === 0 || index === series.length - 1 ? item.label : "",
    axisKey: `${item.bucket}-${index}`,
  }));
}

function StoryAreaChart({
  title,
  subtitle,
  series = [],
  valueKey,
  averageKey,
  tone = "neutral",
  formatter = (value) => value,
  comparisonFormatter = formatter,
  thresholds = [],
  onBucketSelect,
}) {
  const [hoveredIndex, setHoveredIndex] = useState(Math.max(series.length - 1, 0));

  useEffect(() => {
    setHoveredIndex(Math.max(series.length - 1, 0));
  }, [series.length, valueKey, averageKey]);

  if (!series.length) {
    return (
      <div className="panel story-chart-panel">
        <div className="panel-header">
          <div>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
        </div>
        <EmptyState title="Waiting for live buckets" description="This visual fills as transactions arrive in the selected time range." />
      </div>
    );
  }

  const width = 680;
  const height = 260;
  const values = series.map((item) => Number(item[valueKey] || 0));
  const compareValues = averageKey ? series.map((item) => Number(item[averageKey] || 0)) : [];
  const maxValue = Math.max(...values, ...compareValues, ...thresholds.map((item) => item.value || 0), 1);
  const minValue = 0;
  const linePath = buildAreaPath(values, width, height, minValue, maxValue);
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
  const comparePath = averageKey ? buildAreaPath(compareValues, width, height, minValue, maxValue) : "";
  const latest = values[values.length - 1];
  const axisLabels = sparseAxisLabels(series, 7);
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      key: `tick-${index}`,
      value: maxValue * (1 - ratio),
      y: 12 + (height - 24) * ratio,
    };
  });
  const activeIndex = Math.min(hoveredIndex, series.length - 1);
  const activeItem = series[activeIndex] || series[series.length - 1] || {};
  const activeX = series.length === 1 ? width / 2 : (activeIndex / (series.length - 1)) * width;
  const tooltipLeft = Math.max(14, Math.min(88, (activeX / width) * 100));

  return (
    <div className="panel story-chart-panel">
      <div className="panel-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <strong>{formatter(latest)}</strong>
      </div>
      <div className="story-chart-shell">
        <svg viewBox={`0 0 ${width} ${height}`} className="story-area-chart" role="img" aria-label={title}>
          <defs>
            <linearGradient id={`area-${valueKey}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" className={`stop-${tone}`} stopOpacity="0.42" />
              <stop offset="100%" className={`stop-${tone}`} stopOpacity="0.05" />
            </linearGradient>
          </defs>
          {ticks.map((tick) => (
            <g key={tick.key}>
              <line x1="0" y1={tick.y} x2={width} y2={tick.y} className="chart-grid-line" />
              <text x="8" y={Math.max(tick.y - 6, 12)} className="chart-grid-label">
                {formatter(tick.value)}
              </text>
            </g>
          ))}
          {thresholds.map((band) => {
            const y = height - (band.value / Math.max(maxValue, 1e-9)) * (height - 24) - 12;
            return (
              <g key={band.label}>
                <line x1="0" y1={y} x2={width} y2={y} className={`threshold-line threshold-${band.tone}`} />
                <text x={width - 6} y={Math.max(y - 6, 12)} textAnchor="end" className="threshold-label">
                  {band.label}
                </text>
              </g>
            );
          })}
          <path d={areaPath} fill={`url(#area-${valueKey})`} />
          {comparePath ? <path d={comparePath} className="story-chart-compare" /> : null}
          <path d={linePath} className={`story-chart-line tone-${tone}`} />
          <line x1={activeX} y1="0" x2={activeX} y2={height} className="chart-hover-line" />
          {series.map((item, index) => {
            const x = series.length === 1 ? width / 2 : (index / (series.length - 1)) * width;
            const y = height - ((Number(item[valueKey] || 0) - minValue) / Math.max(maxValue - minValue, 1e-9)) * (height - 24) - 12;
            const hitWidth = Math.max(width / Math.max(series.length, 1), 22);
            return (
              <g key={item.bucket}>
                <rect
                  x={Math.max(x - hitWidth / 2, 0)}
                  y="0"
                  width={hitWidth}
                  height={height}
                  fill="transparent"
                  onClick={() => onBucketSelect(item.label)}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseMove={() => setHoveredIndex(index)}
                />
                <circle cx={x} cy={y} r="5" className={`story-chart-dot tone-${tone}`} />
              </g>
            );
          })}
        </svg>
        <div className="chart-hover-card chart-hover-card-floating" style={{ left: `${tooltipLeft}%` }}>
          <strong>{activeItem.label}</strong>
          <span>Current: {formatter(activeItem[valueKey] || 0)}</span>
          {averageKey ? <span>Compare: {comparisonFormatter(activeItem[averageKey] || 0)}</span> : null}
        </div>
        <div className="story-chart-axis">
          {axisLabels.map((item) => (
            <span key={item.axisKey}>{item.axisLabel}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StackedRiskBars({ series = [], onSelectRisk, onSelectBucket }) {
  if (!series.length) {
    return (
      <div className="panel story-chart-panel">
        <div className="panel-header">
          <div>
            <h3>Risk Mix</h3>
            <p>Risk-level composition across the active window</p>
          </div>
        </div>
        <EmptyState title="No stacked bars yet" description="Risk buckets appear as soon as the recent transaction flow is populated." />
      </div>
    );
  }

  const maxValue = Math.max(...series.map((item) => item.volume), 1);
  return (
    <div className="panel story-chart-panel">
      <div className="panel-header">
        <div>
          <h3>Risk Mix Story</h3>
          <p>Click a segment to filter the entire dashboard by risk level</p>
        </div>
      </div>
      <div className="stacked-bars">
        {series.map((bucket) => (
          <button key={bucket.bucket} type="button" className="stacked-bar-card" onClick={() => onSelectBucket(bucket.label)}>
            <div className="stacked-bar-track" style={{ height: `${(bucket.volume / maxValue) * 180 + 48}px` }}>
              {bucket.riskMix.map((segment) => (
                <span
                  key={`${bucket.bucket}-${segment.key}`}
                  className={`stacked-bar-segment risk-${segment.key.toLowerCase()}`}
                  style={{ height: `${(segment.value / Math.max(bucket.volume, 1)) * 100}%` }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectRisk(segment.key);
                  }}
                  title={`${segment.key}: ${segment.value}`}
                />
              ))}
            </div>
            <strong>{bucket.label}</strong>
            <small>{bucket.volume} txns</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function Leaderboard({ title, subtitle, items = [], focusKind, onFocus }) {
  return (
    <div className="panel leaderboard-panel">
      <div className="panel-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="leaderboard-list">
        {items.length === 0 ? (
          <div className="empty-state">No ranked items yet in this view.</div>
        ) : (
          items.map((item, index) => (
            <button key={`${title}-${item.label}`} type="button" className="leaderboard-row" onClick={() => onFocus({ kind: focusKind, value: item.label, label: `${title}: ${item.label}` })}>
              <span>{index + 1}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{formatCount(item.count)} events, {formatPercent(item.riskRatio)}</small>
              </div>
              <strong>{formatPercent(item.score / Math.max(item.count, 1), 0)}</strong>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function GeoRiskPanel({ items = [], onFocus }) {
  const layout = [
    { left: "15%", top: "32%" },
    { left: "40%", top: "18%" },
    { left: "64%", top: "34%" },
    { left: "32%", top: "58%" },
    { left: "56%", top: "60%" },
    { left: "78%", top: "46%" },
  ];
  return (
    <div className="panel geo-risk-panel">
      <div className="panel-header">
        <div>
          <h3>Geo Incident Map</h3>
          <p>Hotspot surface populated from feed geography or stable regional inference when location fields are sparse</p>
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No geography signals yet" description="Geo-risk appears automatically once locations are present in the incoming stream." />
      ) : (
        <div className="geo-incident-surface">
          <div className="geo-incident-map">
            {items.map((item, index) => (
              <button
                key={item.label}
                type="button"
                className="geo-incident-marker"
                style={layout[index] || { left: `${18 + index * 10}%`, top: `${22 + index * 8}%` }}
                onClick={() => onFocus({ kind: "geo", value: item.label, label: `Geo: ${item.label}` })}
              >
                <i style={{ width: `${Math.max(item.riskRatio * 52, 16)}px`, height: `${Math.max(item.riskRatio * 52, 16)}px` }} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="geo-risk-grid">
            {items.map((item) => (
              <button key={item.label} type="button" className="geo-risk-node" onClick={() => onFocus({ kind: "geo", value: item.label, label: `Geo: ${item.label}` })}>
                <div className="geo-risk-glow" />
                <strong>{item.label}</strong>
                <span>{formatPercent(item.riskRatio)} risk intensity</span>
                <div className="geo-risk-bar">
                  <i style={{ width: `${Math.max(item.riskRatio * 100, 8)}%` }} />
                </div>
                <small>{formatCount(item.count)} transactions · avg {formatCurrency(item.amount / Math.max(item.count, 1))}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LiveStatusPanel({ pulse, connectionStatus, connectionTransport, bufferedEvents, lastUpdated }) {
  return (
    <div className="panel fraud-pulse-panel">
      <div className="fraud-pulse-grid">
        <div>
          <p className="eyebrow">Fraud Pulse</p>
          <h3>Realtime risk storytelling for the active window</h3>
          <p className="fraud-pulse-copy">
            Incoming transactions update these KPIs and stories from the same live stream, so counts and charts move together instead of drifting apart.
          </p>
          <div className="status-inline-row">
            <span className={`live-pill status-${String(connectionStatus || "connecting").toLowerCase()}`}>Live</span>
            <span>{String(connectionTransport || "idle").toUpperCase()}</span>
            <span>Buffered {bufferedEvents || 0}</span>
            <span>Last updated {lastUpdated}</span>
          </div>
        </div>
        <RiskDonut riskShare={pulse.riskShare} riskLevel={pulse.riskLevel} fraudRate={pulse.fraudRate} onSelectRisk={pulse.onSelectRisk} />
        <div className="pulse-metric-strip">
          <article>
            <span>Alert velocity</span>
            <strong>{formatCount(pulse.alertVelocity)}</strong>
            <small>High-risk alert spikes in the latest bucket</small>
          </article>
          <article>
            <span>Anomaly spike</span>
            <strong>{formatPercent(pulse.anomalySpike)}</strong>
            <small>Average anomaly pressure in the latest slice</small>
          </article>
          <article>
            <span>Volume vs baseline</span>
            <strong>{formatCount(pulse.liveVolume)} / {formatCount(pulse.movingAverage)}</strong>
            <small>Current bucket versus moving average</small>
          </article>
          <article>
            <span>Average amount</span>
            <strong>{formatCurrency(pulse.averageAmount)}</strong>
            <small>Current window transaction amount average</small>
          </article>
        </div>
      </div>
    </div>
  );
}

function renderDashboardSvg(model, focus) {
  const latest = model.series[model.series.length - 1] || {};
  const background = "#08111f";
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900">
      <rect width="1400" height="900" fill="${background}" rx="32" />
      <text x="60" y="90" fill="#f3f7ff" font-size="34" font-family="Segoe UI, sans-serif">PayWatch AI Dashboard Snapshot</text>
      <text x="60" y="126" fill="#8ea2c9" font-size="18" font-family="Segoe UI, sans-serif">${focus ? `Cross-filter: ${focus.label}` : "All live events"} | ${new Date().toLocaleString()}</text>
      ${model.kpis
        .map((metric, index) => {
          const x = 60 + index * 320;
          const tone = metric.tone === "danger" ? "#ff5f7a" : metric.tone === "warning" ? "#ffc14d" : metric.tone === "success" ? "#2bd67b" : "#5cc8ff";
          return `
            <rect x="${x}" y="170" width="280" height="150" rx="22" fill="#0f1b31" stroke="#203250" />
            <text x="${x + 24}" y="210" fill="#8ea2c9" font-size="18" font-family="Segoe UI, sans-serif">${metric.label}</text>
            <text x="${x + 24}" y="270" fill="${tone}" font-size="44" font-family="Segoe UI, sans-serif">${metric.format === "percent" ? `${Math.round(metric.value * 100)}%` : Math.round(metric.value)}</text>
          `;
        })
        .join("")}
      <rect x="60" y="380" width="1280" height="430" rx="28" fill="#0f1b31" stroke="#203250" />
      <text x="90" y="430" fill="#f3f7ff" font-size="26" font-family="Segoe UI, sans-serif">Latest Live Bucket</text>
      <text x="90" y="470" fill="#8ea2c9" font-size="20" font-family="Segoe UI, sans-serif">Volume ${formatCount(latest.volume || 0)} | Fraud ${Math.round((latest.fraudRate || 0) * 100)}% | Anomaly ${Math.round((latest.anomalyScore || 0) * 100)}%</text>
    </svg>
  `;
}

function downloadText(filename, mimeType, text) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportRowsToCsv(filename, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(","), ...rows.map((row) => keys.map((key) => JSON.stringify(row[key] ?? "")).join(","))].join("\n");
  downloadText(filename, "text/csv;charset=utf-8", csv);
}

async function exportDashboardPng(model, focus) {
  const svgText = renderDashboardSvg(model, focus);
  const image = new Image();
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  image.src = url;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 1400;
  canvas.height = 900;
  const context = canvas.getContext("2d");
  if (context) {
    context.drawImage(image, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = "paywatch-dashboard-snapshot.png";
    anchor.click();
  }
  URL.revokeObjectURL(url);
}

function exportDashboardPdf(model, focus) {
  const popup = window.open("", "_blank", "width=1200,height=900");
  if (!popup) return;
  popup.document.write(`
    <html>
      <head>
        <title>PayWatch Dashboard Snapshot</title>
        <style>
          body { font-family: Segoe UI, sans-serif; background: #08111f; color: #f3f7ff; padding: 24px; }
          .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0; }
          .card { background: #0f1b31; border: 1px solid #203250; border-radius: 18px; padding: 18px; }
          table { width: 100%; border-collapse: collapse; margin-top: 24px; }
          td, th { border-bottom: 1px solid #203250; padding: 12px; text-align: left; }
        </style>
      </head>
      <body>
        <h1>PayWatch AI Dashboard Snapshot</h1>
        <p>${focus ? `Cross-filter: ${focus.label}` : "All live events"} | ${new Date().toLocaleString()}</p>
        <div class="grid">
          ${model.kpis
            .map(
              (metric) => `
                <div class="card">
                  <div>${metric.label}</div>
                  <h2>${metric.format === "percent" ? formatPercent(metric.value) : formatCount(metric.value)}</h2>
                </div>
              `
            )
            .join("")}
        </div>
        <table>
          <thead><tr><th>Bucket</th><th>Volume</th><th>Fraud Rate</th><th>Anomaly</th><th>Alerts</th></tr></thead>
          <tbody>
            ${model.series
              .map(
                (item) => `
                  <tr>
                    <td>${item.label}</td>
                    <td>${formatCount(item.volume)}</td>
                    <td>${formatPercent(item.fraudRate)}</td>
                    <td>${formatPercent(item.anomalyScore)}</td>
                    <td>${formatCount(item.alertSpikes)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `);
  popup.document.close();
  popup.print();
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const {
    transactions,
    alerts,
    loading,
    error,
    refreshAll,
    connectionStatus,
    connectionTransport,
    bufferedEvents,
  } = useAppData();
  const [snapshot, setSnapshot] = useState(null);
  const [pageError, setPageError] = useState("");
  const [rangeKey, setRangeKey] = useState("24h");
  const [riskFilter, setRiskFilter] = useState("ALL");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [focus, setFocus] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    setLastUpdated(new Date());
  }, [transactions.length, alerts.length]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function loadSnapshot() {
      try {
        const payload = await getDashboardSnapshot(token, {});
        if (!cancelled) {
          setSnapshot(payload);
          setPageError("");
        }
      } catch (snapshotError) {
        if (!cancelled) {
          setPageError(snapshotError.message || "Unable to load dashboard snapshot");
        }
      }
    }
    loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const mergedTransactions = useMemo(
    () => uniqueByKey([...(transactions || []), ...(snapshot?.transactions || [])]),
    [transactions, snapshot?.transactions]
  );
  const mergedAlerts = useMemo(
    () => uniqueByKey([...(alerts || []), ...(snapshot?.alerts || [])]),
    [alerts, snapshot?.alerts]
  );

  const availableTypes = useMemo(() => {
    const inRange = filterRowsByRange(mergedTransactions, rangeKey, customRange);
    return ["ALL", ...new Set(inRange.map((row) => row.type).filter(Boolean))];
  }, [mergedTransactions, rangeKey, customRange]);
  const [typeFilter, setTypeFilter] = useState("ALL");

  useEffect(() => {
    if (!availableTypes.includes(typeFilter)) {
      setTypeFilter("ALL");
    }
  }, [availableTypes, typeFilter]);

  const baseRows = useMemo(
    () =>
      filterRowsByRange(mergedTransactions, rangeKey, customRange).filter((row) => {
        if (riskFilter !== "ALL" && String(row.risk_level || "").toUpperCase() !== riskFilter) return false;
        if (typeFilter !== "ALL" && row.type !== typeFilter) return false;
        return true;
      }),
    [mergedTransactions, rangeKey, customRange, riskFilter, typeFilter]
  );
  const baseAlerts = useMemo(
    () =>
      filterRowsByRange(mergedAlerts, rangeKey, customRange).filter((row) => {
        if (riskFilter !== "ALL" && String(row.risk_level || "").toUpperCase() !== riskFilter) return false;
        if (typeFilter !== "ALL" && row.type !== typeFilter) return false;
        return true;
      }),
    [mergedAlerts, rangeKey, customRange, riskFilter, typeFilter]
  );

  const dashboard = useMemo(
    () => deriveDashboardModel(baseRows, baseAlerts, { rangeKey, customRange, focus }),
    [baseRows, baseAlerts, rangeKey, customRange, focus]
  );

  const smartSummary = useMemo(() => {
    const tone = dashboard.pulse.riskLevel === "HIGH" ? "elevated" : dashboard.pulse.riskLevel === "MEDIUM" ? "watch" : "stable";
    return `${formatCount(dashboard.rows.length)} transactions are flowing through the ${rangeKey} window. Fraud pressure is ${tone}, with ${formatPercent(
      dashboard.pulse.fraudRate
    )} high-risk share, ${formatCount(dashboard.alerts.length)} active alerts, and ${formatPercent(dashboard.pulse.anomalySpike)} anomaly intensity in the latest bucket.`;
  }, [dashboard, rangeKey]);

  const focusHandlers = {
    onSelectRisk: (risk) => {
      setRiskFilter(risk);
      setFocus({ kind: "risk", value: risk, label: `Risk: ${risk}` });
    },
    onSelectBucket: (bucket) => setFocus({ kind: "bucket", value: bucket, label: `Bucket: ${bucket}` }),
    onClear: () => setFocus(null),
  };

  if (loading && !mergedTransactions.length && !snapshot) {
    return (
      <div className="page-grid dashboard-page">
        <section className="panel"><SkeletonBlock lines={10} /></section>
        <section className="panel"><SkeletonBlock lines={14} /></section>
      </div>
    );
  }

  if (!dashboard.rows.length && !dashboard.alerts.length) {
    return (
      <div className="page-grid dashboard-page">
        {error || pageError ? <div className="error-banner">{error || pageError}</div> : null}
        <EmptyState
          title="Dashboard is waiting for live fraud telemetry"
          description="Once transactions and alerts start flowing, the KPI cards, fraud pulse, charts, geo-risk surface, and leaderboards will update in real time."
          actionLabel="Refresh Dashboard"
          onAction={refreshAll}
        />
      </div>
    );
  }

  return (
    <div className="page-grid dashboard-page">
      {error ? <div className="error-banner">{error}</div> : null}
      {pageError ? <div className="error-banner">{pageError}</div> : null}

      <LiveStatusPanel
        pulse={{
          ...dashboard.pulse,
          riskShare: dashboard.riskShare,
          onSelectRisk: focusHandlers.onSelectRisk,
        }}
        connectionStatus={connectionStatus}
        connectionTransport={connectionTransport}
        bufferedEvents={bufferedEvents}
        lastUpdated={lastUpdated.toLocaleTimeString()}
      />

      <section className="panel dashboard-control-panel">
        <div className="panel-header">
          <div>
            <h3>Dashboard Controls</h3>
            <p>Range switching, cross-filtering, and export actions all drive the same live dataset.</p>
          </div>
          <div className="inline-form">
            <button className="secondary-button" type="button" onClick={() => exportDashboardPng(dashboard, focus)}>
              Export PNG
            </button>
            <button className="secondary-button" type="button" onClick={() => exportRowsToCsv("paywatch-dashboard.csv", dashboard.rows)}>
              Export CSV
            </button>
            <button className="secondary-button" type="button" onClick={() => exportDashboardPdf(dashboard, focus)}>
              Export PDF
            </button>
            <button className="secondary-button" type="button" onClick={refreshAll}>
              Refresh
            </button>
          </div>
        </div>

        <div className="dashboard-filter-stack">
          <div className="pill-toggle">
            {RANGE_OPTIONS.map((range) => (
              <button key={range} type="button" className={rangeKey === range ? "pill-button active" : "pill-button"} onClick={() => setRangeKey(range)}>
                {range}
              </button>
            ))}
          </div>
          <div className="dashboard-select-row">
            <label>
              Risk
              <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>
                {RISK_LEVELS.map((risk) => (
                  <option key={risk} value={risk}>
                    {risk}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Transaction Type
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                {availableTypes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            {rangeKey === "custom" ? (
              <>
                <label>
                  Start
                  <input type="datetime-local" value={customRange.start} onChange={(event) => setCustomRange((current) => ({ ...current, start: event.target.value }))} />
                </label>
                <label>
                  End
                  <input type="datetime-local" value={customRange.end} onChange={(event) => setCustomRange((current) => ({ ...current, end: event.target.value }))} />
                </label>
              </>
            ) : null}
          </div>
          <FocusChip focus={focus} onClear={focusHandlers.onClear} />
          <p className="smart-summary-text">{smartSummary}</p>
        </div>
      </section>

      <section className="panel smart-summary-panel">
        <div className="panel-header">
          <div>
            <h3>Smart Summary</h3>
            <p>Natural-language view of what changed in the active live window</p>
          </div>
        </div>
        <p className="smart-summary-text">{smartSummary}</p>
      </section>

      <section className="story-kpi-grid">
        {dashboard.kpis.map((metric) => (
          <KpiStoryCard
            key={metric.key}
            metric={metric}
            onClick={() => {
              if (metric.key === "transactions") navigate("/transactions");
              if (metric.key === "fraud-rate") navigate("/alerts");
              if (metric.key === "anomaly-layer") navigate("/analytics");
              if (metric.key === "alerts") navigate("/alerts");
            }}
          />
        ))}
      </section>

      <section className="dashboard-story-grid">
        <StoryAreaChart
          title="Transaction Volume"
          subtitle="Gradient volume story with live threshold bands and moving average overlay"
          series={dashboard.series}
          valueKey="volume"
          averageKey="movingAverage"
          tone="neutral"
          formatter={formatCount}
          comparisonFormatter={formatCount}
          thresholds={[
            { label: "Normal band", value: dashboard.pulse.movingAverage, tone: "neutral" },
            { label: "Suspicious surge", value: dashboard.pulse.movingAverage * 1.35, tone: "warning" },
          ]}
          onBucketSelect={focusHandlers.onSelectBucket}
        />
        <StoryAreaChart
          title="Fraud Rate"
          subtitle="Rate story aligned with the same live buckets driving the KPI card"
          series={dashboard.series}
          valueKey="fraudRate"
          tone="danger"
          formatter={(value) => formatPercent(value)}
          thresholds={[
            { label: "Normal", value: 0.12, tone: "success" },
            { label: "Watch", value: 0.22, tone: "warning" },
            { label: "Critical", value: 0.32, tone: "danger" },
          ]}
          onBucketSelect={focusHandlers.onSelectBucket}
        />
      </section>

      <section className="dashboard-story-grid">
        <StackedRiskBars series={dashboard.series} onSelectRisk={focusHandlers.onSelectRisk} onSelectBucket={focusHandlers.onSelectBucket} />
        <StoryAreaChart
          title="Anomaly and Alert Story"
          subtitle="Anomaly score stream with suspicious threshold bands and alert synchronization"
          series={dashboard.series.map((item) => ({
            ...item,
            alertRate: Math.min(item.alertSpikes / Math.max(item.volume || 1, 1), 1),
          }))}
          valueKey="anomalyScore"
          averageKey="alertRate"
          tone="success"
          formatter={(value) => formatPercent(value)}
          comparisonFormatter={(value) => formatPercent(value)}
          thresholds={[
            { label: "Expected", value: 0.35, tone: "success" },
            { label: "Suspicious", value: 0.55, tone: "warning" },
            { label: "Investigate", value: 0.72, tone: "danger" },
          ]}
          onBucketSelect={focusHandlers.onSelectBucket}
        />
      </section>

      <section className="dashboard-story-grid">
        <GeoRiskPanel items={dashboard.geoRisk} onFocus={setFocus} />
        <div className="leaderboard-stack">
          <Leaderboard title="Top risky merchants" subtitle="Merchants with the strongest current risk concentration" items={dashboard.leaders.merchants} focusKind="merchant" onFocus={setFocus} />
          <Leaderboard title="Top risky users" subtitle="Users or accounts driving graph and fraud pressure" items={dashboard.leaders.actors} focusKind="actor" onFocus={setFocus} />
          <Leaderboard title="Top risky types" subtitle="Transaction types climbing fastest right now" items={dashboard.leaders.types} focusKind="type" onFocus={setFocus} />
        </div>
      </section>

      <section className="dashboard-drill-grid">
        <button type="button" className="panel drill-card" onClick={() => navigate("/alerts")}>
          <strong>Drill into alerts</strong>
          <p>Open the alert workspace with the same live context and keep investigating from the filtered window.</p>
        </button>
        <button type="button" className="panel drill-card" onClick={() => navigate("/transactions")}>
          <strong>Drill into transactions</strong>
          <p>Review the transaction stream behind the charts, then jump to any individual case for detail.</p>
        </button>
        <button type="button" className="panel drill-card" onClick={() => navigate("/analytics")}>
          <strong>Drill into analytics</strong>
          <p>Open the analytics lens to inspect model behavior, threshold movement, drift, and score distributions.</p>
        </button>
      </section>

      <section className="dashboard-table-grid">
        <TransactionTable rows={[...dashboard.rows].sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()).slice(0, 16)} />
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Live alert queue</h3>
              <p>Progressive reveal list sourced from the same live filters</p>
            </div>
            <span>{formatCount(dashboard.alerts.length)} alerts</span>
          </div>
          <div className="workspace-list">
            {dashboard.alerts.length === 0 ? (
              <EmptyState title="No alerts in this filter" description="Try another time range or clear the cross-filter to widen the view." />
            ) : (
              dashboard.alerts
                .slice()
                .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
                .slice(0, 10)
                .map((alert) => (
                  <article key={alert.timestamp} className="workspace-card live-alert-card">
                    <div className="panel-header">
                      <div>
                        <strong>{alert.type || "Alert"}</strong>
                        <p>{String(alert.timestamp || "").replace("T", " ").slice(0, 19)}</p>
                      </div>
                      <span className={`risk-badge risk-${String(alert.risk_level || "LOW").toLowerCase()}`}>{alert.risk_level || "LOW"}</span>
                    </div>
                    <div className="live-alert-meta">
                      <span>{formatCurrency(alert.amount)}</span>
                      <span>{alert.assigned_to || "Unassigned"}</span>
                    </div>
                  </article>
                ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
