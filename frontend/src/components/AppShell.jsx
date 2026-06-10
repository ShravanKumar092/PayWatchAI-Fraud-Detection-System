import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import CommandPalette from "./CommandPalette";
import ReportCenter from "./ReportCenter";
import ToastViewport from "./ToastViewport";

export default function AppShell() {
  useEffect(() => {
    try {
      const theme = localStorage.getItem("paywatch_theme_mode") || "dark";
      document.documentElement.setAttribute("data-theme", theme);
    } catch (error) {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  return (
    <div className="shell">
      <Sidebar />
      <div className="shell-main">
        <Topbar />
        <main className="content">
          <Outlet />
        </main>
        <ToastViewport />
        <CommandPalette />
        <ReportCenter />
      </div>
    </div>
  );
}
