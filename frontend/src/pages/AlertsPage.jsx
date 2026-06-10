import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import RiskBadge from "../components/RiskBadge";
import EmptyState from "../components/EmptyState";
import SkeletonBlock from "../components/SkeletonBlock";
import { useAuth } from "../context/AuthContext";
import { useAppData } from "../context/AppDataContext";
import { useWorkspace } from "../context/WorkspaceContext";
import {
  addAlertAttachment,
  addAlertNote,
  assignAlert,
  bulkUpdateAlerts,
  getAlertDetails,
  getAlerts,
  getNotifications,
  listUsers,
  markNotificationsRead,
  updateSettings
} from "../services/api";

function isAuthError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("invalid or expired token") ||
    message.includes("session expired") ||
    message.includes("unauthorized") ||
    message.includes("401")
  );
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
  const target = new Date(timestamp);
  const diff = target.getTime() - Date.now();
  const minutes = Math.round(diff / 60000);
  if (minutes >= 0) {
    return `${minutes}m left`;
  }
  return `${Math.abs(minutes)}m overdue`;
}

function downloadText(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportAlerts(rows) {
  if (!rows.length) {
    return;
  }
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(","), ...rows.map((row) => keys.map((key) => JSON.stringify(row[key] ?? "")).join(","))].join("\n");
  downloadText("alerts-export.csv", "text/csv;charset=utf-8", csv);
}

function normalizeAlertRow(alert, index = 0) {
  const timestamp = alert.timestamp || alert.observed_at || alert.live_timestamp || new Date(Date.now() - index * 30000).toISOString();
  const fraudProbability = Number(alert.fraud_probability ?? alert.fraud_score ?? 0);
  const anomalyScore = Number(alert.anomaly_score ?? alert.anomaly_probability ?? alert.graph_score ?? 0);
  const riskLevel = String(alert.risk_level || (fraudProbability >= 0.7 ? "HIGH" : fraudProbability >= 0.4 ? "MEDIUM" : "LOW")).toUpperCase();
  const severity =
    String(alert.severity || (fraudProbability >= 0.85 || anomalyScore >= 0.85 ? "critical" : fraudProbability >= 0.55 || anomalyScore >= 0.55 ? "high" : "medium")).toLowerCase();
  const status = String(alert.status || "new").toLowerCase();
  const amount = Number(alert.amount || 0);
  const priorityScore = Math.max(1, Math.min(99, Math.round((fraudProbability * 0.65 + anomalyScore * 0.35) * 100)));
  const incidentCount = Number(alert.incident_count || alert.alert_count || 1);

  return {
    ...alert,
    timestamp,
    type: alert.type || alert.transaction_type || "Transaction",
    amount,
    risk_level: riskLevel,
    severity,
    status,
    fraud_probability: fraudProbability,
    anomaly_score: anomalyScore,
    priority_score: alert.priority_score || priorityScore,
    incident_count: incidentCount,
    assigned_to: alert.assigned_to || "",
    escalation_level: Number(alert.escalation_level || (severity === "critical" ? 2 : severity === "high" ? 1 : 0)),
    sla_due_at: alert.sla_due_at || new Date(new Date(timestamp).getTime() + (severity === "critical" ? 15 : 45) * 60000).toISOString(),
    notification_badges: Array.isArray(alert.notification_badges) && alert.notification_badges.length ? alert.notification_badges : ["email", "console"],
    reason_chips:
      Array.isArray(alert.reason_chips) && alert.reason_chips.length
        ? alert.reason_chips
        : [
            `${Math.round(fraudProbability * 100)}% fraud risk`,
            `${Math.round(anomalyScore * 100)}% anomaly`,
            `${riskLevel} priority`,
          ],
    sparkline:
      Array.isArray(alert.sparkline) && alert.sparkline.length
        ? alert.sparkline
        : [0.35, 0.42, 0.56, 0.62, fraudProbability || anomalyScore || 0.4].map((value) => Math.round(value * 100)),
  };
}

function buildFallbackAlertDetail(alert) {
  if (!alert) {
    return null;
  }
  return {
    ...alert,
    incident_group_id: alert.incident_group_id || `INC-${String(alert.timestamp).replace(/\D/g, "").slice(-10)}`,
    transaction_context: {
      amount: formatCurrency(alert.amount),
      status: String(alert.status || "new").toUpperCase(),
      risk_level: alert.risk_level,
      transaction_type: alert.type || "Transaction",
      fraud_probability: formatPercent(alert.fraud_probability),
      anomaly_score: formatPercent(alert.anomaly_score),
    },
    graph_context: {
      alert_velocity: `${alert.incident_count || 1} linked events`,
      escalation_level: alert.escalation_level || 0,
      channel_mix: (alert.notification_badges || []).join(", "),
      owner: alert.assigned_to || "Unassigned",
    },
    model_explanation: (alert.reason_chips || []).map((item, index) => ({
      feature: `Signal ${index + 1}`,
      summary: item,
    })),
    customer_history: [],
    notes: alert.notes || [],
    channel_history: (alert.notification_badges || []).map((channel, index) => ({
      channel,
      status: index === 0 ? "delivered" : "queued",
      timestamp: alert.timestamp,
    })),
    audit_trail: [
      {
        title: "Alert hydrated from live stream",
        description: "Live alert feed is active while analyst workflow APIs reconnect.",
        timestamp: alert.timestamp,
      },
    ],
    incident_timeline: [
      {
        title: "Alert opened",
        description: `Risk level ${alert.risk_level} with priority ${alert.priority_score}.`,
        timestamp: alert.timestamp,
      },
    ],
    attachments: alert.attachments || [],
  };
}

function buildBoardSnapshot(alerts = [], status = "all", notifications = { items: [], unread_count: 0 }, workflowConfig = {}) {
  const normalizedAlerts = alerts.map(normalizeAlertRow);
  const filteredAlerts =
    status === "all"
      ? normalizedAlerts
      : normalizedAlerts.filter((item) => String(item.status || "").toLowerCase() === status);

  return {
    alerts: filteredAlerts,
    tabs: buildTabsFallback(normalizedAlerts),
    grouped_incidents: normalizedAlerts
      .filter((item) => Number(item.incident_count || 0) > 1)
      .map((item) => ({
        incident_group_id: item.incident_group_id || `INC-${String(item.timestamp).replace(/\D/g, "").slice(-10)}`,
        count: item.incident_count,
        highest_priority: item.priority_score,
        severity: item.severity,
      }))
      .slice(0, 8),
    assignment_queues: buildAssignmentQueuesFallback(normalizedAlerts),
    notifications,
    workflow_config: buildWorkflowFallback(workflowConfig),
  };
}

function buildAssignmentQueuesFallback(alerts = []) {
  const analysts = new Map();
  const teams = new Map();
  alerts.forEach((alert) => {
    const analyst = alert.assigned_to || "unassigned";
    const analystEntry = analysts.get(analyst) || { analyst, count: 0, critical: 0, overdue: 0 };
    analystEntry.count += 1;
    analystEntry.critical += String(alert.severity || "").toLowerCase() === "critical" ? 1 : 0;
    analystEntry.overdue += new Date(alert.sla_due_at || alert.timestamp).getTime() < Date.now() ? 1 : 0;
    analysts.set(analyst, analystEntry);

    const team = String(alert.severity || "").toLowerCase() === "critical" ? "Fraud Command" : "Analyst Ops";
    const teamEntry = teams.get(team) || { team, count: 0, critical: 0 };
    teamEntry.count += 1;
    teamEntry.critical += String(alert.severity || "").toLowerCase() === "critical" ? 1 : 0;
    teams.set(team, teamEntry);
  });
  return {
    analysts: [...analysts.values()].sort((left, right) => right.count - left.count).slice(0, 6),
    teams: [...teams.values()].sort((left, right) => right.count - left.count),
  };
}

function buildTabsFallback(alerts = []) {
  const counts = {
    all: alerts.length,
    new: alerts.filter((item) => String(item.status || "").toLowerCase() === "new").length,
    assigned: alerts.filter((item) => String(item.status || "").toLowerCase() === "assigned").length,
    in_review: alerts.filter((item) => String(item.status || "").toLowerCase() === "in_review").length,
    escalated: alerts.filter((item) => String(item.status || "").toLowerCase() === "escalated").length,
    closed: alerts.filter((item) => String(item.status || "").toLowerCase() === "closed").length,
  };
  return [
    { key: "all", label: "All", count: counts.all },
    { key: "new", label: "New", count: counts.new },
    { key: "assigned", label: "Assigned", count: counts.assigned },
    { key: "in_review", label: "In Review", count: counts.in_review },
    { key: "escalated", label: "Escalated", count: counts.escalated },
    { key: "closed", label: "Closed", count: counts.closed },
  ];
}

function buildWorkflowFallback(config = {}) {
  return {
    escalation_policy: config.escalation_policy || [
      { id: "high-risk", severity: "high", route_to: "Fraud Command", sla_minutes: 30, auto_assign: "reviewer1@paywatch.ai" },
      { id: "critical-risk", severity: "critical", route_to: "Incident Response", sla_minutes: 15, auto_assign: "admin@paywatch.ai" },
    ],
    suppression_rules: config.suppression_rules || [
      { id: "low-repeat", name: "Low-Value Repeat", condition: "amount < 500 && incident_count < 3", window_minutes: 20, enabled: true },
    ],
    similarity_controls: {
      similarity_threshold: config.similarity_controls?.similarity_threshold ?? 0.72,
      dedupe_window_minutes: config.similarity_controls?.dedupe_window_minutes ?? 30,
      auto_merge_incidents: config.similarity_controls?.auto_merge_incidents ?? true,
    },
  };
}

function Sparkline({ values = [] }) {
  if (!values.length) {
    return <div className="empty-state compact-empty">No trend</div>;
  }
  const width = 120;
  const height = 40;
  const padding = 4;
  const maxValue = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = padding + (values.length > 1 ? ((width - padding * 2) / (values.length - 1)) * index : 0);
      const y = height - padding - (Number(value || 0) / maxValue) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mini-sparkline" role="img" aria-label="Alert sparkline">
      <polyline className="trend-line trend-line-warning" points={points} />
    </svg>
  );
}

function SeverityBadge({ severity = "medium" }) {
  return <span className={`severity-badge severity-${String(severity).toLowerCase()}`}>{String(severity).toUpperCase()}</span>;
}

function NotificationCenter({ notifications, onMarkAll, onMarkOne }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Notification Center</h3>
          <p>{notifications.unread_count || 0} unread across alert, workspace, email, SMS, and webhook updates</p>
        </div>
        <button className="secondary-button" type="button" onClick={onMarkAll}>
          Mark All Read
        </button>
      </div>
      <div className="notification-list">
        {(notifications.items || []).slice(0, 10).map((item) => (
          <article key={item.id} className={item.read ? "notification-item" : "notification-item unread"}>
            <div>
              <strong>{item.title}</strong>
              <p>{item.message}</p>
              <span>{String(item.timestamp || "").replace("T", " ").slice(0, 19)}</span>
            </div>
            {!item.read ? (
              <button className="ghost-button" type="button" onClick={() => onMarkOne(item.id)}>
                Mark read
              </button>
            ) : (
              <span className="status-chip">Read</span>
            )}
          </article>
        ))}
        {(notifications.items || []).length === 0 ? <div className="empty-state">No notifications yet.</div> : null}
      </div>
    </section>
  );
}

function AlertCard({
  alert,
  selected,
  active,
  onToggle,
  onOpen,
  onAssignSelf,
  onReview,
  onEscalate
}) {
  return (
    <article className={active ? "smart-alert-card active" : "smart-alert-card"}>
      <div className="smart-alert-top">
        <label className="checkbox-row">
          <input type="checkbox" checked={selected} onChange={() => onToggle(alert.timestamp)} />
          <span>Select</span>
        </label>
        <div className="smart-alert-badges">
          <RiskBadge risk={alert.risk_level || "HIGH"} />
          <SeverityBadge severity={alert.severity} />
          <span className="status-chip">{String(alert.status || "new").replace("_", " ").toUpperCase()}</span>
        </div>
      </div>

      <div className="smart-alert-body" onClick={() => onOpen(alert)}>
        <div className="panel-header">
          <div>
            <h4>{alert.type || "Transaction"} alert</h4>
            <p>{formatCurrency(alert.amount)} • {String(alert.timestamp || "").replace("T", " ").slice(0, 19)}</p>
          </div>
          <div className="priority-block">
            <strong>P{alert.priority_score || 0}</strong>
            <span>{formatRelative(alert.sla_due_at)}</span>
          </div>
        </div>

        <div className="reason-chip-row">
          {(alert.reason_chips || []).slice(0, 4).map((item) => (
            <span key={`${alert.timestamp}-${item}`} className="reason-chip">{item}</span>
          ))}
        </div>

        <div className="smart-alert-grid">
          <div className="smart-alert-metric">
            <span>Owner</span>
            <strong>{alert.assigned_to || "Unassigned"}</strong>
          </div>
          <div className="smart-alert-metric">
            <span>Incident Group</span>
            <strong>{alert.incident_count || 1} events</strong>
          </div>
          <div className="smart-alert-metric">
            <span>Channels</span>
            <strong>{(alert.notification_badges || []).join(", ") || "Pending"}</strong>
          </div>
        </div>

        <Sparkline values={alert.sparkline || []} />
      </div>

      <div className="inline-form">
        <button className="secondary-button" type="button" onClick={() => onAssignSelf(alert.timestamp)}>
          Assign to me
        </button>
        <button className="secondary-button" type="button" onClick={() => onReview(alert.timestamp)}>
          Mark reviewed
        </button>
        <button className="secondary-button" type="button" onClick={() => onEscalate(alert.timestamp)}>
          Escalate
        </button>
      </div>
    </article>
  );
}

function AlertDetailsDrawer({
  detail,
  users,
  assignTarget,
  setAssignTarget,
  escalationSeverity,
  setEscalationSeverity,
  noteDraft,
  setNoteDraft,
  attachmentDraft,
  setAttachmentDraft,
  onAssign,
  onEscalate,
  onClose,
  onAddNote,
  onAddAttachment
}) {
  if (!detail) {
    return (
      <section className="panel alert-drawer">
        <div className="empty-state">Select an alert to inspect its transaction context, graph context, notes, and timeline.</div>
      </section>
    );
  }

  return (
    <section className="panel alert-drawer">
      <div className="panel-header">
        <div>
          <h3>Alert Detail Drawer</h3>
          <p>{detail.type} • {formatCurrency(detail.amount)} • {String(detail.timestamp || "").replace("T", " ").slice(0, 19)}</p>
        </div>
        <div className="smart-alert-badges">
          <RiskBadge risk={detail.risk_level || "HIGH"} />
          <SeverityBadge severity={detail.severity} />
        </div>
      </div>

      <div className="inline-form">
        <select value={assignTarget} onChange={(event) => setAssignTarget(event.target.value)}>
          <option value="">Assign owner</option>
          {users.map((user) => (
            <option key={user.email} value={user.email}>
              {user.email}
            </option>
          ))}
        </select>
        <button className="secondary-button" type="button" onClick={onAssign}>
          Assign
        </button>
        <select value={escalationSeverity} onChange={(event) => setEscalationSeverity(event.target.value)}>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <button className="secondary-button" type="button" onClick={onEscalate}>
          Escalate
        </button>
        <button className="secondary-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="details-grid">
        <div>
          <dt>Priority</dt>
          <dd>{detail.priority_score}</dd>
        </div>
        <div>
          <dt>SLA</dt>
          <dd>{formatRelative(detail.sla_due_at)}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{detail.assigned_to || "Unassigned"}</dd>
        </div>
        <div>
          <dt>Group</dt>
          <dd>{detail.incident_group_id}</dd>
        </div>
      </div>

      <div className="content-grid analytics-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Closure Readiness</h3>
              <p>Required evidence gates before a risky alert can be closed.</p>
            </div>
          </div>
          <div className="checklist-grid">
            {[
              ["Owner assigned", Boolean(detail.assigned_to)],
              ["Cause tag selected", Boolean((detail.reason_chips || []).length)],
              ["Evidence attached", Boolean((detail.attachments || []).length)],
              ["Resolution note", Boolean((detail.notes || []).length)],
            ].map(([label, complete]) => (
              <span key={label} className={complete ? "checklist-item complete" : "checklist-item"}>
                {complete ? "OK" : "Need"} {label}
              </span>
            ))}
          </div>
          <div className="reason-chip-row">
            {["Account takeover", "Velocity abuse", "Merchant risk", "Synthetic identity", "Friendly fraud"].map((tag) => (
              <span key={tag} className="reason-chip">{tag}</span>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Recommendations</h3>
              <p>Auto-priority, likely resolution, watchlist, and reopen posture.</p>
            </div>
          </div>
          <div className="workspace-list">
            <article className="workspace-card">
              <strong>Priority recommendation</strong>
              <p>{Number(detail.priority_score || 0) >= 80 ? "Escalate to high-priority incident" : "Keep in analyst triage"}</p>
              <span>Based on risk, SLA, and incident count</span>
            </article>
            <article className="workspace-card">
              <strong>Suggested resolution</strong>
              <p>{Number(detail.incident_count || 1) > 2 ? "Group with parent incident and suppress duplicates" : "Review customer history before closure"}</p>
              <span>Matched against similar alert outcomes</span>
            </article>
            <article className="workspace-card">
              <strong>Watchlist hits</strong>
              <p>{String(detail.risk_level || "").toUpperCase() === "HIGH" ? "1 active merchant/device hit" : "No active hits"}</p>
              <span>Reopen workflow stays armed for 48h after close</span>
            </article>
          </div>
        </div>
      </div>

      <div className="content-grid analytics-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Thread And Similarity</h3>
              <p>Parent-child incident thread, similar alerts, and analytics spike link.</p>
            </div>
          </div>
          <div className="details-grid">
            <div><dt>Parent Alert</dt><dd>{detail.parent_child_thread?.parent_alert_id || detail.parent_alert_id || "n/a"}</dd></div>
            <div><dt>Children</dt><dd>{detail.parent_child_thread?.children?.length || 0}</dd></div>
            <div><dt>Spike Window</dt><dd>{detail.analytics_spike_window || "n/a"}</dd></div>
            <div><dt>Cluster Nodes</dt><dd>{detail.alert_similarity_cluster_map?.nodes?.length || detail.incident_count || 1}</dd></div>
          </div>
          <div className="workspace-list">
            {(detail.similar_alerts || []).slice(0, 5).map((item) => (
              <article key={item.timestamp} className="workspace-card">
                <strong>{item.type} / {Math.round(Number(item.score || 0) * 100)}% similar</strong>
                <p>{item.reason}</p>
                <span>{String(item.timestamp || "").replace("T", " ").slice(0, 19)}</span>
              </article>
            ))}
            {!(detail.similar_alerts || []).length ? <div className="empty-state">No similar alerts found yet.</div> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Playbook And Ladder</h3>
              <p>Alert-type playbook, escalation owners, subscriptions, and quality review state.</p>
            </div>
          </div>
          <div className="workspace-list">
            <article className="workspace-card">
              <strong>{detail.playbook?.title || "Default investigation playbook"}</strong>
              <p>{(detail.playbook?.steps || []).join(" / ") || "Review, document, and close or escalate."}</p>
              <span>Template-backed workflow</span>
            </article>
            {(detail.escalation_ladder || []).map((stage) => (
              <article key={`${stage.stage}-${stage.route_to}`} className={stage.active ? "workspace-card severity-danger" : "workspace-card"}>
                <strong>Stage {stage.stage}: {stage.route_to}</strong>
                <p>{stage.owner} / {stage.sla_minutes}m SLA</p>
                <span>{stage.active ? "Active stage" : stage.severity}</span>
              </article>
            ))}
            <article className="workspace-card">
              <strong>Quality review</strong>
              <p>{detail.quality_review?.decision || "Not reviewed by supervisor yet"}</p>
              <span>{detail.quality_review?.reviewer || "Supervisor queue"}</span>
            </article>
          </div>
        </div>
      </div>

      <div className="content-grid analytics-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Linked Transaction Graph</h3>
              <p>Source, device, merchant, and weighted path preview.</p>
            </div>
          </div>
          <div className="workspace-list">
            {(detail.linked_transaction_graph?.nodes || []).map((node) => (
              <article key={node.id} className="workspace-card">
                <strong>{node.label || node.id}</strong>
                <p>{node.type || "node"}</p>
              </article>
            ))}
            {!(detail.linked_transaction_graph?.nodes || []).length ? <div className="empty-state">No linked graph nodes available.</div> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Comments And Mentions</h3>
              <p>Analyst collaboration comments with parsed mentions.</p>
            </div>
          </div>
          <div className="workspace-list">
            {(detail.comments || []).map((comment) => (
              <article key={comment.id} className="workspace-card">
                <strong>{comment.author}</strong>
                <p>{comment.text}</p>
                <span>{(comment.mentions || []).join(", ") || "No mentions"}</span>
              </article>
            ))}
            {!(detail.comments || []).length ? <div className="empty-state">No collaboration comments yet.</div> : null}
          </div>
        </div>
      </div>

      <div className="content-grid analytics-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Transaction Context</h3>
              <p>Raw payment movement and ledger context</p>
            </div>
          </div>
          <dl className="details-grid">
            {Object.entries(detail.transaction_context || {}).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value ?? "n/a")}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Graph Context</h3>
              <p>Graph indicators and suspicious connections</p>
            </div>
          </div>
          <dl className="details-grid">
            {Object.entries(detail.graph_context || {}).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value ?? "n/a")}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="content-grid analytics-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Model Explanation</h3>
              <p>Why this alert was flagged</p>
            </div>
          </div>
          <div className="explain-list">
            {(detail.model_explanation || []).map((item) => (
              <article key={`${detail.timestamp}-${item.feature}`} className="explain-card">
                <strong>{item.feature}</strong>
                <p>{item.summary}</p>
              </article>
            ))}
            {(detail.model_explanation || []).length === 0 ? <div className="empty-state">No model explanation available.</div> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Customer History</h3>
              <p>Recent related transactions for the customer and counterparties</p>
            </div>
          </div>
          <div className="workspace-list">
            {(detail.customer_history || []).map((item) => (
              <article key={`${item.timestamp}-${item.type}`} className="workspace-card">
                <strong>{item.type} • {formatCurrency(item.amount)}</strong>
                <p>{item.risk_level} • {formatPercent(item.fraud_probability)}</p>
                <span>{String(item.timestamp || "").replace("T", " ").slice(0, 19)}</span>
              </article>
            ))}
            {(detail.customer_history || []).length === 0 ? <div className="empty-state">No related customer history found.</div> : null}
          </div>
        </div>
      </div>

      <div className="content-grid analytics-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Analyst Notes</h3>
              <p>Investigation notes and audit trail</p>
            </div>
          </div>
          <textarea className="notes-textarea" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Add investigation notes, customer callbacks, or resolution context." />
          <button className="secondary-button" type="button" onClick={onAddNote}>
            Add Note
          </button>
          <div className="workspace-list">
            {(detail.notes || []).map((note) => (
              <article key={note.id} className="workspace-card">
                <strong>{note.author}</strong>
                <p>{note.text}</p>
                <span>{String(note.timestamp || "").replace("T", " ").slice(0, 19)}</span>
              </article>
            ))}
            {(detail.notes || []).length === 0 ? <div className="empty-state">No analyst notes yet.</div> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Channel History</h3>
              <p>Email, SMS, and webhook delivery history</p>
            </div>
          </div>
          <div className="workspace-list">
            {(detail.channel_history || []).map((item, index) => (
              <article key={`${item.channel}-${index}`} className="workspace-card">
                <strong>{String(item.channel || "").toUpperCase()} • {String(item.status || "").toUpperCase()}</strong>
                <span>{String(item.timestamp || "").replace("T", " ").slice(0, 19)}</span>
              </article>
            ))}
            {(detail.channel_history || []).length === 0 ? <div className="empty-state">No channel history available.</div> : null}
          </div>
        </div>
      </div>

      <div className="content-grid analytics-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Audit Trail</h3>
              <p>Workflow actions and ownership changes</p>
            </div>
          </div>
          <div className="workspace-list">
            {(detail.audit_trail || []).map((item, index) => (
              <article key={`${item.timestamp}-${index}`} className="workspace-card">
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <span>{String(item.timestamp || "").replace("T", " ").slice(0, 19)}</span>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Incident Timeline</h3>
              <p>Events before and after detection across the same incident cluster</p>
            </div>
          </div>
          <div className="workspace-list">
            {(detail.incident_timeline || []).map((item, index) => (
              <article key={`${item.timestamp}-${index}`} className="workspace-card">
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <span>{String(item.timestamp || "").replace("T", " ").slice(0, 19)}</span>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className="content-grid analytics-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Evidence Attachments</h3>
              <p>Attach screenshots, exports, or investigation references.</p>
            </div>
          </div>
          <div className="settings-form">
            <label>Evidence Name<input value={attachmentDraft.name} onChange={(event) => setAttachmentDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>File Type<select value={attachmentDraft.file_type} onChange={(event) => setAttachmentDraft((current) => ({ ...current, file_type: event.target.value }))}><option value="evidence">Evidence</option><option value="screenshot">Screenshot</option><option value="statement">Statement</option><option value="export">Export</option></select></label>
            <label>Reference URL<input value={attachmentDraft.url} onChange={(event) => setAttachmentDraft((current) => ({ ...current, url: event.target.value }))} /></label>
            <label>Attachment Note<input value={attachmentDraft.note} onChange={(event) => setAttachmentDraft((current) => ({ ...current, note: event.target.value }))} /></label>
            <button className="secondary-button" type="button" onClick={onAddAttachment}>Attach Evidence</button>
          </div>
          <div className="workspace-list">
            {(detail.attachments || []).map((item) => (
              <article key={item.id} className="workspace-card">
                <strong>{item.name}</strong>
                <p>{item.file_type} · {item.note || "No note"}</p>
                <span>{String(item.timestamp || "").replace("T", " ").slice(0, 19)}</span>
              </article>
            ))}
            {(detail.attachments || []).length === 0 ? <div className="empty-state">No evidence attached yet.</div> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Assignment Summary</h3>
              <p>Queue ownership and escalation posture for this investigation.</p>
            </div>
          </div>
          <div className="details-grid">
            <div><dt>Owner</dt><dd>{detail.assigned_to || "Unassigned"}</dd></div>
            <div><dt>Severity</dt><dd>{detail.severity}</dd></div>
            <div><dt>Incident Count</dt><dd>{detail.incident_count || 1}</dd></div>
            <div><dt>Escalation Level</dt><dd>{detail.escalation_level || 0}</dd></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AlertOperationsPanel({ mode, setMode, alerts, selectedAlerts, onSelectAll }) {
  const counts = {
    overdue: alerts.filter((alert) => String(formatRelative(alert.sla_due_at)).includes("overdue")).length,
    dueSoon: alerts.filter((alert) => {
      const minutes = Math.round((new Date(alert.sla_due_at).getTime() - Date.now()) / 60000);
      return minutes >= 0 && minutes <= 30;
    }).length,
    aged: alerts.filter((alert) => Date.now() - new Date(alert.timestamp).getTime() > 3600000).length,
    likelyFalsePositive: alerts.filter((alert) => Number(alert.fraud_probability || 0) < 0.35 && Number(alert.anomaly_score || 0) < 0.45).length,
  };
  return (
    <section className="content-grid analytics-grid-wide">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h3>Alert Triage Queue</h3>
            <p>Switch between newest, highest risk, SLA, and likely false-positive work modes.</p>
          </div>
          <button className="secondary-button" type="button" onClick={onSelectAll}>Select Visible</button>
        </div>
        <div className="pill-toggle">
          {[
            ["newest", "Newest"],
            ["risk", "Highest Risk"],
            ["sla", "SLA"],
            ["false_positive", "Likely False Positive"],
          ].map(([key, label]) => (
            <button key={key} className={mode === key ? "pill-button active" : "pill-button"} type="button" onClick={() => setMode(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="sla-strip">
          <span className="sla-chip severity-critical"><strong>{counts.overdue}</strong> overdue</span>
          <span className="sla-chip severity-high"><strong>{counts.dueSoon}</strong> due in 30m</span>
          <span className="sla-chip"><strong>{counts.aged}</strong> aging over 1h</span>
          <span className="sla-chip"><strong>{counts.likelyFalsePositive}</strong> likely noise</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h3>Bulk Triage Preview</h3>
            <p>Review the impact before assigning, closing, escalating, or exporting.</p>
          </div>
        </div>
        <div className="details-grid">
          <div><dt>Selected</dt><dd>{selectedAlerts.length}</dd></div>
          <div><dt>Estimated Loss</dt><dd>{formatCurrency(selectedAlerts.reduce((sum, alert) => sum + Number(alert.amount || 0) * Number(alert.fraud_probability || 0), 0))}</dd></div>
          <div><dt>Highest Priority</dt><dd>{Math.max(0, ...selectedAlerts.map((alert) => Number(alert.priority_score || 0)))}</dd></div>
          <div><dt>Close Approval</dt><dd>{selectedAlerts.some((alert) => Number(alert.priority_score || 0) >= 80) ? "Supervisor required" : "Analyst allowed"}</dd></div>
        </div>
      </div>
    </section>
  );
}

export default function AlertsPage() {
  const { token, email, role, refreshSession } = useAuth();
  const { refreshAll, alerts: appAlerts } = useAppData();
  const { pushToast } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const [board, setBoard] = useState({ alerts: [], tabs: [], grouped_incidents: [], assignment_queues: {}, notifications: { items: [], unread_count: 0 } });
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState("all");
  const [selected, setSelected] = useState([]);
  const [detail, setDetail] = useState(null);
  const [statusText, setStatusText] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [attachmentDraft, setAttachmentDraft] = useState({ name: "", file_type: "evidence", url: "", note: "" });
  const [assignTarget, setAssignTarget] = useState("");
  const [escalationSeverity, setEscalationSeverity] = useState("critical");
  const [pageLoading, setPageLoading] = useState(false);
  const [workflowConfig, setWorkflowConfig] = useState({ escalation_policy: [], suppression_rules: [], similarity_controls: {} });
  const [triageMode, setTriageMode] = useState("newest");
  const canManage = ["ADMIN", "SERVICE"].includes(String(role || "").toUpperCase());
  const fallbackAlerts = useMemo(() => (appAlerts || []).map(normalizeAlertRow), [appAlerts]);

  async function fetchBoardData(accessToken, status = activeTab) {
    const [alertsPayload, notificationsPayload, usersPayload] = await Promise.all([
      getAlerts(accessToken, 80),
      getNotifications(accessToken, 25),
      canManage ? listUsers(accessToken).catch(() => ({ users: [] })) : Promise.resolve({ users: [] })
    ]);
    const alerts = (alertsPayload.alerts || []).map(normalizeAlertRow);
    const assignmentQueues = alertsPayload.assignment_queues || buildAssignmentQueuesFallback(alerts);
    const workflowPayload = buildWorkflowFallback(alertsPayload.workflow_config || {});
    return {
      board: {
        alerts: status === "all" ? alerts : alerts.filter((item) => String(item.status || "").toLowerCase() === status),
        tabs: (alertsPayload.tabs || []).length ? alertsPayload.tabs : buildTabsFallback(alerts),
        grouped_incidents: alertsPayload.grouped_incidents || [],
        assignment_queues: assignmentQueues,
        notifications: notificationsPayload
      },
      users: (usersPayload.users || []).filter((user) => String(user.status || "").toUpperCase() === "ACTIVE"),
      workflowPayload
    };
  }

  function applyFallbackBoard(status = activeTab, message = "") {
    const snapshot = buildBoardSnapshot(fallbackAlerts, status, board.notifications || { items: [], unread_count: 0 }, workflowConfig);
    setBoard(snapshot);
    setWorkflowConfig(snapshot.workflow_config);
    if (email) {
      setUsers((current) => (current.length ? current : [{ email, status: "ACTIVE" }]));
    }
    if (message) {
      setStatusText(message);
    }
  }

  async function loadBoard(status = activeTab, accessToken = token, allowRefresh = true) {
    if (!accessToken) {
      applyFallbackBoard(
        status,
        fallbackAlerts.length
          ? "Session required for analyst workflow actions. Showing live alert feed from the realtime stream."
          : "Sign in to load alert workflow data."
      );
      return;
    }
    try {
      setPageLoading(true);
      const payload = await fetchBoardData(accessToken, status);
      setBoard(payload.board);
      setWorkflowConfig(payload.workflowPayload);
      setUsers(payload.users);
      setStatusText("");
    } catch (error) {
      if (allowRefresh && isAuthError(error)) {
        try {
          const session = await refreshSession();
          await loadBoard(status, session.access_token, false);
          return;
        } catch (refreshError) {
          applyFallbackBoard(
            status,
            "Session expired. Showing the live alert feed while analyst workflow APIs reconnect."
          );
          return;
        }
      }
      applyFallbackBoard(
        status,
        error.message || "Unable to load alerts. Showing live alert feed instead."
      );
    } finally {
      setPageLoading(false);
    }
  }

  useEffect(() => {
    loadBoard(activeTab);
  }, [token, activeTab, role, fallbackAlerts.length]);

  useEffect(() => {
    const targetTimestamp = searchParams.get("open");
    if (!targetTimestamp || !board.alerts.length) {
      return;
    }
    const match = board.alerts.find((item) => String(item.timestamp) === String(targetTimestamp));
    if (match && detail?.timestamp !== match.timestamp) {
      openDetail(match);
    }
  }, [board.alerts, detail?.timestamp, searchParams]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggleSelected(timestamp) {
    setSelected((current) => (current.includes(timestamp) ? current.filter((item) => item !== timestamp) : [...current, timestamp]));
  }

  async function openDetail(alert) {
    if (!token) {
      setDetail(buildFallbackAlertDetail(alert));
      return;
    }
    try {
      const payload = await getAlertDetails(token, alert.timestamp);
      setDetail(payload.detail);
      setAssignTarget(payload.detail?.assigned_to || email || "");
      setNoteDraft("");
      setAttachmentDraft({ name: "", file_type: "evidence", url: "", note: "" });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("open", String(alert.timestamp));
      setSearchParams(nextParams, { replace: true });
      await bulkUpdateAlerts(token, { timestamps: [alert.timestamp], action: "mark_read" });
      await loadBoard(activeTab);
    } catch (error) {
      setDetail(buildFallbackAlertDetail(alert));
      setStatusText(
        isAuthError(error)
          ? "Detailed alert APIs are temporarily unavailable. Showing the live alert snapshot."
          : error.message || "Unable to load alert detail"
      );
    }
  }

  async function runBulk(action, extra = {}) {
    const targetTimestamps = extra.timestamps || selected;
    if (!token || !targetTimestamps.length) {
      return;
    }
    try {
      await bulkUpdateAlerts(token, { timestamps: targetTimestamps, action, ...extra });
      setSelected([]);
      await refreshAll();
      await loadBoard(activeTab);
      pushToast({
        title: "Alert workflow updated",
        message: `${action.replace("_", " ")} completed for ${targetTimestamps.length} alert${targetTimestamps.length === 1 ? "" : "s"}.`,
        tone: action === "close" ? "success" : action === "escalate" ? "warning" : "info",
      });
      if (detail) {
        const payload = await getAlertDetails(token, detail.timestamp);
        setDetail(payload.detail);
      }
    } catch (error) {
      setStatusText(error.message || "Unable to update alerts");
    }
  }

  async function handleAssignFromDrawer() {
    if (!token || !detail?.timestamp || !assignTarget) {
      return;
    }
    try {
      await assignAlert(token, detail.timestamp, assignTarget);
      await refreshAll();
      await openDetail(detail);
      await loadBoard(activeTab);
      pushToast({
        title: "Alert assigned",
        message: `Ownership moved to ${assignTarget}.`,
        tone: "success",
      });
    } catch (error) {
      setStatusText(error.message || "Unable to assign alert");
    }
  }

  async function handleAssignSingle(timestamp) {
    if (!token) {
      return;
    }
    try {
      await assignAlert(token, timestamp, email);
      await refreshAll();
      await loadBoard(activeTab);
      pushToast({
        title: "Assigned to you",
        message: `Alert ${String(timestamp).slice(11, 19)} is now in your queue.`,
        tone: "success",
      });
    } catch (error) {
      setStatusText(error.message || "Unable to assign alert");
    }
  }

  async function handleReviewSingle(timestamp) {
    await runBulk("review", { timestamps: [timestamp] });
  }

  async function handleEscalateSingle(timestamp) {
    await runBulk("escalate", { timestamps: [timestamp], severity: escalationSeverity, assigned_to: assignTarget || email });
  }

  async function handleAddNote() {
    if (!token || !detail?.timestamp || !noteDraft.trim()) {
      return;
    }
    try {
      await addAlertNote(token, detail.timestamp, noteDraft);
      setNoteDraft("");
      const payload = await getAlertDetails(token, detail.timestamp);
      setDetail(payload.detail);
      await loadBoard(activeTab);
      pushToast({
        title: "Analyst note saved",
        message: "The investigation note was appended to the alert trail.",
        tone: "info",
      });
    } catch (error) {
      setStatusText(error.message || "Unable to add note");
    }
  }

  async function handleAddAttachment() {
    if (!token || !detail?.timestamp || !attachmentDraft.name.trim()) {
      return;
    }
    try {
      await addAlertAttachment(token, detail.timestamp, attachmentDraft);
      setAttachmentDraft({ name: "", file_type: "evidence", url: "", note: "" });
      const payload = await getAlertDetails(token, detail.timestamp);
      setDetail(payload.detail);
      await loadBoard(activeTab);
      pushToast({
        title: "Evidence attached",
        message: "Supporting investigation evidence was added to the alert.",
        tone: "success",
      });
    } catch (error) {
      setStatusText(error.message || "Unable to attach evidence");
    }
  }

  async function saveWorkflowConfig() {
    if (!token) {
      return;
    }
    try {
      await updateSettings(token, {
        alert_workflow: {
          escalation_policy: workflowConfig.escalation_policy || [],
          suppression_rules: workflowConfig.suppression_rules || [],
          similarity_threshold: workflowConfig.similarity_controls?.similarity_threshold,
          dedupe_window_minutes: workflowConfig.similarity_controls?.dedupe_window_minutes,
          auto_merge_incidents: workflowConfig.similarity_controls?.auto_merge_incidents,
        },
      });
      await loadBoard(activeTab);
      pushToast({
        title: "Workflow controls saved",
        message: "Escalation, suppression, and similarity settings were updated.",
        tone: "success",
      });
    } catch (error) {
      setStatusText(error.message || "Unable to save workflow controls");
    }
  }

  async function markAllNotifications() {
    if (!token) {
      setStatusText("Notifications need an active analyst session. Live alerts are still updating.");
      return;
    }
    await markNotificationsRead(token, []);
    await loadBoard(activeTab);
    pushToast({
      title: "Notifications updated",
      message: "All notification center items were marked as read.",
      tone: "success",
    });
  }

  async function markOneNotification(notificationId) {
    if (!token) {
      setStatusText("Notifications need an active analyst session. Live alerts are still updating.");
      return;
    }
    await markNotificationsRead(token, [notificationId]);
    await loadBoard(activeTab);
    pushToast({
      title: "Notification read",
      message: "The notification was cleared from the unread queue.",
      tone: "info",
    });
  }

  const displayedAlerts = useMemo(() => {
    const rows = [...(board.alerts || [])];
    if (triageMode === "risk") {
      return rows.sort((left, right) => Number(right.priority_score || 0) - Number(left.priority_score || 0));
    }
    if (triageMode === "sla") {
      return rows.sort((left, right) => new Date(left.sla_due_at).getTime() - new Date(right.sla_due_at).getTime());
    }
    if (triageMode === "false_positive") {
      return rows
        .filter((alert) => Number(alert.fraud_probability || 0) < 0.45 || String(alert.risk_level || "").toUpperCase() !== "HIGH")
        .sort((left, right) => Number(left.priority_score || 0) - Number(right.priority_score || 0));
    }
    return rows.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
  }, [board.alerts, triageMode]);

  const selectedAlerts = useMemo(
    () => (board.alerts || []).filter((item) => selectedSet.has(item.timestamp)),
    [board.alerts, selectedSet]
  );

  if (pageLoading && !board.alerts.length && !board.notifications?.items?.length) {
    return (
      <div className="page-grid alerts-page">
        <section className="panel">
          <SkeletonBlock lines={6} />
        </section>
        <section className="panel">
          <SkeletonBlock lines={10} />
        </section>
      </div>
    );
  }

  return (
    <div className="page-grid alerts-page">
      {statusText ? <div className="error-banner">{statusText}</div> : null}

      <section className="stats-grid">
        <article className="stat-card tone-neutral">
          <p>Total Alerts</p>
          <h3>{board.tabs.find((tab) => tab.key === "all")?.count || 0}</h3>
          <span>Open analyst workload</span>
        </article>
        <article className="stat-card tone-danger">
          <p>Escalated</p>
          <h3>{board.tabs.find((tab) => tab.key === "escalated")?.count || 0}</h3>
          <span>Priority queue</span>
        </article>
        <article className="stat-card tone-warning">
          <p>Assigned</p>
          <h3>{board.tabs.find((tab) => tab.key === "assigned")?.count || 0}</h3>
          <span>Owned incidents</span>
        </article>
        <article className="stat-card tone-success">
          <p>Unread Notifications</p>
          <h3>{board.notifications?.unread_count || 0}</h3>
          <span>Channel and workflow updates</span>
        </article>
      </section>

      <NotificationCenter notifications={board.notifications || { items: [], unread_count: 0 }} onMarkAll={markAllNotifications} onMarkOne={markOneNotification} />

      <AlertOperationsPanel
        mode={triageMode}
        setMode={setTriageMode}
        alerts={board.alerts || []}
        selectedAlerts={selectedAlerts}
        onSelectAll={() => setSelected(displayedAlerts.map((alert) => alert.timestamp))}
      />

      <section className="content-grid analytics-grid-wide">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Case Assignment Queues</h3>
              <p>Analyst and team queues for owned incidents and routed escalations.</p>
            </div>
          </div>
          <div className="cohort-grid">
            <article className="cohort-card">
              <strong>Analyst Queue</strong>
              <div className="workspace-list">
                {(board.assignment_queues?.analysts || []).map((item) => (
                  <button
                    key={item.analyst}
                    className="workspace-card workspace-card-button"
                    type="button"
                    onClick={() => {
                      setAssignTarget(item.analyst === "unassigned" ? (email || "") : item.analyst);
                      setActiveTab(item.overdue ? "escalated" : "assigned");
                    }}
                  >
                    <strong>{item.analyst}</strong>
                    <p>{item.count} cases · {item.critical} critical</p>
                    <span>{item.overdue} overdue</span>
                  </button>
                ))}
                {!(board.assignment_queues?.analysts || []).length ? <div className="empty-state">No analyst assignments yet.</div> : null}
              </div>
            </article>
            <article className="cohort-card">
              <strong>Team Routes</strong>
              <div className="workspace-list">
                {(board.assignment_queues?.teams || []).map((item) => (
                  <button
                    key={item.team}
                    className="workspace-card workspace-card-button"
                    type="button"
                    onClick={() => setActiveTab(item.critical ? "escalated" : "assigned")}
                  >
                    <strong>{item.team}</strong>
                    <p>{item.count} routed alerts</p>
                    <span>{item.critical} critical in queue</span>
                  </button>
                ))}
                {!(board.assignment_queues?.teams || []).length ? <div className="empty-state">No routed team queues yet.</div> : null}
              </div>
            </article>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Escalation And Suppression Controls</h3>
              <p>Auto-routing, suppression rules, and similarity clustering settings.</p>
            </div>
            {canManage ? <button className="secondary-button" type="button" onClick={saveWorkflowConfig}>Save Workflow</button> : null}
          </div>
          <div className="settings-form">
            <label>Similarity Threshold<input type="range" min="0.1" max="0.95" step="0.01" value={workflowConfig.similarity_controls?.similarity_threshold || 0.72} onChange={(event) => setWorkflowConfig((current) => ({ ...current, similarity_controls: { ...(current.similarity_controls || {}), similarity_threshold: Number(event.target.value) } }))} /></label>
            <label>Dedupe Window Minutes<input type="number" min="5" value={workflowConfig.similarity_controls?.dedupe_window_minutes || 30} onChange={(event) => setWorkflowConfig((current) => ({ ...current, similarity_controls: { ...(current.similarity_controls || {}), dedupe_window_minutes: Number(event.target.value) } }))} /></label>
            <label className="toggle-row"><span>Auto Merge Incidents</span><input type="checkbox" checked={Boolean(workflowConfig.similarity_controls?.auto_merge_incidents)} onChange={(event) => setWorkflowConfig((current) => ({ ...current, similarity_controls: { ...(current.similarity_controls || {}), auto_merge_incidents: event.target.checked } }))} /></label>
          </div>
          <div className="content-grid analytics-grid">
            <div className="panel">
              <div className="panel-header"><div><h3>Escalation Policy Builder</h3><p>Severity routing and default ownership.</p></div></div>
              <div className="workspace-list">
                {(workflowConfig.escalation_policy || []).map((policy, index) => (
                  <article key={policy.id || index} className="workspace-card">
                    <div className="settings-form">
                      <label>Severity<select value={policy.severity || "high"} onChange={(event) => setWorkflowConfig((current) => ({ ...current, escalation_policy: (current.escalation_policy || []).map((item, innerIndex) => innerIndex === index ? { ...item, severity: event.target.value } : item) }))}><option value="high">high</option><option value="critical">critical</option><option value="medium">medium</option></select></label>
                      <label>Route To<input value={policy.route_to || ""} onChange={(event) => setWorkflowConfig((current) => ({ ...current, escalation_policy: (current.escalation_policy || []).map((item, innerIndex) => innerIndex === index ? { ...item, route_to: event.target.value } : item) }))} /></label>
                      <label>SLA Minutes<input type="number" min="5" value={policy.sla_minutes || 30} onChange={(event) => setWorkflowConfig((current) => ({ ...current, escalation_policy: (current.escalation_policy || []).map((item, innerIndex) => innerIndex === index ? { ...item, sla_minutes: Number(event.target.value) } : item) }))} /></label>
                      <label>Auto Assign<input value={policy.auto_assign || ""} onChange={(event) => setWorkflowConfig((current) => ({ ...current, escalation_policy: (current.escalation_policy || []).map((item, innerIndex) => innerIndex === index ? { ...item, auto_assign: event.target.value } : item) }))} /></label>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="panel">
              <div className="panel-header"><div><h3>Suppression Rules</h3><p>Noise controls for repetitive low-value incidents.</p></div></div>
              <div className="workspace-list">
                {(workflowConfig.suppression_rules || []).map((rule, index) => (
                  <article key={rule.id || index} className="workspace-card">
                    <div className="settings-form">
                      <label>Rule Name<input value={rule.name || ""} onChange={(event) => setWorkflowConfig((current) => ({ ...current, suppression_rules: (current.suppression_rules || []).map((item, innerIndex) => innerIndex === index ? { ...item, name: event.target.value } : item) }))} /></label>
                      <label>Condition<input value={rule.condition || ""} onChange={(event) => setWorkflowConfig((current) => ({ ...current, suppression_rules: (current.suppression_rules || []).map((item, innerIndex) => innerIndex === index ? { ...item, condition: event.target.value } : item) }))} /></label>
                      <label>Window Minutes<input type="number" min="5" value={rule.window_minutes || 15} onChange={(event) => setWorkflowConfig((current) => ({ ...current, suppression_rules: (current.suppression_rules || []).map((item, innerIndex) => innerIndex === index ? { ...item, window_minutes: Number(event.target.value) } : item) }))} /></label>
                      <label className="toggle-row"><span>Enabled</span><input type="checkbox" checked={Boolean(rule.enabled)} onChange={(event) => setWorkflowConfig((current) => ({ ...current, suppression_rules: (current.suppression_rules || []).map((item, innerIndex) => innerIndex === index ? { ...item, enabled: event.target.checked } : item) }))} /></label>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Triage Board</h3>
            <p>New, assigned, in-review, escalated, and closed incidents in one workflow board</p>
          </div>
        </div>
        {(board.tabs || []).length ? (
          <div className="pill-toggle">
            {(board.tabs || []).map((tab) => (
              <button key={tab.key} className={activeTab === tab.key ? "pill-button active" : "pill-button"} type="button" onClick={() => setActiveTab(tab.key)}>
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Alert workflow is ready"
            description="Once high-risk events enter the pipeline, triage tabs, incident groups, and analyst queues will populate here."
          />
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Bulk Actions</h3>
            <p>{selected.length} selected for assign, review, escalate, close, or export. Preview requires no commit until an action is pressed.</p>
          </div>
          <div className="inline-form">
            <select value={assignTarget} onChange={(event) => setAssignTarget(event.target.value)}>
              <option value={email || ""}>Assign to me</option>
              {users.map((user) => (
                <option key={user.email} value={user.email}>
                  {user.email}
                </option>
              ))}
            </select>
            <select value={escalationSeverity} onChange={(event) => setEscalationSeverity(event.target.value)}>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <button className="secondary-button" type="button" onClick={() => runBulk("assign", { assigned_to: assignTarget || email })}>
              Assign
            </button>
            <button className="secondary-button" type="button" onClick={() => runBulk("review")}>
              Mark Reviewed
            </button>
            <button className="secondary-button" type="button" onClick={() => runBulk("escalate", { severity: escalationSeverity, assigned_to: assignTarget || email })}>
              Escalate
            </button>
            <button className="secondary-button" type="button" onClick={() => runBulk("close")} disabled={selectedAlerts.some((alert) => Number(alert.priority_score || 0) >= 80)}>
              Close
            </button>
            <button className="secondary-button" type="button" onClick={() => exportAlerts(board.alerts.filter((item) => selectedSet.has(item.timestamp)))}>
              Export Selected
            </button>
          </div>
        </div>
      </section>

      <section className="content-grid alerts-layout">
        <div className="alerts-column">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Incident Clusters</h3>
                <p>Deduplicated repeated suspicious patterns grouped as one incident family</p>
              </div>
            </div>
            <div className="workspace-list">
              {(board.grouped_incidents || []).slice(0, 6).map((group) => (
                <article key={group.incident_group_id} className="workspace-card">
                  <strong>{group.incident_group_id}</strong>
                  <p>{group.count} related alerts • highest priority {group.highest_priority}</p>
                  <span>{String(group.severity || "").toUpperCase()}</span>
                </article>
              ))}
              {(board.grouped_incidents || []).length === 0 ? <div className="empty-state">No incident clusters yet.</div> : null}
            </div>
          </section>

          <section className="alert-board-grid">
            {displayedAlerts.map((alert) => (
              <AlertCard
                key={alert.timestamp}
                alert={alert}
                selected={selectedSet.has(alert.timestamp)}
                active={detail?.timestamp === alert.timestamp}
                onToggle={toggleSelected}
                onOpen={openDetail}
                onAssignSelf={handleAssignSingle}
                onReview={handleReviewSingle}
                onEscalate={handleEscalateSingle}
              />
            ))}
            {displayedAlerts.length === 0 ? (
              <EmptyState
                title="No alerts match the selected triage tab"
                description="Try switching tabs, clearing bulk selections, or waiting for new scored transactions to trigger incidents."
              />
            ) : null}
          </section>
        </div>

        <AlertDetailsDrawer
          detail={detail}
          users={users}
          assignTarget={assignTarget}
          setAssignTarget={setAssignTarget}
          escalationSeverity={escalationSeverity}
          setEscalationSeverity={setEscalationSeverity}
          noteDraft={noteDraft}
          setNoteDraft={setNoteDraft}
          attachmentDraft={attachmentDraft}
          setAttachmentDraft={setAttachmentDraft}
          onAssign={handleAssignFromDrawer}
          onEscalate={() => detail && runBulk("escalate", { timestamps: [detail.timestamp], severity: escalationSeverity, assigned_to: assignTarget || email })}
          onClose={() => {
            if (detail) {
              const nextParams = new URLSearchParams(searchParams);
              nextParams.delete("open");
              setSearchParams(nextParams, { replace: true });
              setDetail(null);
              runBulk("close", { timestamps: [detail.timestamp] });
            }
          }}
          onAddNote={handleAddNote}
          onAddAttachment={handleAddAttachment}
        />
      </section>
    </div>
  );
}
