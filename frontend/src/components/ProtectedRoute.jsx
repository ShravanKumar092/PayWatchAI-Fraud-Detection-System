import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute() {
  const { isAuthenticated, initializing } = useAuth();
  const location = useLocation();

  if (initializing && !isAuthenticated) {
    return (
      <div className="page-grid">
        <div className="panel">
          <p className="eyebrow">PayWatch AI</p>
          <h2>Loading workspace session</h2>
          <p className="muted-copy">Restoring your saved session and preparing the dashboard.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
