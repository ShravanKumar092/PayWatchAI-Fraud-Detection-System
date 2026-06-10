import { createContext, useContext, useMemo, useState } from "react";
import { useEffect } from "react";
import {
  clearStoredAuthSession,
  loginUser,
  logoutUser,
  readStoredAuthSession,
  refreshUserSession,
  registerUser,
} from "../services/api";

const AuthContext = createContext(null);

function readStoredAuth() {
  const stored = readStoredAuthSession();
  return {
    token: stored.token || null,
    refreshToken: stored.refreshToken || null,
    role: stored.role || null,
    email: stored.email || null,
    session: stored.session || null,
  };
}

export function AuthProvider({ children }) {
  const stored = readStoredAuth();
  const [token, setToken] = useState(stored.token);
  const [refreshToken, setRefreshToken] = useState(stored.refreshToken);
  const [role, setRole] = useState(stored.role);
  const [email, setEmail] = useState(stored.email);
  const [session, setSession] = useState(stored.session);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(Boolean(stored.refreshToken && !stored.token));

  function applyAuthPayload(payload, emailInput = "") {
    setToken(payload.access_token || null);
    setRefreshToken(payload.refresh_token || null);
    setRole(payload.role || payload.user?.role || "VIEWER");
    setEmail(payload.user?.email || emailInput || null);
    setSession(payload.session || null);
    setInitializing(false);
  }

  async function login(emailInput, password) {
    setLoading(true);
    try {
      const payload = await loginUser(emailInput, password);
      applyAuthPayload(payload, emailInput);
      return payload;
    } finally {
      setLoading(false);
    }
  }

  async function register(data) {
    setLoading(true);
    try {
      return await registerUser(data);
    } finally {
      setLoading(false);
    }
  }

  async function refreshSession() {
    const payload = await refreshUserSession();
    applyAuthPayload(payload, payload?.user?.email || email);
    return payload;
  }

  async function logout() {
    await logoutUser(token);
    clearStoredAuthSession();
    setToken(null);
    setRefreshToken(null);
    setRole(null);
    setEmail(null);
    setSession(null);
    setInitializing(false);
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!stored.refreshToken || stored.token) {
        setInitializing(false);
        return;
      }
      try {
        const payload = await refreshUserSession();
        if (!cancelled) {
          applyAuthPayload(payload, payload?.user?.email || stored.email || "");
        }
      } catch (error) {
        if (!cancelled) {
          clearStoredAuthSession();
          setToken(null);
          setRefreshToken(null);
          setRole(null);
          setEmail(null);
          setSession(null);
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!refreshToken) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      refreshSession().catch(() => {
        clearStoredAuthSession();
        setToken(null);
        setRefreshToken(null);
        setRole(null);
        setEmail(null);
        setSession(null);
      });
    }, 12 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [refreshToken]);

  const value = useMemo(
    () => ({
      token,
      refreshToken,
      role,
      email,
      session,
      loading,
      initializing,
      isAuthenticated: Boolean(token),
      login,
      register,
      logout,
      refreshSession,
    }),
    [token, refreshToken, role, email, session, loading, initializing]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
