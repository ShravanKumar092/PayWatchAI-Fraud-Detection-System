import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRealtimeClient, getAlerts, getAnalytics, getStats, getTransactions, reviewAlert } from "../services/api";
import { useAuth } from "./AuthContext";
import { useWorkspace } from "./WorkspaceContext";

const AppDataContext = createContext(null);
function normaliseRows(rows = []) {
  const now = Date.now();
  return rows
    .filter((item) => item && typeof item === "object")
    .map((item, index, list) => ({
      ...item,
      risk_level: String(item.risk_level || item.predicted_risk || item.model_risk_level || "LOW").toUpperCase(),
      amount: Number(item.amount || 0),
      fraud_probability: Number(item.fraud_probability || 0),
      anomaly_score: Number(item.anomaly_score || 0),
      anomaly_risk: Number(item.anomaly_risk || 0),
      graph_score: Number(item.graph_score || 0),
      behavioral_risk: Number(item.behavioral_risk || 0),
      primary_model_probability: Number(item.primary_model_probability || 0),
      observed_at:
        item.observed_at ||
        new Date(now - Math.max(list.length - index - 1, 0) * 15000).toISOString(),
    }));
}

function sortRowsNewestFirst(rows = []) {
  return [...rows].sort(
    (left, right) =>
      new Date(right.observed_at || right.timestamp || 0).getTime() -
      new Date(left.observed_at || left.timestamp || 0).getTime()
  );
}

function mergeRows(existing = [], incoming = [], limit = 100) {
  const merged = [...incoming, ...existing];
  const seen = new Set();
  const deduped = [];
  for (const row of merged) {
    const key = row.transaction_id || row.timestamp || `${row.type}-${row.amount}-${row.source_account}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return sortRowsNewestFirst(deduped).slice(0, limit);
}

function deriveAlertFromTransaction(row = {}) {
  const fraudProbability = Number(row.fraud_probability || 0);
  const anomalyRisk = Number(row.anomaly_risk || row.anomaly_score || 0);
  const risk = String(row.risk_level || row.predicted_risk || "LOW").toUpperCase();
  const shouldAlert = risk === "HIGH" || fraudProbability >= 0.72 || anomalyRisk >= 0.68;
  if (!shouldAlert) {
    return null;
  }
  return {
    ...row,
    timestamp: row.timestamp,
    type: row.type || "Transaction Alert",
    severity: risk === "HIGH" ? "critical" : "high",
    status: row.status || "open",
    alert_source: "realtime-derived",
  };
}

function normaliseRealtimePayload(payload = {}) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (payload.transaction && payload.prediction) {
    return normaliseRows([{ ...payload.transaction, ...payload.prediction }])[0] || null;
  }
  if (payload.amount !== undefined || payload.type) {
    return normaliseRows([payload])[0] || null;
  }
  return null;
}

export function AppDataProvider({ children }) {
  const { token, isAuthenticated } = useAuth();
  const { pushToast } = useWorkspace();
  const [stats, setStats] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [connectionTransport, setConnectionTransport] = useState("idle");
  const [bufferedEvents, setBufferedEvents] = useState(0);
  const lastAlertCountRef = useRef(0);
  const lastModelVersionRef = useRef("");
  const refreshInFlightRef = useRef(null);
  const dataPresenceRef = useRef({
    stats: false,
    transactions: 0,
    alerts: 0,
    analytics: false,
  });

  useEffect(() => {
    dataPresenceRef.current = {
      stats: Boolean(stats),
      transactions: transactions.length,
      alerts: alerts.length,
      analytics: Boolean(analytics),
    };
  }, [alerts.length, analytics, stats, transactions.length]);

  const refreshAll = useCallback(async () => {
    if (!token) {
      return null;
    }

    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    refreshInFlightRef.current = (async () => {
      setLoading(true);
      try {
        const statsPayload = await getStats(token);
        const transactionsPayload = await getTransactions(token, 50);
        const alertsPayload = await getAlerts(token, 50);
        const analyticsPayload = await getAnalytics(token);

        const polledRows = normaliseRows(
          transactionsPayload.transactions || (transactionsPayload.transaction ? [transactionsPayload.transaction] : [])
        );
        const predictedRows = normaliseRows(statsPayload.recent_predictions || []);
        const nextTransactions = polledRows.length ? polledRows : predictedRows;

        setStats(statsPayload);
        setTransactions((current) => mergeRows(current, nextTransactions, 500));
        const nextAlerts = sortRowsNewestFirst(normaliseRows(alertsPayload.alerts || statsPayload.recent_alerts || []));
        const derivedAlerts = nextTransactions.map((row) => deriveAlertFromTransaction(row)).filter(Boolean);
        setAlerts((current) => mergeRows(current, [...nextAlerts, ...derivedAlerts], 250));
        setAnalytics(analyticsPayload);
        const incomingAlertCount = nextAlerts.length + derivedAlerts.length;
        if (incomingAlertCount > lastAlertCountRef.current) {
          pushToast({
            title: "Alert volume increased",
            message: `${incomingAlertCount - lastAlertCountRef.current} new alert(s) entered the workspace.`,
            tone: "warning",
          });
        }
        lastAlertCountRef.current = incomingAlertCount;
        const nextModelVersion =
          analyticsPayload?.active_model?.version ||
          analyticsPayload?.model_registry?.active_version ||
          "";
        if (nextModelVersion && lastModelVersionRef.current && lastModelVersionRef.current !== nextModelVersion) {
          pushToast({
            title: "Model version changed",
            message: `Analytics switched to ${nextModelVersion}.`,
            tone: "info",
          });
        }
        if (nextModelVersion) {
          lastModelVersionRef.current = nextModelVersion;
        }
        setConnectionStatus("connected");
        setConnectionTransport("docker");
        setBufferedEvents(0);
        setError("");
      } catch (refreshError) {
        const hasExistingData =
          dataPresenceRef.current.stats ||
          dataPresenceRef.current.transactions > 0 ||
          dataPresenceRef.current.alerts > 0 ||
          dataPresenceRef.current.analytics;

        setBufferedEvents(0);
        if (hasExistingData) {
          setConnectionStatus("connected");
          setConnectionTransport("docker");
          setError("");
        } else {
          setConnectionStatus("degraded");
          setConnectionTransport("docker");
          setError(refreshError.message || "Unable to load dashboard data");
        }
      } finally {
        setLoading(false);
        refreshInFlightRef.current = null;
      }
    })();

    return refreshInFlightRef.current;
  }, [pushToast, token]);

  async function markAlertReviewed(timestamp) {
    if (!token || !timestamp) {
      return;
    }

    try {
      const payload = await reviewAlert(token, timestamp);
      const updatedAlert = payload.alert;
      setAlerts((current) =>
        current.map((alert) =>
          alert.timestamp === timestamp
            ? {
                ...alert,
                ...(updatedAlert || {}),
                reviewed: true,
                reviewed_by: updatedAlert?.reviewed_by || alert.reviewed_by,
                reviewed_at: updatedAlert?.reviewed_at || alert.reviewed_at,
              }
            : alert
        )
      );
      pushToast({
        title: "Alert reviewed",
        message: `Alert ${timestamp} moved into review state.`,
        tone: "success",
      });
    } catch (reviewError) {
      setError(reviewError.message || "Unable to review alert");
    }
  }

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setStats(null);
      setTransactions([]);
      setAlerts([]);
      setAnalytics(null);
      setConnectionStatus("offline");
      setConnectionTransport("idle");
      setBufferedEvents(0);
      return undefined;
    }

    refreshAll();

    const realtimeClient = createRealtimeClient(token, {
      onStatus: ({ status, transport }) => {
        setConnectionStatus(status || "connecting");
        setConnectionTransport(transport || "idle");
      },
      onEvent: ({ payload, transport }) => {
        const nextRow = normaliseRealtimePayload(payload);
        if (!nextRow) {
          return;
        }
        setTransactions((current) => mergeRows(current, [nextRow], 500));
        const derivedAlert = deriveAlertFromTransaction(nextRow);
        if (derivedAlert) {
          setAlerts((current) => mergeRows(current, [derivedAlert], 250));
        }
        setBufferedEvents((count) => Math.min(count + 1, 999));
        setConnectionStatus("connected");
        setConnectionTransport(transport || "realtime");
      },
    });

    const pollTimer = window.setInterval(() => {
      refreshAll();
    }, 15000);

    return () => {
      window.clearInterval(pollTimer);
      realtimeClient.close();
      return undefined;
    };
  }, [isAuthenticated, token, refreshAll]);

  const value = useMemo(
    () => ({
      stats,
      transactions,
      alerts,
      analytics,
      selectedTransaction,
      setSelectedTransaction,
      refreshAll,
      error,
      loading,
      markAlertReviewed,
      connectionStatus,
      connectionTransport,
      bufferedEvents,
    }),
    [
      stats,
      transactions,
      alerts,
      analytics,
      selectedTransaction,
      refreshAll,
      error,
      loading,
      connectionStatus,
      connectionTransport,
      bufferedEvents,
    ]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error("useAppData must be used inside AppDataProvider");
  }
  return context;
}
