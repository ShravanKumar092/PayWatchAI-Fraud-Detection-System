import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportContext, setReportContext] = useState(null);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    function handleKeyboard(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        setReportOpen(true);
      }
      if (event.key === "Escape") {
        setCommandPaletteOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  const openCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
  }, []);

  const openReport = useCallback((context = null) => {
    setReportContext(context);
    setReportOpen(true);
  }, []);

  const closeReport = useCallback(() => {
    setReportOpen(false);
  }, []);

  const pushToast = useCallback((toast) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const nextToast = {
      id,
      tone: "info",
      duration: 4500,
      ...toast,
    };
    setToasts((current) => [...current, nextToast].slice(-6));
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, nextToast.duration);
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const value = useMemo(
    () => ({
      commandPaletteOpen,
      openCommandPalette,
      closeCommandPalette,
      reportOpen,
      reportContext,
      openReport,
      closeReport,
      toasts,
      pushToast,
      dismissToast,
      clearToasts,
    }),
    [
      clearToasts,
      closeCommandPalette,
      closeReport,
      commandPaletteOpen,
      dismissToast,
      openCommandPalette,
      openReport,
      pushToast,
      reportContext,
      reportOpen,
      toasts,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return context;
}
