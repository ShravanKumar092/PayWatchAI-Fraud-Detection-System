import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import RiskBadge from "../components/RiskBadge";
import SkeletonBlock from "../components/SkeletonBlock";
import { useAuth } from "../context/AuthContext";
import { useAppData } from "../context/AppDataContext";
import { useWorkspace } from "../context/WorkspaceContext";
import {
  annotateTransactions,
  bulkInvestigateTransactions,
  compareTransactions,
  getTransactionDetails,
  getTransactionReport,
  getTransactions,
  saveCasebook,
  saveTransactionView
} from "../services/api";

function readJsonPreference(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function readJsonPreferenceOrNull(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(amount || 0));
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatRelative(timestamp) {
  if (!timestamp) {
    return "n/a";
  }
  const seconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.round(seconds / 3600)}h ago`;
  }
  return `${Math.round(seconds / 86400)}d ago`;
}

function downloadText(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportRows(rows, format = "csv") {
  if (!rows.length) {
    return;
  }
  const keys = [
    "transaction_id",
    "timestamp",
    "type",
    "amount",
    "fraud_probability",
    "anomaly_risk",
    "graph_score",
    "risk_level",
    "source_account",
    "destination_account",
    "merchant",
    "tags",
    "bookmarked"
  ];
  const delimiter = format === "excel" ? "\t" : ",";
  const body = [
    keys.join(delimiter),
    ...rows.map((row) => keys.map((key) => JSON.stringify(row[key] ?? "")).join(delimiter))
  ].join("\n");
  downloadText(
    `transactions-export.${format === "excel" ? "xls" : "csv"}`,
    format === "excel" ? "application/vnd.ms-excel" : "text/csv;charset=utf-8",
    body
  );
}

function FraudGraphMini({ graph }) {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  if (!nodes.length) {
    return <div className="empty-state compact-empty">Graph view is not available yet.</div>;
  }
  const width = 320;
  const height = 120;
  const positions = nodes.map((node, index) => {
    const x = 36 + index * ((width - 72) / Math.max(nodes.length - 1, 1));
    const y = index % 2 === 0 ? 40 : 82;
    return { ...node, x, y };
  });
  return (
    <div className="graph-mini">
      <svg viewBox={`0 0 ${width} ${height}`} className="comparison-chart" role="img" aria-label="Fraud graph mini view">
        {edges.map((edge, index) => {
          const from = positions.find((node) => node.id === edge.from) || positions[0];
          const to = positions.find((node) => node.id === edge.to) || positions[positions.length - 1];
          return (
            <line
              key={`${edge.from}-${edge.to}-${index}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="rgba(92,200,255,0.5)"
              strokeWidth={Math.max(1.5, Number(edge.weight || 0) * 4)}
            />
          );
        })}
        {positions.map((node) => (
          <g key={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r="11"
              fill={node.tone === "danger" ? "rgba(255,95,122,0.24)" : "rgba(92,200,255,0.18)"}
              stroke={node.tone === "danger" ? "var(--danger)" : "var(--accent)"}
            />
            <text x={node.x} y={node.y + 3} textAnchor="middle" fontSize="9" fill="var(--text)">
              {String(node.label || "").slice(0, 3)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function TransactionPreviewPanel({ details, onAnnotate, onPrint }) {
  if (!details?.transaction) {
    return <div className="empty-state">Open a row to inspect explanation, graph links, and related activity.</div>;
  }
  const transaction = details.transaction;
  return (
    <div className="alert-list">
      <article className="smart-alert-card">
        <div className="smart-alert-top">
          <strong>{transaction.type}</strong>
          <RiskBadge risk={transaction.risk_level} />
        </div>
        <div className="smart-alert-grid">
          <div className="smart-alert-metric">
            <span>Amount</span>
            <strong>{formatCurrency(transaction.amount)}</strong>
          </div>
          <div className="smart-alert-metric">
            <span>Anomaly</span>
            <strong>{formatPercent(transaction.anomaly_risk)}</strong>
          </div>
          <div className="smart-alert-metric">
            <span>Graph</span>
            <strong>{formatPercent(transaction.graph_score)}</strong>
          </div>
        </div>
        <div className="reason-chip-row">
          {(transaction.reason_chips || []).map((chip) => (
            <span key={chip} className="reason-chip">
              {chip}
            </span>
          ))}
        </div>
        <div className="inline-form">
          <button className="secondary-button" type="button" onClick={() => onAnnotate({ transaction_ids: [transaction.transaction_id], bookmarked: !transaction.bookmarked })}>
            {transaction.bookmarked ? "Remove Bookmark" : "Bookmark"}
          </button>
          <button className="secondary-button" type="button" onClick={onPrint}>
            Print Case Report
          </button>
        </div>
      </article>

      <div className="panel">
        <div className="panel-header">
          <h3>Fraud Graph Mini-View</h3>
          <p>Shared nodes from source, destination, and linked transactions</p>
        </div>
        <FraudGraphMini graph={transaction.graph_view} />
      </div>

      <div className="content-grid analytics-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Device / IP Fingerprint Pivot</h3>
            <p>Shared device, IP, and fingerprint-linked activity</p>
          </div>
          <dl className="details-grid">
            <div><dt>Device</dt><dd>{details.device_pivot?.device_id || "n/a"}</dd></div>
            <div><dt>IP</dt><dd>{details.device_pivot?.ip_address || "n/a"}</dd></div>
            <div><dt>Fingerprint</dt><dd>{details.device_pivot?.fingerprint || "n/a"}</dd></div>
          </dl>
          <div className="workspace-list">
            {(details.device_pivot?.linked_transactions || []).map((item) => (
              <article key={item.transaction_id} className="workspace-card">
                <strong>{item.match_reason}</strong>
                <p>{formatCurrency(item.amount)} · {item.risk_level}</p>
                <span>{String(item.timestamp || "").replace("T", " ").slice(0, 19)}</span>
              </article>
            ))}
            {!(details.device_pivot?.linked_transactions || []).length ? <div className="empty-state">No linked device or IP activity found.</div> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Merchant / Entity Workspace</h3>
            <p>Deep-linkable entity context and recent merchant activity</p>
          </div>
          <dl className="details-grid">
            <div><dt>Entity</dt><dd>{details.entity_workspace?.entity_label || "n/a"}</dd></div>
            <div><dt>Entity ID</dt><dd>{details.entity_workspace?.entity_id || "n/a"}</dd></div>
            <div><dt>Transactions</dt><dd>{details.entity_workspace?.transaction_count || 0}</dd></div>
            <div><dt>Average Risk</dt><dd>{formatPercent(details.entity_workspace?.avg_risk || 0)}</dd></div>
          </dl>
          <div className="workspace-list">
            {(details.entity_workspace?.recent_transactions || []).map((item) => (
              <article key={item.transaction_id} className="workspace-card">
                <strong>{item.type}</strong>
                <p>{formatCurrency(item.amount)} · {item.risk_level}</p>
                <span>{String(item.timestamp || "").replace("T", " ").slice(0, 19)}</span>
              </article>
            ))}
            {!(details.entity_workspace?.recent_transactions || []).length ? <div className="empty-state">No entity-linked activity found.</div> : null}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Related Alerts</h3>
          <p>Alerts linked to the same transaction path</p>
        </div>
        <div className="alert-list">
          {(transaction.related_alerts || []).map((alert) => (
            <article key={alert.timestamp} className="alert-card">
              <div className="alert-card-top">
                <strong>{alert.status}</strong>
                <span>{alert.severity}</span>
              </div>
              <p>{alert.timestamp}</p>
              <span>Priority {alert.priority_score}</span>
            </article>
          ))}
          {!transaction.related_alerts?.length ? <div className="empty-state">No related alerts matched this path.</div> : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Related Transactions</h3>
          <p>Shared accounts, devices, merchants, or graph neighbors</p>
        </div>
        <div className="alert-list">
          {(details.related_transactions || []).map((row) => (
            <article key={row.transaction_id} className="alert-card">
              <div className="alert-card-top">
                <strong>{row.type}</strong>
                <span>{row.match_reason}</span>
              </div>
              <p>{row.timestamp}</p>
              <span>{formatCurrency(row.amount)} · {row.risk_level}</span>
            </article>
          ))}
          {!details.related_transactions?.length ? <div className="empty-state">No related transactions found.</div> : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Fraud Journey Replay</h3>
          <p>Step-by-step causality across scoring, related events, and investigation outcome</p>
        </div>
        <div className="workspace-list">
          {(details.journey_replay || []).map((step) => (
            <article key={`${step.step}-${step.timestamp}`} className="workspace-card">
              <strong>Step {step.step}: {step.title}</strong>
              <p>{step.description}</p>
              <span>{step.causality}</span>
            </article>
          ))}
          {!(details.journey_replay || []).length ? <div className="empty-state">No fraud journey replay available yet.</div> : null}
        </div>
      </div>

      <div className="content-grid analytics-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Velocity And History</h3>
            <p>Repeat actor, merchant, device, account velocity, and seen-before status</p>
          </div>
          <dl className="details-grid">
            <div><dt>Repeat Actor</dt><dd>{transaction.repeat_actor ? "yes" : "no"}</dd></div>
            <div><dt>Repeat Merchant</dt><dd>{transaction.repeat_merchant ? "yes" : "no"}</dd></div>
            <div><dt>Seen Before</dt><dd>{transaction.seen_before ? "yes" : "no"}</dd></div>
            <div><dt>Manual Review</dt><dd>{transaction.manual_review_score || 0}</dd></div>
            {Object.entries(transaction.velocity_summary || {}).map(([key, value]) => (
              <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>
            ))}
          </dl>
          <div className="reason-chip-row">
            {(transaction.suspicious_pattern_badges || []).map((badge) => <span key={badge} className="reason-chip">{badge}</span>)}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Geo And Scoring Lenses</h3>
            <p>Location confidence, loss estimates, and recalculated backend lenses</p>
          </div>
          <dl className="details-grid">
            <div><dt>Route</dt><dd>{details.geo_route?.source || transaction.geo_route?.source || "n/a"} to {details.geo_route?.destination || transaction.geo_route?.destination || "n/a"}</dd></div>
            <div><dt>Geo Confidence</dt><dd>{formatPercent(details.geo_route?.confidence || transaction.geo_route?.confidence || 0)}</dd></div>
            <div><dt>Fraud Loss</dt><dd>{formatCurrency(transaction.fraud_loss_estimate || 0)}</dd></div>
            <div><dt>Blocked Loss</dt><dd>{formatCurrency(transaction.blocked_loss_estimate || 0)}</dd></div>
            {Object.entries(transaction.scoring_lenses || {}).map(([key, value]) => (
              <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>
            ))}
          </dl>
          <div className="reason-chip-row">
            <span className="reason-chip">Cohort pivot: {details.cohort_analytics_route || "/analytics"}</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Similar Transaction Finder</h3>
          <p>Backend similarity matches by actor, merchant, destination, and pattern badges</p>
        </div>
        <div className="workspace-list">
          {(details.similar_transactions || []).slice(0, 8).map((row) => (
            <article key={row.transaction_id} className="workspace-card">
              <strong>{row.transaction_id} / {row.type}</strong>
              <p>{formatCurrency(row.amount)} / {row.merchant || row.destination_account}</p>
              <span>{row.risk_level} / manual review {row.manual_review_score}</span>
            </article>
          ))}
          {!(details.similar_transactions || []).length ? <div className="empty-state">No similar transactions found.</div> : null}
        </div>
      </div>
    </div>
  );
}

export default function TransactionsPage() {
  const { token } = useAuth();
  const { setSelectedTransaction } = useAppData();
  const { pushToast } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = readJsonPreference("paywatch_default_filters", {});
  const [filters, setFilters] = useState({
    date_from: searchParams.get("date_from") || "",
    date_to: searchParams.get("date_to") || "",
    amount_min: searchParams.get("amount_min") || "",
    amount_max: searchParams.get("amount_max") || "",
    risk_level: searchParams.get("risk_level") || defaults.risk_level || "ALL",
    transaction_type: searchParams.get("transaction_type") || defaults.transaction_type || "ALL",
    user: searchParams.get("user") || "",
    merchant: searchParams.get("merchant") || "",
    source: searchParams.get("source") || "",
    destination: searchParams.get("destination") || "",
    related_mode: searchParams.get("related_mode") || "",
    minimum_related: Number(searchParams.get("minimum_related") || 0)
  });
  const [page, setPage] = useState(Number(searchParams.get("page") || 1));
  const [pageSize, setPageSize] = useState(Number(searchParams.get("page_size") || 25));
  const [sortBy, setSortBy] = useState(searchParams.get("sort_by") || "timestamp");
  const [sortDir, setSortDir] = useState(searchParams.get("sort_dir") || "desc");
  const [savedView, setSavedView] = useState(searchParams.get("saved_view") || "");
  const [workspace, setWorkspace] = useState(null);
  const [details, setDetails] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [viewName, setViewName] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const compactDefaultHiddenColumns = ["anomaly_risk", "graph_score", "manual_review_score", "risk_confidence_band", "merchant", "source_account", "destination_account"];
  const compactDefaultColumnWidths = {
    bookmarked: 74,
    transaction_id: 96,
    timestamp: 116,
    type: 104,
    amount: 96,
    fraud_probability: 76,
    risk_level: 88,
  };
  const [pinnedColumns, setPinnedColumns] = useState(readJsonPreference("paywatch_pinned_columns", ["bookmarked"]));
  const [hiddenColumns, setHiddenColumns] = useState(readJsonPreferenceOrNull("paywatch_hidden_columns") || compactDefaultHiddenColumns);
  const [columnWidths, setColumnWidths] = useState({ ...compactDefaultColumnWidths, ...readJsonPreference("paywatch_column_widths", {}) });
  const [densityMode, setDensityMode] = useState(readJsonPreference("paywatch_table_density", "compact"));
  const [filterLogic, setFilterLogic] = useState("AND");
  const [liveTapePaused, setLiveTapePaused] = useState(false);
  const [scoringLens, setScoringLens] = useState("ensemble");
  const [casebookName, setCasebookName] = useState("");
  const [selectedCasebook, setSelectedCasebook] = useState("");
  const tableContainerRef = useRef(null);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(520);

  useEffect(() => {
    const next = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== "" && value !== "ALL" && value !== 0) {
        next.set(key, String(value));
      }
    });
    if (page !== 1) next.set("page", String(page));
    if (pageSize !== 25) next.set("page_size", String(pageSize));
    if (sortBy !== "timestamp") next.set("sort_by", sortBy);
    if (sortDir !== "desc") next.set("sort_dir", sortDir);
    if (savedView) next.set("saved_view", savedView);
    setSearchParams(next, { replace: true });
  }, [filters, page, pageSize, sortBy, sortDir, savedView, setSearchParams]);

  useEffect(() => {
    try {
      localStorage.setItem("paywatch_pinned_columns", JSON.stringify(pinnedColumns));
      localStorage.setItem("paywatch_hidden_columns", JSON.stringify(hiddenColumns));
      localStorage.setItem("paywatch_column_widths", JSON.stringify(columnWidths));
      localStorage.setItem("paywatch_table_density", densityMode);
    } catch (error) {
      // ignore
    }
  }, [pinnedColumns, hiddenColumns, columnWidths, densityMode]);

  useEffect(() => {
    function syncTableHeight() {
      if (!tableContainerRef.current) return;
      setTableViewportHeight(tableContainerRef.current.clientHeight || 520);
    }
    syncTableHeight();
    window.addEventListener("resize", syncTableHeight);
    return () => window.removeEventListener("resize", syncTableHeight);
  }, []);

  useEffect(() => {
    if (!token) return;
    if (liveTapePaused) return;
    let cancelled = false;
    async function loadWorkspace() {
      setLoading(true);
      try {
        const payload = await getTransactions(token, {
          page,
          page_size: pageSize,
          sort_by: sortBy,
          sort_dir: sortDir,
          saved_view: savedView,
          ...filters
        });
        if (!cancelled) {
          setWorkspace(payload);
          setStatus("");
        }
      } catch (error) {
        if (!cancelled) setStatus(error.message || "Unable to load transactions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [token, page, pageSize, sortBy, sortDir, savedView, filters, liveTapePaused]);

  useEffect(() => {
    const targetId = searchParams.get("open") || searchParams.get("transaction_id");
    if (!targetId || !workspace?.transactions?.length || details?.transaction?.transaction_id === targetId) {
      return;
    }
    const match = workspace.transactions.find((row) => String(row.transaction_id) === String(targetId));
    if (match) {
      openDetails(match);
    }
  }, [details?.transaction?.transaction_id, searchParams, workspace]);

  async function openDetails(row) {
    setSelectedTransaction(row);
    try {
      const payload = await getTransactionDetails(token, row.transaction_id);
      setDetails(payload);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("open", String(row.transaction_id));
      setSearchParams(nextParams, { replace: true });
    } catch (error) {
      setStatus(error.message || "Unable to load transaction details");
    }
  }

  async function refreshWorkspace() {
    const payload = await getTransactions(token, {
      page,
      page_size: pageSize,
      sort_by: sortBy,
      sort_dir: sortDir,
      saved_view: savedView,
      ...filters
    });
    setWorkspace(payload);
  }

  async function handleAnnotate(payload) {
    try {
      await annotateTransactions(token, payload);
      await refreshWorkspace();
      if (details?.transaction?.transaction_id) {
        setDetails(await getTransactionDetails(token, details.transaction.transaction_id));
      }
      pushToast({
        title: "Transaction annotations updated",
        message: payload.bookmarked !== undefined ? "Bookmark state changed for the selected transaction." : "Investigation labels were applied to the selected transaction set.",
        tone: "success",
      });
    } catch (error) {
      setStatus(error.message || "Unable to update transaction annotations");
    }
  }

  async function handleCompare() {
    try {
      setComparison(await compareTransactions(token, selectedIds.slice(0, 2)));
      pushToast({
        title: "Comparison ready",
        message: "Two suspicious transactions are now available side by side.",
        tone: "info",
      });
    } catch (error) {
      setStatus(error.message || "Unable to compare transactions");
    }
  }

  async function handleSaveView() {
    try {
      const payload = await saveTransactionView(token, { action: "save", name: viewName, filters });
      setViewName("");
      setSavedView(payload.view?.id || "");
      await refreshWorkspace();
      setStatus("Saved current transaction view.");
      pushToast({
        title: "Saved view created",
        message: `Transaction workspace view "${payload.view?.name || "custom"}" is now available from saved views.`,
        tone: "success",
      });
    } catch (error) {
      setStatus(error.message || "Unable to save transaction view");
    }
  }

  async function handlePrintCaseReport() {
    if (!details?.transaction?.transaction_id) return;
    try {
      const payload = await getTransactionReport(token, details.transaction.transaction_id, "case");
      const popup = window.open("", "_blank", "width=900,height=700");
      if (popup) {
        popup.document.write(`<pre style="white-space:pre-wrap;font-family:Segoe UI;padding:24px;">${payload.report?.text || "No report"}</pre>`);
        popup.document.close();
        popup.print();
      }
      pushToast({
        title: "Case report ready",
        message: "A printable executive investigation report was generated for the selected transaction.",
        tone: "info",
      });
    } catch (error) {
      setStatus(error.message || "Unable to print case report");
    }
  }

  async function handleBulkAction(action) {
    try {
      await bulkInvestigateTransactions(token, {
        action,
        transaction_ids: selectedIds,
        casebook_id: action === "assign_casebook" ? selectedCasebook : undefined,
      });
      await refreshWorkspace();
      if (details?.transaction?.transaction_id) {
        setDetails(await getTransactionDetails(token, details.transaction.transaction_id));
      }
      pushToast({
        title: "Bulk action completed",
        message: `${action.replace(/_/g, " ")} ran for ${selectedIds.length} transaction(s).`,
        tone: "success",
      });
    } catch (error) {
      setStatus(error.message || "Unable to run transaction bulk action");
    }
  }

  async function handleSaveCasebook() {
    try {
      const payload = await saveCasebook(token, { name: casebookName, transaction_ids: selectedIds });
      setCasebookName("");
      setSelectedCasebook(payload.casebook?.id || payload.id || "");
      await refreshWorkspace();
      pushToast({
        title: "Casebook saved",
        message: "A reusable casebook was created from the selected investigation set.",
        tone: "success",
      });
    } catch (error) {
      setStatus(error.message || "Unable to save casebook");
    }
  }

  const tableColumns = useMemo(() => {
    const columns = workspace?.table_config?.columns || [];
    const ordered = [...columns]
      .filter((column) => !hiddenColumns.includes(column.key))
      .sort((a, b) => Number(!pinnedColumns.includes(a.key)) - Number(!pinnedColumns.includes(b.key)));
    let offset = 0;
    return ordered.map((column) => {
      const width = Number(columnWidths[column.key] || 104);
      const pinned = pinnedColumns.includes(column.key);
      const value = { ...column, width, pinned, left: offset };
      if (pinned) offset += width;
      return value;
    });
  }, [workspace, pinnedColumns, hiddenColumns, columnWidths]);

  const rows = workspace?.transactions || [];
  const rowHeight = densityMode === "compact" ? 38 : densityMode === "dense" ? 34 : 48;
  const overscan = 8;
  const totalRows = rows.length;
  const startIndex = Math.max(Math.floor(tableScrollTop / rowHeight) - overscan, 0);
  const visibleCount = Math.ceil(tableViewportHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(startIndex + visibleCount, totalRows);
  const visibleRows = rows.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * rowHeight;
  const bottomSpacerHeight = Math.max(totalRows - endIndex, 0) * rowHeight;
  const pagination = workspace?.pagination || { page: 1, total_pages: 1, total_items: 0 };
  const replayTimeline = workspace?.replay_timeline || [];
  const [replayIndex, setReplayIndex] = useState(0);
  useEffect(() => setReplayIndex(Math.max(replayTimeline.length - 1, 0)), [replayTimeline.length]);
  const activeReplay = replayTimeline[Math.min(replayIndex, Math.max(replayTimeline.length - 1, 0))];
  const selectedRows = rows.filter((row) => selectedIds.includes(row.transaction_id));
  const transactionTape = rows.slice(0, 8);
  const lensSummary = {
    ensemble: "Blends model, graph, anomaly, velocity, and manual-review signals.",
    graph: "Weights source, destination, device, and merchant paths more heavily.",
    velocity: "Emphasizes repeat actor, repeat merchant, and time-window bursts.",
    loss: "Prioritizes fraud loss and blocked loss exposure.",
  };

  function toggleSelect(id) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function togglePin(key) {
    setPinnedColumns((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  function toggleColumnVisibility(key) {
    setHiddenColumns((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  function sortColumn(key) {
    if (sortBy === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  }

  if (loading && !workspace) {
    return (
      <div className="page-grid transactions-page">
        <section className="panel">
          <SkeletonBlock lines={10} />
        </section>
        <section className="panel">
          <SkeletonBlock lines={8} />
        </section>
      </div>
    );
  }

  return (
    <div className="page-grid transactions-page">
      {status ? <div className="error-banner">{status}</div> : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Transaction Workspace</h3>
            <p>Server-side investigation table with filters, saved views, comparison mode, exports, and replay.</p>
          </div>
          <div className="inline-form">
            <button className="secondary-button" type="button" onClick={() => exportRows(rows, "csv")}>Export CSV</button>
            <button className="secondary-button" type="button" onClick={() => exportRows(rows, "excel")}>Export Excel</button>
          </div>
        </div>
        <div className="filter-builder-grid">
          <label>Filter Logic<select value={filterLogic} onChange={(event) => setFilterLogic(event.target.value)}><option value="AND">AND</option><option value="OR">OR</option></select></label>
          <label>Scoring Lens<select value={scoringLens} onChange={(event) => setScoringLens(event.target.value)}><option value="ensemble">Ensemble</option><option value="graph">Graph Path</option><option value="velocity">Velocity</option><option value="loss">Loss Exposure</option></select></label>
          <label>Date From<input type="date" value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} /></label>
          <label>Date To<input type="date" value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} /></label>
          <label>Amount Min<input value={filters.amount_min} onChange={(event) => setFilters((current) => ({ ...current, amount_min: event.target.value }))} /></label>
          <label>Amount Max<input value={filters.amount_max} onChange={(event) => setFilters((current) => ({ ...current, amount_max: event.target.value }))} /></label>
          <label>Risk<select value={filters.risk_level} onChange={(event) => setFilters((current) => ({ ...current, risk_level: event.target.value }))}>{(workspace?.filters?.options?.risk_levels || ["ALL", "LOW", "MEDIUM", "HIGH"]).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Type<select value={filters.transaction_type} onChange={(event) => setFilters((current) => ({ ...current, transaction_type: event.target.value }))}>{(workspace?.filters?.options?.transaction_types || ["ALL"]).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>User<input value={filters.user} onChange={(event) => setFilters((current) => ({ ...current, user: event.target.value }))} /></label>
          <label>Merchant<input value={filters.merchant} onChange={(event) => setFilters((current) => ({ ...current, merchant: event.target.value }))} /></label>
          <label>Source<input value={filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))} /></label>
          <label>Destination<input value={filters.destination} onChange={(event) => setFilters((current) => ({ ...current, destination: event.target.value }))} /></label>
          <label>Related Mode<select value={filters.related_mode} onChange={(event) => setFilters((current) => ({ ...current, related_mode: event.target.value }))}><option value="">Any</option><option value="shared_destination">Shared destination</option></select></label>
          <label>Min Related<input type="number" min="0" value={filters.minimum_related} onChange={(event) => setFilters((current) => ({ ...current, minimum_related: Number(event.target.value) }))} /></label>
        </div>
        <div className="reason-chip-row">
          {(workspace?.presets || []).map((preset) => <button key={preset.key} className="pill-button" type="button" onClick={() => { setSavedView(preset.key); setPage(1); }}>{preset.name}</button>)}
        </div>
        <div className="inline-form">
          <select value={savedView} onChange={(event) => setSavedView(event.target.value)}>
            <option value="">All views</option>
            {(workspace?.saved_views || []).map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
          </select>
          <input value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="Save current view as..." />
          <button className="secondary-button" type="button" onClick={handleSaveView} disabled={!viewName.trim()}>Save View</button>
          <button className="secondary-button" type="button" onClick={handleCompare} disabled={selectedIds.length < 2}>Compare Selected</button>
        </div>
        <div className="inline-form">
          <select value={selectedCasebook} onChange={(event) => setSelectedCasebook(event.target.value)}>
            <option value="">Choose casebook</option>
            {(workspace?.casebooks || []).map((casebook) => <option key={casebook.id} value={casebook.id}>{casebook.name}</option>)}
          </select>
          <input value={casebookName} onChange={(event) => setCasebookName(event.target.value)} placeholder="Create casebook..." />
          <button className="secondary-button" type="button" onClick={handleSaveCasebook} disabled={!casebookName.trim() || !selectedIds.length}>Save Casebook</button>
          <button className="secondary-button" type="button" onClick={() => handleBulkAction("assign_casebook")} disabled={!selectedIds.length || !selectedCasebook}>Add To Casebook</button>
          <button className="secondary-button" type="button" onClick={() => handleBulkAction("bookmark")} disabled={!selectedIds.length}>Bookmark Selected</button>
          <button className="secondary-button" type="button" onClick={() => handleBulkAction("tag_high_priority")} disabled={!selectedIds.length}>Tag High Priority</button>
        </div>
      </section>

      <section className="content-grid analytics-grid-wide">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Live Transaction Tape</h3>
              <p>{liveTapePaused ? "Stream paused for review" : "Newest scored events are flowing into the investigation tape."}</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setLiveTapePaused((current) => !current)}>
              {liveTapePaused ? "Resume Stream" : "Pause Stream"}
            </button>
          </div>
          <div className="transaction-tape-grid">
            {transactionTape.map((row) => (
              <button key={row.transaction_id} className="workspace-card workspace-card-button" type="button" onClick={() => openDetails(row)}>
                <strong>{row.transaction_id || row.type}</strong>
                <p>{formatCurrency(row.amount)} / {row.merchant || row.destination_account || "unknown counterparty"}</p>
                <span>{row.risk_level || "n/a"} / {formatRelative(row.timestamp)}</span>
              </button>
            ))}
            {!transactionTape.length ? <div className="empty-state compact-empty">No live transactions in the current view.</div> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Selected Compare Tray</h3>
              <p>{selectedIds.length} selected for diff, batch review, bookmark, tag, alert escalation, or casebook export.</p>
            </div>
          </div>
          <div className="details-grid">
            <div><dt>Risk Lens</dt><dd>{scoringLens}</dd></div>
            <div><dt>Filter Mode</dt><dd>{filterLogic}</dd></div>
            <div><dt>Selected Value</dt><dd>{formatCurrency(selectedRows.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</dd></div>
            <div><dt>Manual Review</dt><dd>{selectedRows.some((row) => Number(row.fraud_probability || 0) >= 0.7) ? "Recommended" : "Optional"}</dd></div>
          </div>
          <p className="smart-summary-text">{lensSummary[scoringLens]}</p>
          <div className="quick-actions-grid">
            <button className="secondary-button" type="button" onClick={() => handleBulkAction("bookmark")} disabled={!selectedIds.length}>Bookmark</button>
            <button className="secondary-button" type="button" onClick={() => handleBulkAction("tag_high_priority")} disabled={!selectedIds.length}>Bulk Tag</button>
            <button className="secondary-button" type="button" onClick={() => handleBulkAction("escalate_to_alert")} disabled={!selectedIds.length}>Escalate To Alert</button>
            <button className="secondary-button" type="button" onClick={() => exportRows(selectedRows, "csv")} disabled={!selectedRows.length}>Casebook Export</button>
          </div>
        </div>
      </section>

      <section className="content-grid transactions-layout">
        <div className="panel">
          <div className="panel-header">
            <div><h3>Advanced Data Table</h3><p>{pagination.total_items || 0} items · page {pagination.page || 1} of {pagination.total_pages || 1}</p></div>
            <label>Page Size<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
          </div>
          <div className="column-config-grid">
            {tableColumns.map((column) => (
              <div key={column.key} className="column-config-card">
                <div className="toggle-row"><span>{column.label}</span><button className="ghost-button" type="button" onClick={() => togglePin(column.key)}>{column.pinned ? "Unpin" : "Pin"}</button></div>
                <input type="range" min="64" max="180" step="8" value={columnWidths[column.key] || 104} onChange={(event) => setColumnWidths((current) => ({ ...current, [column.key]: Number(event.target.value) }))} />
              </div>
            ))}
          </div>
          <div className="inline-form table-display-controls">
            <select value={densityMode} onChange={(event) => setDensityMode(event.target.value)}>
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
            <button className="secondary-button" type="button" onClick={() => {
              setHiddenColumns(compactDefaultHiddenColumns);
              setPinnedColumns(["bookmarked"]);
              setColumnWidths(compactDefaultColumnWidths);
              setDensityMode("compact");
            }}>
              Fit Screen
            </button>
            {(workspace?.table_config?.columns || []).map((column) => (
              <button key={column.key} className={hiddenColumns.includes(column.key) ? "pill-button" : "pill-button active"} type="button" onClick={() => toggleColumnVisibility(column.key)}>
                {column.label}
              </button>
            ))}
          </div>
          <div
            className="table-wrap transaction-table-wrap"
            ref={tableContainerRef}
            onScroll={(event) => setTableScrollTop(event.currentTarget.scrollTop)}
          >
            <table className={`data-table density-${densityMode}`}>
              <thead>
                <tr>
                  <th style={{ width: 52 }}>Pick</th>
                  {tableColumns.map((column) => (
                    <th key={column.key} className={column.pinned ? "sticky-column" : ""} style={column.pinned ? { left: `${column.left}px`, minWidth: `${column.width}px`, width: `${column.width}px` } : { minWidth: `${column.width}px`, width: `${column.width}px` }}>
                      <button className="table-sort-button" type="button" onClick={() => sortColumn(column.key)}>{column.label}{sortBy === column.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
                    </th>
                  ))}
                  <th style={{ minWidth: "96px", width: "96px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {topSpacerHeight > 0 ? (
                  <tr className="virtual-spacer">
                    <td colSpan={tableColumns.length + 2} style={{ height: `${topSpacerHeight}px` }} />
                  </tr>
                ) : null}
                {visibleRows.map((row) => (
                  <tr key={row.transaction_id}>
                    <td><input type="checkbox" checked={selectedIds.includes(row.transaction_id)} onChange={() => toggleSelect(row.transaction_id)} /></td>
                    {tableColumns.map((column) => (
                      <td key={`${row.transaction_id}-${column.key}`} className={column.pinned ? "sticky-column sticky-cell" : ""} style={column.pinned ? { left: `${column.left}px`, minWidth: `${column.width}px`, width: `${column.width}px` } : { minWidth: `${column.width}px`, width: `${column.width}px` }}>
                        {column.key === "bookmarked" ? <button className="ghost-button" type="button" onClick={() => handleAnnotate({ transaction_ids: [row.transaction_id], bookmarked: !row.bookmarked })}>{row.bookmarked ? "★" : "☆"}</button> : null}
                        {column.key === "amount" ? formatCurrency(row.amount) : null}
                        {column.key === "fraud_probability" ? formatPercent(row.fraud_probability) : null}
                        {column.key === "anomaly_risk" ? formatPercent(row.anomaly_risk) : null}
                        {column.key === "graph_score" ? formatPercent(row.graph_score) : null}
                        {column.key === "risk_level" ? <RiskBadge risk={row.risk_level} /> : null}
                        {column.key === "timestamp" ? <div><strong>{String(row.timestamp || "").replace("T", " ").slice(0, 19)}</strong><div className="muted-copy">{formatRelative(row.timestamp)}</div></div> : null}
                        {!["bookmarked", "amount", "fraud_probability", "anomaly_risk", "graph_score", "risk_level", "timestamp"].includes(column.key) ? String(row[column.key] ?? "n/a") : null}
                      </td>
                    ))}
                    <td><div className="table-row-actions"><button className="secondary-button" type="button" onClick={() => openDetails(row)}>View</button><button className="ghost-button" type="button" onClick={() => handleAnnotate({ transaction_ids: [row.transaction_id], tags: [...new Set([...(row.tags || []), "investigate"])] })}>Tag</button></div></td>
                  </tr>
                ))}
                {bottomSpacerHeight > 0 ? (
                  <tr className="virtual-spacer">
                    <td colSpan={tableColumns.length + 2} style={{ height: `${bottomSpacerHeight}px` }} />
                  </tr>
                ) : null}
                {!rows.length ? (
                  <tr>
                    <td colSpan={tableColumns.length + 2}>
                      <EmptyState
                        title={loading ? "Loading transactions" : "No transactions match the current filters"}
                        description={loading ? "The investigation workspace is preparing the current page." : "Try broadening the date range, lowering the related threshold, or switching to a saved preset such as High-Risk Transfers."}
                      />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="panel-header transaction-pagination">
            <button className="secondary-button" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Previous</button>
            <span>Page {pagination.page || 1} / {pagination.total_pages || 1}</span>
            <button className="secondary-button" type="button" onClick={() => setPage((current) => Math.min(pagination.total_pages || current, current + 1))} disabled={page >= (pagination.total_pages || 1)}>Next</button>
          </div>
        </div>

        <div className="transactions-side-column">
          <div className="panel">
            <div className="panel-header"><div><h3>Replay Timeline</h3><p>Step through the filtered event order.</p></div></div>
            {replayTimeline.length ? <div className="replay-panel"><input type="range" min="0" max={Math.max(replayTimeline.length - 1, 0)} value={replayIndex} onChange={(event) => setReplayIndex(Number(event.target.value))} /><article className="replay-card"><strong>{activeReplay?.title}</strong><p>{activeReplay?.summary}</p><span>{activeReplay?.timestamp}</span></article></div> : <div className="empty-state">Replay will appear when the filtered set has more than one event.</div>}
          </div>
          {comparison?.transactions?.length ? <div className="panel"><div className="panel-header"><div><h3>Comparison Mode</h3><p>Side-by-side suspicious transaction analysis.</p></div></div><div className="comparison-grid comparison-grid-two">{comparison.transactions.map((row) => <article key={row.transaction_id} className="comparison-card"><strong>{row.type}</strong><p>{String(row.timestamp || "").replace("T", " ").slice(0, 19)}</p><div className="distribution-list"><div className="distribution-row"><span>Amount</span><strong>{formatCurrency(row.amount)}</strong></div><div className="distribution-row"><span>Risk</span><strong>{row.risk_level}</strong></div><div className="distribution-row"><span>Score</span><strong>{formatPercent(row.fraud_probability)}</strong></div><div className="distribution-row"><span>Anomaly</span><strong>{formatPercent(row.anomaly_risk)}</strong></div></div></article>)}</div></div> : null}
          <div className="panel transaction-detail-panel"><div className="panel-header"><div><h3>Expanded Row Preview</h3><p>Explanation, graph context, related alerts, and investigation workflows.</p></div></div><TransactionPreviewPanel details={details} onAnnotate={handleAnnotate} onPrint={handlePrintCaseReport} /></div>
        </div>
      </section>
    </div>
  );
}
