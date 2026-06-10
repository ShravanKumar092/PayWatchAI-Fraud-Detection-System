export default function EmptyState({ title, description, actionLabel, onAction }) {
  return (
    <div className="empty-state-card" role="status" aria-live="polite">
      <strong>{title}</strong>
      <p>{description}</p>
      {actionLabel && onAction ? (
        <button className="secondary-button" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
