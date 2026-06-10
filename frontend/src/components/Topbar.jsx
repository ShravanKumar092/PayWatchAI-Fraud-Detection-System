import { useAppData } from "../context/AppDataContext";
import { useWorkspace } from "../context/WorkspaceContext";
import GlobalSearchBar from "./GlobalSearchBar";

export default function Topbar() {
  const { refreshAll, connectionStatus, connectionTransport, bufferedEvents, alerts } = useAppData();
  const { openCommandPalette, openReport } = useWorkspace();

  const nextTheme = () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    if (current === "dark") return "light";
    if (current === "light") return "high-contrast";
    return "dark";
  };

  function toggleTheme() {
    const resolved = nextTheme();
    document.documentElement.setAttribute("data-theme", resolved);
    try {
      localStorage.setItem("paywatch_theme_mode", resolved);
    } catch (error) {
      // ignore storage issues
    }
  }

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Fintech Fraud Platform</p>
        <h2>Real-time monitoring and explainable decisions</h2>
      </div>

      <div className="topbar-actions">
        <div className={`connection-pill status-${connectionStatus || "connecting"}`}>
          <span className="connection-dot" />
          <strong>{String(connectionStatus || "connecting").toUpperCase()}</strong>
          <small>{String(connectionTransport || "idle").toUpperCase()}</small>
          {bufferedEvents ? <span>{bufferedEvents} buffered</span> : null}
        </div>
        <GlobalSearchBar />
        <button className="secondary-button" type="button" onClick={toggleTheme}>
          Theme
        </button>
        <button className="secondary-button" type="button" onClick={() => openCommandPalette()}>
          Command
        </button>
        <button className="secondary-button" type="button" onClick={() => openReport()}>
          Report
        </button>
        <button className="secondary-button" onClick={refreshAll}>
          Refresh
        </button>
        <div className="topbar-recent-alerts">
          <strong>Recent alerts</strong>
          <span>{alerts?.slice(0, 2).map((item) => item.type).join(" · ") || "Waiting for alerts"}</span>
        </div>
      </div>
    </header>
  );
}
