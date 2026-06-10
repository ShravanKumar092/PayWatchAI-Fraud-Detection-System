import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAppData } from "../context/AppDataContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { searchGlobal } from "../services/api";

function applyTheme(theme) {
  localStorage.setItem("paywatch_theme_mode", theme);
  document.documentElement.setAttribute("data-theme", theme);
}

export default function CommandPalette() {
  const { token, role } = useAuth();
  const { refreshAll } = useAppData();
  const { commandPaletteOpen, closeCommandPalette, openReport, pushToast } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchResults, setSearchResults] = useState([]);

  const baseActions = useMemo(
    () => [
      { id: "go-dashboard", label: "Go to Dashboard", hint: "Open the live command center", run: () => navigate("/dashboard") },
      { id: "go-analytics", label: "Go to Analytics", hint: "Inspect model performance and explainability", run: () => navigate("/analytics") },
      { id: "go-alerts", label: "Go to Alerts", hint: "Open the triage workflow", run: () => navigate("/alerts") },
      { id: "go-transactions", label: "Go to Transactions", hint: "Open the investigation table", run: () => navigate("/transactions") },
      { id: "go-settings", label: "Go to Settings", hint: "Manage profile, team, and controls", run: () => navigate("/settings") },
      { id: "refresh", label: "Refresh Current Data", hint: "Pull the latest stats, alerts, and analytics", run: async () => { await refreshAll(); pushToast({ title: "Workspace refreshed", message: "Latest data snapshot loaded.", tone: "success" }); } },
      { id: "report", label: "Open Executive Report", hint: "Generate a print-ready snapshot", run: () => openReport({ route: location.pathname }) },
      { id: "theme-dark", label: "Switch to Dark Theme", hint: "Default fintech monitoring theme", run: () => applyTheme("dark") },
      { id: "theme-light", label: "Switch to Light Theme", hint: "Presentation-ready daylight mode", run: () => applyTheme("light") },
      { id: "theme-contrast", label: "Switch to High Contrast Theme", hint: "Accessibility-focused display mode", run: () => applyTheme("high-contrast") },
    ],
    [location.pathname, navigate, openReport, pushToast, refreshAll]
  );

  useEffect(() => {
    if (!commandPaletteOpen) {
      setQuery("");
      setActiveIndex(0);
      setSearchResults([]);
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    if (!commandPaletteOpen || !token || query.trim().length < 2) {
      setSearchResults([]);
      return undefined;
    }
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const payload = await searchGlobal(token, query, 5);
        if (!cancelled) {
          setSearchResults(payload.results || []);
        }
      } catch (error) {
        if (!cancelled) {
          setSearchResults([]);
        }
      }
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [commandPaletteOpen, query, token]);

  const items = query.trim().length >= 2
    ? [
        ...searchResults.map((item) => ({
          id: `search-${item.entity}-${item.id}`,
          label: item.label,
          hint: item.description,
          badge: item.badge,
          run: () => navigate(item.route || "/dashboard"),
        })),
        ...baseActions.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()) || item.hint.toLowerCase().includes(query.toLowerCase()))
      ]
    : baseActions.filter((item) => (String(role || "VIEWER").toUpperCase() !== "VIEWER" ? true : !item.id.startsWith("go-settings")));

  useEffect(() => {
    function handleKey(event) {
      if (!commandPaletteOpen) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => Math.min(items.length - 1, current + 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === "Enter" && items[activeIndex]) {
        event.preventDefault();
        items[activeIndex].run();
        closeCommandPalette();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeIndex, closeCommandPalette, commandPaletteOpen, items]);

  if (!commandPaletteOpen) {
    return null;
  }

  return (
    <div className="command-palette-backdrop" role="dialog" aria-modal="true" aria-label="Command palette" onClick={closeCommandPalette}>
      <div className="command-palette" onClick={(event) => event.stopPropagation()}>
        <div className="command-palette-header">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workspace or run a command..."
            aria-label="Command palette input"
          />
          <button className="ghost-button" type="button" onClick={closeCommandPalette}>
            Esc
          </button>
        </div>
        <div className="command-palette-list" role="listbox">
          {items.map((item, index) => (
            <button
              key={item.id}
              className={index === activeIndex ? "command-item active" : "command-item"}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                item.run();
                closeCommandPalette();
              }}
            >
              <div>
                <strong>{item.label}</strong>
                <p>{item.hint}</p>
              </div>
              {item.badge ? <span className="status-chip">{item.badge}</span> : null}
            </button>
          ))}
          {!items.length ? <div className="empty-state">No commands or search matches yet.</div> : null}
        </div>
      </div>
    </div>
  );
}
