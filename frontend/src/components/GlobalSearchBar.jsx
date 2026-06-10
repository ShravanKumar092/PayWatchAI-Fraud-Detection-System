import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import EmptyState from "./EmptyState";
import SkeletonBlock from "./SkeletonBlock";
import { useAuth } from "../context/AuthContext";
import { searchGlobal } from "../services/api";
import { useWorkspace } from "../context/WorkspaceContext";

function groupEntries(payload) {
  const groups = payload?.groups || {};
  return [
    { key: "transactions", label: "Transactions", items: groups.transactions || [] },
    { key: "alerts", label: "Alerts", items: groups.alerts || [] },
    { key: "models", label: "Model Versions", items: groups.models || [] },
    { key: "users", label: "Users", items: groups.users || [] },
  ].filter((group) => group.items.length);
}

export default function GlobalSearchBar() {
  const { token } = useAuth();
  const { openCommandPalette } = useWorkspace();
  const navigate = useNavigate();
  const shellRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState({ groups: {} });

  useEffect(() => {
    if (!token || query.trim().length < 2) {
      setResults({ groups: {} });
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    const timeout = window.setTimeout(async () => {
      try {
        const payload = await searchGlobal(token, query, 5);
        if (!cancelled) {
          setResults(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setResults({ groups: {} });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [token, query]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (shellRef.current && !shellRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const grouped = useMemo(() => groupEntries(results), [results]);

  function selectResult(item) {
    setOpen(false);
    setQuery("");
    navigate(item.route || "/dashboard");
  }

  return (
    <div ref={shellRef} className="global-search-shell">
      <label className="global-search-input" aria-label="Global search">
        <span className="global-search-icon" aria-hidden="true">
          Search
        </span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search users, alerts, transactions, models..."
          aria-label="Search across users, transactions, alerts, and models"
          aria-expanded={open}
          aria-controls="global-search-results"
        />
        <button className="ghost-button" type="button" onClick={openCommandPalette} aria-label="Open command palette">
          Ctrl K
        </button>
      </label>

      {open ? (
        <div id="global-search-results" className="search-dropdown" role="listbox">
          {loading ? <SkeletonBlock lines={4} /> : null}
          {!loading && query.trim().length < 2 ? (
            <EmptyState
              title="Start typing to search the workspace"
              description="Search spans users, transactions, alerts, and model versions from one bar."
              actionLabel="Open Command Palette"
              onAction={openCommandPalette}
            />
          ) : null}
          {!loading && query.trim().length >= 2 && !grouped.length ? (
            <EmptyState
              title="No matches yet"
              description="Try searching by email, source account, model version, alert severity, or transaction ID."
            />
          ) : null}
          {!loading &&
            grouped.map((group) => (
              <section key={group.key} className="search-group">
                <strong>{group.label}</strong>
                {group.items.map((item) => (
                  <button key={`${group.key}-${item.id}`} className="search-result-item" type="button" onClick={() => selectResult(item)}>
                    <div>
                      <span>{item.label}</span>
                      <p>{item.description}</p>
                    </div>
                    <span className="status-chip">{item.badge}</span>
                  </button>
                ))}
              </section>
            ))}
        </div>
      ) : null}
    </div>
  );
}
