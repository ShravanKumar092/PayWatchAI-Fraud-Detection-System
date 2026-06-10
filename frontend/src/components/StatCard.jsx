import { useEffect, useState } from "react";

function canAnimate(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export default function StatCard({ label, value, tone = "neutral", helper, onClick, interactive = false, subvalue }) {
  const Element = onClick ? "button" : "article";
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    if (!canAnimate(value)) {
      setDisplayValue(value);
      return undefined;
    }
    let frame = 0;
    const start = Number(canAnimate(displayValue) ? displayValue : 0);
    const end = Number(value);
    const startedAt = performance.now();
    const duration = 420;

    function tick(now) {
      const progress = Math.min((now - startedAt) / duration, 1);
      const next = start + (end - start) * progress;
      setDisplayValue(Number.isInteger(end) ? Math.round(next) : Number(next.toFixed(2)));
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      }
    }

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return (
    <Element
      className={`stat-card tone-${tone}${interactive ? " interactive-card" : ""}`}
      onClick={onClick}
      type={Element === "button" ? "button" : undefined}
    >
      <p>{label}</p>
      <h3>{displayValue}</h3>
      {subvalue ? <strong className="stat-subvalue">{subvalue}</strong> : null}
      {helper ? <span>{helper}</span> : null}
    </Element>
  );
}
