import { useEffect, useMemo, useState } from "react";
import EmptyState from "../components/EmptyState";
import SkeletonBlock from "../components/SkeletonBlock";
import { useAppData } from "../context/AppDataContext";
import { useWorkspace } from "../context/WorkspaceContext";
import {
  deriveAnalyticsModel,
  filterRowsByRange,
  formatCount,
  formatCurrency,
  formatDelta,
  formatPercent,
} from "../utils/liveMetrics";

const RANGE_OPTIONS = ["24h", "7d", "30d", "custom"];
const SAVED_VIEWS_KEY = "paywatch_saved_analysis_views_v1";
const ANALYST_NOTES_KEY = "paywatch_analytics_notes_v1";
const BOOKMARKS_KEY = "paywatch_analytics_bookmarks_v1";

function readStoredList(key, fallback = []) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function saveStoredList(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // ignore storage failures
  }
}

function AnalyticsMetric({ label, value, helper, tone = "neutral" }) {
  return (
    <article className={`analytics-metric-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

function ChartPanel({ title, subtitle, action, children }) {
  return (
    <div className="panel analytics-surface-card">
      <div className="panel-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        {action || null}
      </div>
      {children}
    </div>
  );
}

function buildLinePath(series = [], key, width, height, minValue = 0, maxValue = 1) {
  return series
    .map((item, index) => {
      const x = series.length === 1 ? width / 2 : (index / (series.length - 1)) * width;
      const y = height - ((Number(item[key] || 0) - minValue) / Math.max(maxValue - minValue, 1e-9)) * (height - 26) - 13;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function InteractiveLegend({ lines = [], enabled = {}, onToggle }) {
  return (
    <div className="trend-legend analytics-legend-interactive">
      {lines.map((line) => (
        <button key={line.key} type="button" className={enabled[line.key] ? "analytics-legend-pill active" : "analytics-legend-pill"} onClick={() => onToggle(line.key)}>
          <i className={`legend-dot legend-${line.legend || line.tone || "volume"}`} />
          {line.label}
        </button>
      ))}
    </div>
  );
}

function MultiLineTelemetryChart({ title, subtitle, series = [], lines = [], formatterMap = {} }) {
  const [enabled, setEnabled] = useState(() => Object.fromEntries(lines.map((line) => [line.key, true])));
  const [hoveredIndex, setHoveredIndex] = useState(Math.max(series.length - 1, 0));

  useEffect(() => {
    setEnabled(Object.fromEntries(lines.map((line) => [line.key, true])));
  }, [lines]);

  useEffect(() => {
    setHoveredIndex(Math.max(series.length - 1, 0));
  }, [series.length]);

  if (!series.length) {
    return (
      <ChartPanel title={title} subtitle={subtitle}>
        <EmptyState title="No telemetry yet" description="This chart will populate as live transactions keep arriving." />
      </ChartPanel>
    );
  }

  const activeLines = lines.filter((line) => enabled[line.key]);
  const width = 760;
  const height = 280;
  const values = activeLines.flatMap((line) => series.map((item) => Number(item[line.key] || 0)));
  const maxValue = Math.max(...values, 1);
  const activeIndex = Math.min(hoveredIndex, series.length - 1);
  const active = series[activeIndex] || {};
  const activeX = series.length === 1 ? width / 2 : (activeIndex / (series.length - 1)) * width;

  return (
    <ChartPanel title={title} subtitle={subtitle}>
      <div className="analytics-chart-stage">
        <svg viewBox={`0 0 ${width} ${height}`} className="analytics-story-chart" role="img" aria-label={title}>
          {Array.from({ length: 5 }, (_, index) => {
            const y = 16 + (height - 32) * (index / 4);
            return <line key={index} x1="0" y1={y} x2={width} y2={y} className="analytics-axis-line" />;
          })}
          <line x1={activeX} y1="0" x2={activeX} y2={height} className="analytics-crosshair" />
          {activeLines.map((line) => (
            <path key={line.key} d={buildLinePath(series, line.key, width, height, 0, maxValue)} className={`story-chart-line tone-${line.tone || "neutral"}`} />
          ))}
          {series.map((item, index) => {
            const x = series.length === 1 ? width / 2 : (index / (series.length - 1)) * width;
            return (
              <rect
                key={item.bucket || index}
                x={Math.max(x - width / Math.max(series.length, 1) / 2, 0)}
                y="0"
                width={Math.max(width / Math.max(series.length, 1), 18)}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHoveredIndex(index)}
              />
            );
          })}
        </svg>
        <div className="analytics-hover-card">
          <strong>{active.bucket}</strong>
          {activeLines.map((line) => (
            <span key={line.key}>
              <i className={`legend-dot legend-${line.legend || line.tone || "volume"}`} />
              {line.label}: {(formatterMap[line.key] || ((value) => value))(active[line.key])}
            </span>
          ))}
        </div>
      </div>
      <InteractiveLegend
        lines={lines}
        enabled={enabled}
        onToggle={(key) => setEnabled((current) => ({ ...current, [key]: !current[key] }))}
      />
      <div className="story-chart-axis">
        {series.map((item) => (
          <span key={item.bucket}>{item.bucket}</span>
        ))}
      </div>
    </ChartPanel>
  );
}

function HeatmapPanel({ heatmap }) {
  const maxValue = Math.max(...(heatmap.rows || []).flatMap((row) => row.values || []), 1);
  return (
    <ChartPanel title="Fraud Trend Heatmap" subtitle="Hourly pressure by transaction type">
      {!heatmap?.rows?.length ? (
        <div className="empty-state">No heatmap data in the current range.</div>
      ) : (
        <div className="heatmap heatmap-advanced">
          <div className="heatmap-header">
            <span>Type / Hour</span>
            <div className="heatmap-hours">
              {heatmap.hours.map((hour) => (
                <span key={hour}>{hour.slice(0, 2)}</span>
              ))}
            </div>
          </div>
          {heatmap.rows.map((row) => (
            <div key={row.type} className="heatmap-row">
              <span className="heatmap-label">
                <strong>{row.type}</strong>
                <small>{row.values.reduce((sum, value) => sum + Number(value || 0), 0)} pts</small>
              </span>
              <div className="heatmap-cells">
                {row.values.map((value, index) => (
                  <div
                    key={`${row.type}-${index}`}
                    className="heatmap-cell"
                    style={{ opacity: 0.16 + Number(value || 0) / maxValue }}
                    title={`${row.type} at ${heatmap.hours[index]}: ${value}`}
                  >
                    {value > 0 ? value : ""}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </ChartPanel>
  );
}

function CorrelationMatrix({ items = [] }) {
  return (
    <ChartPanel title="Correlation Matrix" subtitle="How the major risk signals move together">
      {!items.length ? (
        <div className="empty-state">Correlation matrix needs more data.</div>
      ) : (
        <div className="correlation-grid">
          {items.map((item) => (
            <article key={`${item.x}-${item.y}`} className={`correlation-cell ${item.value > 0.4 ? "positive" : item.value < -0.2 ? "negative" : "neutral"}`}>
              <span>{item.x} x {item.y}</span>
              <strong>{item.value.toFixed(2)}</strong>
            </article>
          ))}
        </div>
      )}
    </ChartPanel>
  );
}

function ScatterPlot({ points = [] }) {
  const [zoom, setZoom] = useState(1);
  if (!points.length) {
    return (
      <ChartPanel title="Anomaly Scatter Plot" subtitle="Outlier transactions by amount, anomaly, and fraud score">
        <div className="empty-state">No scatter points available.</div>
      </ChartPanel>
    );
  }

  const width = 720;
  const height = 280;
  const maxX = Math.max(...points.map((point) => Number(point.x || 0)), 1) / zoom;
  const maxY = Math.max(...points.map((point) => Number(point.y || 0)), 1);
  return (
    <ChartPanel
      title="Anomaly Scatter Plot"
      subtitle="Bubble size tracks fraud score while the x-axis is zoomable"
      action={
        <label className="analytics-inline-control">
          Zoom
          <input type="range" min="1" max="4" step="0.5" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
        </label>
      }
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="analytics-story-chart" role="img" aria-label="Anomaly scatter plot">
        <line x1="36" y1={height - 24} x2={width} y2={height - 24} className="analytics-axis-line" />
        <line x1="36" y1="0" x2="36" y2={height - 24} className="analytics-axis-line" />
        {points.map((point, index) => {
          const x = 36 + Math.min((Number(point.x || 0) / Math.max(maxX, 1e-9)) * (width - 60), width - 60);
          const y = height - 24 - (Number(point.y || 0) / Math.max(maxY, 1e-9)) * (height - 48);
          const r = 4 + Number(point.z || 0) * 10;
          return <circle key={`${point.label}-${index}`} cx={x} cy={y} r={r} className="scatter-point" title={`${point.label} | ${point.detail}`} />;
        })}
      </svg>
      <p className="muted-copy">Left to right: amount. Bottom to top: anomaly score. Larger bubbles indicate stronger fraud score.</p>
    </ChartPanel>
  );
}

function SegmentedPanels({ segments = {} }) {
  const entries = [
    ["channel", "Channel"],
    ["type", "Transaction Type"],
    ["merchant", "Merchant"],
    ["actor", "User"],
    ["geography", "Geography"],
    ["device", "Device"],
  ];
  return (
    <div className="analytics-segment-grid">
      {entries.map(([key, label]) => (
        <ChartPanel key={key} title={label} subtitle="Segmented risk and volume view">
          <div className="bar-list">
            {(segments[key] || []).slice(0, 5).map((item) => (
              <div key={item.label} className="bar-row">
                <div className="bar-row-header">
                  <span>{item.label}</span>
                  <strong>{formatPercent(item.highRiskRate)}</strong>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max(item.highRiskRate * 100, 4)}%` }} />
                </div>
                <small className="muted-copy">{formatCount(item.count)} events · avg {formatCurrency(item.avgAmount)}</small>
              </div>
            ))}
            {(segments[key] || []).length === 0 ? <div className="empty-state">No segment data in range.</div> : null}
          </div>
        </ChartPanel>
      ))}
    </div>
  );
}

function ExplainabilityPanel({ explainability }) {
  return (
    <div className="analytics-segment-grid">
      <ChartPanel title="Top Contributing Features" subtitle="Global explainability-style view">
        <div className="bar-list">
          {explainability.topFeatures.map((item) => (
            <div key={item.label} className="bar-row">
              <div className="bar-row-header">
                <span>{item.label}</span>
                <strong>{item.impact.toFixed(2)}</strong>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${Math.max(item.impact * 100, 6)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </ChartPanel>
      <ChartPanel title="Risk Breakdown Bars" subtitle="How the current fraud pulse splits by scoring layer">
        <div className="bar-list">
          {explainability.riskBreakdown.map((item) => (
            <div key={item.label} className="bar-row">
              <div className="bar-row-header">
                <span>{item.label}</span>
                <strong>{formatPercent(item.value)}</strong>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${Math.max(item.value * 100, 8)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </ChartPanel>
      <ChartPanel title="SHAP-style Explanation Cards" subtitle="Case-level explanation cards for recent high-risk transactions">
        <div className="workspace-list">
          {explainability.shapCards.map((card) => (
            <article key={card.id} className="workspace-card">
              <strong>{card.title}</strong>
              <div className="reason-chip-row">
                {card.reasons.map((reason) => (
                  <span key={reason.label} className="reason-chip">
                    {reason.label}: {formatPercent(reason.value)}
                  </span>
                ))}
              </div>
            </article>
          ))}
          {!explainability.shapCards.length ? <div className="empty-state">No high-risk explanation cards in this view.</div> : null}
        </div>
      </ChartPanel>
    </div>
  );
}

function ComparisonPanel({ compare }) {
  return (
    <ChartPanel title="Comparison Mode" subtitle="Compare the current period against the previous matching period">
      {!compare?.deltas?.length ? (
        <div className="empty-state">Comparison mode needs enough history to compute the previous period.</div>
      ) : (
        <div className="comparison-grid comparison-grid-two">
          {compare.deltas.map((item) => (
            <article key={item.label} className="comparison-card">
              <strong>{item.label}</strong>
              <span>Current: {item.format === "percent" ? formatPercent(item.current) : formatCount(item.current)}</span>
              <span>Previous: {item.format === "percent" ? formatPercent(item.previous) : formatCount(item.previous)}</span>
              <strong>{item.format === "percent" ? formatDelta(item.delta * 100) : formatDelta(item.delta, "")}</strong>
            </article>
          ))}
        </div>
      )}
    </ChartPanel>
  );
}

function FunnelPanel({ funnel = [] }) {
  const maxValue = Math.max(...funnel.map((item) => Number(item.value || 0)), 1);
  return (
    <ChartPanel title="Investigation Funnel" subtitle="Transactions to suspicious, reviewed, and confirmed fraud">
      <div className="analytics-funnel">
        {funnel.map((item) => (
          <article key={item.label} className="funnel-step" style={{ width: `${Math.max((item.value / maxValue) * 100, 28)}%` }}>
            <span>{item.label}</span>
            <strong>{formatCount(item.value)}</strong>
          </article>
        ))}
      </div>
    </ChartPanel>
  );
}

function DistributionPanel({ distributions = {} }) {
  const panels = [
    ["amount", "Amount"],
    ["balanceChange", "Balance Change"],
    ["velocity", "Velocity"],
  ];
  return (
    <div className="analytics-segment-grid">
      {panels.map(([key, label]) => (
        <ChartPanel key={key} title={`${label} Distribution`} subtitle="Current range distribution plot">
          <div className="distribution-bars">
            {(distributions[key] || []).map((item) => (
              <div key={item.label} className="distribution-column">
                <div className="distribution-fill" style={{ height: `${Math.max(item.count * 10, 14)}px` }} />
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </ChartPanel>
      ))}
      <ChartPanel title="Repeated Actors" subtitle="Actors recurring most often in the current slice">
        <div className="workspace-list">
          {(distributions.repeatedActors || []).map((item) => (
            <article key={item.label} className="workspace-card">
              <strong>{item.label}</strong>
              <p>{formatCount(item.count)} transactions</p>
              <span>{formatPercent(item.highRiskRate)} high-risk rate</span>
            </article>
          ))}
        </div>
      </ChartPanel>
    </div>
  );
}

function OutlierExplorer({ outliers = [] }) {
  const [brush, setBrush] = useState([0, Math.min(outliers.length - 1, 11)]);
  const visible = outliers.slice(Math.min(...brush), Math.max(...brush) + 1);
  return (
    <ChartPanel title="Outlier Explorer" subtitle="Zoomable outlier timeline with brush selection">
      {!outliers.length ? (
        <div className="empty-state">No outliers detected in the current slice.</div>
      ) : (
        <div className="outlier-explorer">
          <div className="chart-brush-row">
            <label>
              Start
              <input type="range" min="0" max={Math.max(outliers.length - 1, 0)} value={brush[0]} onChange={(event) => setBrush((current) => [Number(event.target.value), current[1]])} />
            </label>
            <label>
              End
              <input type="range" min="0" max={Math.max(outliers.length - 1, 0)} value={brush[1]} onChange={(event) => setBrush((current) => [current[0], Number(event.target.value)])} />
            </label>
          </div>
          <div className="workspace-list">
            {visible.map((item) => (
              <article key={item.id} className="workspace-card">
                <strong>{item.type}</strong>
                <p>{formatCurrency(item.amount)} · anomaly {formatPercent(item.anomaly)} · fraud {formatPercent(item.fraud)}</p>
                <span>{item.actor} · {item.merchant}</span>
              </article>
            ))}
          </div>
        </div>
      )}
    </ChartPanel>
  );
}

function ForecastPanel({ forecast }) {
  return (
    <ChartPanel title="Forecasting Widgets" subtitle="Projected fraud volume and alert load">
      <div className="analytics-metric-grid">
        <AnalyticsMetric label="Projected fraud volume" value={formatCount(forecast.fraudVolume)} helper={forecast.confidence} tone="danger" />
        <AnalyticsMetric label="Projected alert load" value={formatCount(forecast.alertLoad)} helper="Expected analyst queue pressure" tone="warning" />
        <AnalyticsMetric label="Projected suspicious flow" value={formatCount(forecast.suspiciousLoad)} helper="Likely suspicious transactions" tone="neutral" />
        <AnalyticsMetric label="Forecast confidence" value={forecast.confidence} helper="Based on recent live slices" tone="success" />
      </div>
    </ChartPanel>
  );
}

function SavedViewsPanel({ views, onSave, onLoad, bookmarks, onBookmark, notes, noteDraft, onNoteDraft, onAddNote, activeContext }) {
  return (
    <div className="analytics-segment-grid">
      <ChartPanel title="Saved Analysis Views" subtitle="Save and reload analytics configurations">
        <div className="inline-form">
          <button className="secondary-button" type="button" onClick={onSave}>Save Current View</button>
        </div>
        <div className="workspace-list">
          {views.map((view) => (
            <button key={view.id} type="button" className="workspace-card workspace-card-button" onClick={() => onLoad(view)}>
              <strong>{view.name}</strong>
              <p>{view.rangeKey} · {view.savedAt}</p>
            </button>
          ))}
          {!views.length ? <div className="empty-state">No saved views yet.</div> : null}
        </div>
      </ChartPanel>
      <ChartPanel title="Analyst Bookmarks" subtitle="Bookmark important spikes and windows">
        <div className="inline-form">
          <button className="secondary-button" type="button" onClick={onBookmark}>Bookmark Current Window</button>
        </div>
        <div className="workspace-list">
          {bookmarks.map((bookmark) => (
            <article key={bookmark.id} className="workspace-card">
              <strong>{bookmark.label}</strong>
              <p>{bookmark.savedAt}</p>
            </article>
          ))}
          {!bookmarks.length ? <div className="empty-state">No bookmarks yet.</div> : null}
        </div>
      </ChartPanel>
      <ChartPanel title="Analyst Notes On Window" subtitle="Attach notes directly to the current time window">
        <textarea className="notes-textarea" value={noteDraft} onChange={(event) => onNoteDraft(event.target.value)} placeholder={`Add notes for ${activeContext}.`} />
        <div className="inline-form">
          <button className="secondary-button" type="button" onClick={onAddNote}>Save Note</button>
        </div>
        <div className="workspace-list">
          {notes.map((note) => (
            <article key={note.id} className="workspace-card">
              <strong>{note.context}</strong>
              <p>{note.text}</p>
              <span>{note.savedAt}</span>
            </article>
          ))}
          {!notes.length ? <div className="empty-state">No notes saved yet.</div> : null}
        </div>
      </ChartPanel>
    </div>
  );
}

export default function AnalyticsPageV2() {
  const { transactions, alerts, analytics, loading, connectionStatus, bufferedEvents } = useAppData();
  const { pushToast } = useWorkspace();
  const [rangeKey, setRangeKey] = useState("24h");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [savedViews, setSavedViews] = useState(() => readStoredList(SAVED_VIEWS_KEY, []));
  const [bookmarks, setBookmarks] = useState(() => readStoredList(BOOKMARKS_KEY, []));
  const [notes, setNotes] = useState(() => readStoredList(ANALYST_NOTES_KEY, []));
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    saveStoredList(SAVED_VIEWS_KEY, savedViews);
  }, [savedViews]);

  useEffect(() => {
    saveStoredList(BOOKMARKS_KEY, bookmarks);
  }, [bookmarks]);

  useEffect(() => {
    saveStoredList(ANALYST_NOTES_KEY, notes);
  }, [notes]);

  const liveTransactions = useMemo(() => filterRowsByRange(transactions, rangeKey, customRange), [transactions, rangeKey, customRange]);
  const liveAlerts = useMemo(() => filterRowsByRange(alerts, rangeKey, customRange), [alerts, rangeKey, customRange]);
  const model = useMemo(() => deriveAnalyticsModel(liveTransactions, liveAlerts, { rangeKey, customRange }), [liveTransactions, liveAlerts, rangeKey, customRange]);

  const precision = analytics?.performance_panels?.summary?.precision ?? model.telemetry.precision;
  const recall = analytics?.performance_panels?.summary?.recall ?? model.telemetry.recall;
  const driftRatio = analytics?.drift_analytics?.data_drift?.drift_ratio ?? model.telemetry.driftRatio;
  const latest = model.series[model.series.length - 1] || {};
  const activeContext = `${rangeKey}${rangeKey === "custom" ? ` ${customRange.start || ""} - ${customRange.end || ""}` : ""}`.trim();

  function handleSaveView() {
    const view = {
      id: `${Date.now()}`,
      name: `Analysis view ${savedViews.length + 1}`,
      rangeKey,
      customRange,
      savedAt: new Date().toLocaleString(),
    };
    setSavedViews((current) => [view, ...current].slice(0, 12));
    pushToast({ title: "Analysis view saved", message: "Current analytics configuration was saved.", tone: "success" });
  }

  function handleLoadView(view) {
    setRangeKey(view.rangeKey || "24h");
    setCustomRange(view.customRange || { start: "", end: "" });
    pushToast({ title: "Analysis view loaded", message: `${view.name} is active now.`, tone: "info" });
  }

  function handleBookmark() {
    const item = {
      id: `${Date.now()}`,
      label: `${activeContext} · fraud ${formatPercent(model.pulse.fraudRate)}`,
      savedAt: new Date().toLocaleString(),
    };
    setBookmarks((current) => [item, ...current].slice(0, 14));
    pushToast({ title: "Window bookmarked", message: "Current analytics window was bookmarked.", tone: "success" });
  }

  function handleAddNote() {
    if (!noteDraft.trim()) return;
    const next = {
      id: `${Date.now()}`,
      context: activeContext,
      text: noteDraft.trim(),
      savedAt: new Date().toLocaleString(),
    };
    setNotes((current) => [next, ...current].slice(0, 18));
    setNoteDraft("");
    pushToast({ title: "Analyst note saved", message: "Your note was attached to this analytics window.", tone: "success" });
  }

  if (loading && !transactions.length && !alerts.length) {
    return (
      <div className="page-grid analytics-page">
        <section className="panel"><SkeletonBlock lines={8} /></section>
        <section className="panel"><SkeletonBlock lines={10} /></section>
      </div>
    );
  }

  if (!model.rows.length && !model.alerts.length) {
    return (
      <div className="page-grid analytics-page">
        <EmptyState
          title="Analytics is ready for real-time model telemetry"
          description="Once transactions and alerts continue flowing, cohort analysis, heatmaps, explainability cards, forecasting, comparison mode, notes, and bookmarks will all appear here."
          actionLabel="Refresh Analytics"
          onAction={() => window.location.reload()}
        />
      </div>
    );
  }

  return (
    <div className="page-grid analytics-page">
      <section className="panel analytics-hero-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Live Analytics Lens</p>
            <h3>Deeper fraud investigation with comparison mode, explainability, forecasting, and analyst memory</h3>
            <p className="smart-summary-text">
              {model.telemetry.spikeSummary} Connection is {String(connectionStatus || "connecting").toUpperCase()} with {formatCount(bufferedEvents)} buffered events.
            </p>
          </div>
          <div className="pill-toggle">
            {RANGE_OPTIONS.map((range) => (
              <button key={range} type="button" className={rangeKey === range ? "pill-button active" : "pill-button"} onClick={() => setRangeKey(range)}>
                {range}
              </button>
            ))}
          </div>
        </div>
        {rangeKey === "custom" ? (
          <div className="dashboard-select-row">
            <label>
              Start
              <input type="datetime-local" value={customRange.start} onChange={(event) => setCustomRange((current) => ({ ...current, start: event.target.value }))} />
            </label>
            <label>
              End
              <input type="datetime-local" value={customRange.end} onChange={(event) => setCustomRange((current) => ({ ...current, end: event.target.value }))} />
            </label>
          </div>
        ) : null}
      </section>

      <section className="analytics-metric-grid">
        <AnalyticsMetric label="Precision" value={formatPercent(precision)} helper={`Delta ${formatDelta((precision - recall) * 100)}`} tone="success" />
        <AnalyticsMetric label="Recall" value={formatPercent(recall)} helper="Recovered suspicious activity" tone="warning" />
        <AnalyticsMetric label="Drift ratio" value={formatPercent(driftRatio)} helper="Feature movement versus baseline" tone="danger" />
        <AnalyticsMetric label="Active bucket volume" value={formatCount(latest.volume || 0)} helper={`Latest fraud ${formatPercent(latest.fraudRate || 0)}`} tone="neutral" />
      </section>

      <section className="content-grid analytics-grid-wide">
        <MultiLineTelemetryChart
          title="Realtime Telemetry"
          subtitle="Legend interactions, hover cards, and stronger axis styling for the core live metrics"
          series={model.telemetry.comparisonSeries}
          lines={[
            { key: "volume", label: "Volume", tone: "neutral", legend: "volume" },
            { key: "fraudRate", label: "Fraud rate", tone: "danger", legend: "danger" },
            { key: "anomalyScore", label: "Anomaly", tone: "success", legend: "success" },
            { key: "alertSpikes", label: "Alerts", tone: "warning", legend: "warning" },
          ]}
          formatterMap={{
            volume: formatCount,
            fraudRate: formatPercent,
            anomalyScore: formatPercent,
            alertSpikes: formatCount,
          }}
        />
        <ComparisonPanel compare={model.telemetry.compare} />
      </section>

      <section className="content-grid analytics-grid-wide">
        <HeatmapPanel heatmap={model.telemetry.heatmap} />
        <ScatterPlot points={model.telemetry.scatter} />
      </section>

      <section className="content-grid analytics-grid-wide">
        <CorrelationMatrix items={model.telemetry.correlations} />
        <ForecastPanel forecast={model.telemetry.forecast} />
      </section>

      <section className="content-grid analytics-grid-wide">
        <FunnelPanel funnel={model.telemetry.funnel} />
        <ChartPanel title="Why Did This Spike Happen?" subtitle="AI-style summary grounded in the data already shown">
          <div className="ai-summary-box">
            <strong>Spike Summary</strong>
            <p>{model.telemetry.spikeSummary}</p>
          </div>
        </ChartPanel>
      </section>

      <ExplainabilityPanel explainability={model.telemetry.explainability} />

      <SegmentedPanels segments={model.telemetry.segments} />

      <DistributionPanel distributions={model.telemetry.distributions} />

      <section className="content-grid analytics-grid-wide">
        <OutlierExplorer outliers={model.telemetry.outliers} />
        <ChartPanel title="Cohort Analysis" subtitle="Side-by-side cohort slices across the strongest segments">
          <div className="comparison-grid comparison-grid-two">
            {(model.telemetry.segments.channel || []).slice(0, 3).map((item) => (
              <article key={item.label} className="cohort-card">
                <strong>{item.label}</strong>
                <span>{formatCount(item.count)} transactions</span>
                <span>{formatPercent(item.highRiskRate)} high-risk rate</span>
                <span>{formatCurrency(item.avgAmount)} avg amount</span>
              </article>
            ))}
            {(model.telemetry.segments.device || []).slice(0, 3).map((item) => (
              <article key={item.label} className="cohort-card">
                <strong>{item.label}</strong>
                <span>{formatCount(item.count)} transactions</span>
                <span>{formatPercent(item.highRiskRate)} high-risk rate</span>
                <span>{formatCurrency(item.avgAmount)} avg amount</span>
              </article>
            ))}
          </div>
        </ChartPanel>
      </section>

      <SavedViewsPanel
        views={savedViews}
        onSave={handleSaveView}
        onLoad={handleLoadView}
        bookmarks={bookmarks}
        onBookmark={handleBookmark}
        notes={notes}
        noteDraft={noteDraft}
        onNoteDraft={setNoteDraft}
        onAddNote={handleAddNote}
        activeContext={activeContext}
      />
    </div>
  );
}
