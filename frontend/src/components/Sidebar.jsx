import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import BrandLogo from "./BrandLogo";

const baseNavItems = [
  { to: "/dashboard", label: "Dashboard", icon: "Rs" },
  { to: "/analytics", label: "Analytics", icon: "$" },
  { to: "/alerts", label: "Alerts", icon: "!" },
  { to: "/transactions", label: "Transactions", icon: "#" },
  { to: "/settings", label: "Settings", icon: "*" }
];

export default function Sidebar() {
  const { role, email, logout } = useAuth();
  const navItems = baseNavItems.filter((item) => item.to !== "/settings" || Boolean(role));

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark brand-mark-logo">
          <BrandLogo size={56} title="PayWatch AI" animated />
        </div>
        <div>
          <h1>PayWatch AI</h1>
          <p>Real-time fraud intelligence</p>
        </div>
      </div>

      <nav className="nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            aria-label={`Open ${item.label}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-account">
          <BrandLogo size={28} className="user-chip-logo" title="PayWatch profile icon" />
          <div className="sidebar-account-copy">
            <strong>{email || "Analyst"}</strong>
            <span>Workspace account</span>
          </div>
        </div>
        <button className="ghost-button sidebar-logout" type="button" onClick={logout}>
          Logout
        </button>
      </div>
    </aside>
  );
}
