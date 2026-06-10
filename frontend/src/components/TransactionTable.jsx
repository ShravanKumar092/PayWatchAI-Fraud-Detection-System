import { useNavigate } from "react-router-dom";
import { useAppData } from "../context/AppDataContext";
import RiskBadge from "./RiskBadge";

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number(amount || 0));
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

export default function TransactionTable({ rows = [] }) {
  const navigate = useNavigate();
  const { setSelectedTransaction } = useAppData();

  function openDetails(row) {
    const transactionId = encodeURIComponent(row.transaction_id || row.timestamp || row.source_account || String(Date.now()));
    setSelectedTransaction(row);
    navigate(`/transactions/${transactionId}`);
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h3>Transactions</h3>
          <p>Latest scored transactions flowing through the workspace.</p>
        </div>
        <span>{rows.length} items</span>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Amount</th>
              <th>Score</th>
              <th>Anomaly</th>
              <th>Risk</th>
              <th>Source</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.timestamp || index}-${row.type || "tx"}`} onClick={() => openDetails(row)}>
                <td>{row.type || "UNKNOWN"}</td>
                <td>{formatCurrency(row.amount)}</td>
                <td>{formatPercent(row.fraud_probability)}</td>
                <td>{formatPercent(row.anomaly_risk)}</td>
                <td>
                  <RiskBadge risk={row.risk_level || row.predicted_risk || "LOW"} />
                </td>
                <td>{row.source_account || "n/a"}</td>
                <td>{String(row.timestamp || "").replace("T", " ").slice(0, 19)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
