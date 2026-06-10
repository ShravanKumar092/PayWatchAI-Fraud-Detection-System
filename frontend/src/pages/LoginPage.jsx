import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import BrandLogo from "../components/BrandLogo";

const defaultRegister = {
  name: "",
  email: "",
  password: "",
  role: "VIEWER",
  admin_signup_key: ""
};

export default function LoginPage() {
  const { login, register, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTarget = useMemo(() => location.state?.from?.pathname || "/dashboard", [location.state]);
  const [mode, setMode] = useState("login");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState(defaultRegister);
  const [error, setError] = useState("");

  async function handleLogin(event) {
    event.preventDefault();
    try {
      setError("");
      await login(loginForm.email.trim().toLowerCase(), loginForm.password);
      navigate(redirectTarget, { replace: true });
    } catch (loginError) {
      setError(loginError.message);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    try {
      setError("");
      await register({
        ...registerForm,
        email: registerForm.email.trim().toLowerCase()
      });
      setMode("login");
      setLoginForm({ email: registerForm.email, password: registerForm.password });
    } catch (registerError) {
      setError(registerError.message);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="auth-copy">
          <div className="auth-logo-lockup">
            <BrandLogo size={88} title="PayWatch AI" animated />
            <div>
              <p className="eyebrow">PayWatch AI</p>
            </div>
          </div>
          <h1>Real-time fintech fraud control room</h1>
          <p>
            Weighted ML scoring, graph-aware alerts, recent buffered transactions, and explainable decisions in one dashboard.
          </p>
        </div>

        <div className="auth-card">
          <div className="auth-tabs">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
              Login
            </button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
              Register
            </button>
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

          {mode === "login" ? (
            <form className="auth-form" onSubmit={handleLogin}>
              <label>
                Email
                <input
                  value={loginForm.email}
                  onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })}
                  placeholder="analyst@paywatch.ai"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
                  placeholder="Enter password"
                />
              </label>
              <button className="primary-button" disabled={loading} type="submit">
                {loading ? "Signing in..." : "Access Dashboard"}
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleRegister}>
              <label>
                Full Name
                <input
                  value={registerForm.name}
                  onChange={(event) => setRegisterForm({ ...registerForm, name: event.target.value })}
                  placeholder="Fraud Analyst"
                />
              </label>
              <label>
                Email
                <input
                  value={registerForm.email}
                  onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })}
                  placeholder="analyst@paywatch.ai"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={registerForm.password}
                  onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })}
                  placeholder="Create password"
                />
              </label>
              <label>
                Role
                <select
                  value={registerForm.role}
                  onChange={(event) => setRegisterForm({ ...registerForm, role: event.target.value })}
                >
                  <option value="VIEWER">Viewer</option>
                  <option value="ANALYST">Analyst</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>
              {registerForm.role === "ADMIN" ? (
                <label>
                  Admin Signup Key
                  <input
                    type="password"
                    value={registerForm.admin_signup_key}
                    onChange={(event) => setRegisterForm({ ...registerForm, admin_signup_key: event.target.value })}
                    placeholder="Enter admin key"
                  />
                </label>
              ) : null}
              <button className="primary-button" disabled={loading} type="submit">
                {loading ? "Creating account..." : "Create Account"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
