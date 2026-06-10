import RiskBadge from "./RiskBadge";

export default function AlertList({ alerts = [], onReview }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Alert Panel</h3>
        <p>{alerts.length} active</p>
      </div>
      <div className="alert-list">
        {alerts.length === 0 ? <div className="empty-state">No high-risk alerts yet.</div> : null}
        {alerts.map((alert) => (
          <article key={alert.timestamp} className="alert-card">
            <div className="alert-card-top">
              <RiskBadge risk={alert.risk_level || "HIGH"} />
              <span>{String(alert.timestamp || "").replace("T", " ").slice(0, 19)}</span>
            </div>
            <h4>{alert.type || "Transaction"} alert</h4>
            <p>{alert.client_id} - {Number(alert.amount || 0).toFixed(2)}</p>
            <button className="secondary-button" onClick={() => onReview(alert.timestamp)}>
              Mark Reviewed
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
