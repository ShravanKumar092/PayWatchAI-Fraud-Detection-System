import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import RiskBadge from "../components/RiskBadge";
import { useAuth } from "../context/AuthContext";
import { useAppData } from "../context/AppDataContext";
import { getTransactionDetails, predictTransaction } from "../services/api";

export default function TransactionDetailsPage() {
  const { transactionId } = useParams();
  const { token } = useAuth();
  const { selectedTransaction, transactions } = useAppData();
  const [prediction, setPrediction] = useState(null);
  const [detailPayload, setDetailPayload] = useState(null);
  const [error, setError] = useState("");

  const transaction =
    selectedTransaction ||
    transactions.find((row) => encodeURIComponent(row.transaction_id || row.timestamp || "") === transactionId) ||
    null;

  useEffect(() => {
    let cancelled = false;

    async function loadDetails() {
      if (!transaction || !token) {
        return;
      }
      try {
        if (transaction.transaction_id) {
          const payload = await getTransactionDetails(token, transaction.transaction_id);
          if (!cancelled) {
            setDetailPayload(payload);
          }
        }
        const payload = await predictTransaction(token, transaction);
        if (!cancelled) {
          setPrediction(payload);
          setError("");
        }
      } catch (predictionError) {
        if (!cancelled) {
          setError(predictionError.message);
        }
      }
    }

    loadDetails();
    return () => {
      cancelled = true;
    };
  }, [transaction, token]);

  if (!transaction) {
    return <div className="panel">Transaction not found.</div>;
  }

  return (
    <div className="page-grid">
      {error ? <div className="error-banner">{error}</div> : null}

      <div className="content-grid analytics-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Transaction Info</h3>
            <RiskBadge risk={prediction?.risk_level || transaction.risk_level || "LOW"} />
          </div>
          <dl className="details-grid">
            {Object.entries(transaction).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Explainability</h3>
            <p>Weighted ML + SHAP insights</p>
          </div>
          <div className="explain-list">
            {(prediction?.explanation_details || []).map((item) => (
              <article key={item.feature} className="explain-card">
                <strong>{item.feature}</strong>
                <p>{item.summary}</p>
                <span>Impact: {Number(item.impact || 0).toFixed(4)}</span>
              </article>
            ))}
            {prediction?.explanation_details?.length ? null : (
              <div className="empty-state">Waiting for model explanation.</div>
            )}
          </div>
          {detailPayload?.incident_report?.summary ? (
            <div className="callout-card" style={{ marginTop: "16px" }}>
              <strong>Case Summary</strong>
              <p>{detailPayload.incident_report.summary}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
