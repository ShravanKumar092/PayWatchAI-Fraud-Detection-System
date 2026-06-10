export default function RiskBadge({ risk = "LOW" }) {
  const tone = String(risk).toUpperCase();
  return <span className={`risk-badge risk-${tone.toLowerCase()}`}>{tone}</span>;
}
