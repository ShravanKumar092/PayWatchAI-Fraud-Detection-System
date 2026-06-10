import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useWorkspace } from "../context/WorkspaceContext";

export default function ToastViewport() {
  const { toasts, dismissToast, clearToasts } = useWorkspace();
  const location = useLocation();
  const showOnlyOnAlerts = location.pathname.startsWith("/alerts");

  useEffect(() => {
    if (!showOnlyOnAlerts) {
      clearToasts();
    }
  }, [clearToasts, showOnlyOnAlerts]);

  if (!showOnlyOnAlerts) {
    return null;
  }

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <article key={toast.id} className={`toast-card toast-${toast.tone || "info"}`}>
          <div>
            <strong>{toast.title}</strong>
            <p>{toast.message}</p>
          </div>
          <button className="ghost-button" type="button" aria-label="Dismiss notification" onClick={() => dismissToast(toast.id)}>
            x
          </button>
        </article>
      ))}
    </div>
  );
}
