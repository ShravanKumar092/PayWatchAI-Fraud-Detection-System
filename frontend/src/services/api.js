const BROWSER_HOST =
  typeof window !== "undefined" && window.location?.hostname
    ? window.location.hostname
    : "127.0.0.1";

const IS_LOCAL_BROWSER_HOST = ["127.0.0.1", "localhost"].includes(BROWSER_HOST);
const DEFAULT_API_HOST = IS_LOCAL_BROWSER_HOST ? "127.0.0.1" : BROWSER_HOST;

const API_BASE_URL_STORAGE_KEY = "paywatch_api_base_url_v3";
const SETTINGS_SNAPSHOT_KEY = "paywatch_settings_snapshot_v1";
const ACCESS_TOKEN_KEY = "paywatch_token";
const REFRESH_TOKEN_KEY = "paywatch_refresh_token";
const ROLE_KEY = "paywatch_role";
const EMAIL_KEY = "paywatch_email";
const SESSION_KEY = "paywatch_session_v1";
const API_BASE_CANDIDATES = [
  "http://127.0.0.1:3014/api",
  "http://localhost:3014/api",
  "http://127.0.0.1:3000/api",
  "http://localhost:3000/api",
  "http://127.0.0.1:8021",
  "http://localhost:8021",
  "http://127.0.0.1:8020",
  "http://localhost:8020",
  "http://127.0.0.1:8080/api",
  "http://localhost:8080/api",
];
const API_PORT_CANDIDATES = [8021, 8020, 8010, 8000];
const API_HEALTH_PATH_CANDIDATES = ["/healthz", "/health"];
const API_REQUEST_TIMEOUT_MS = 10000;
const API_PROXY_TIMEOUT_MS = 10000;

function isLoopbackHost(hostname = "") {
  return ["127.0.0.1", "localhost", "::1"].includes(String(hostname || "").toLowerCase());
}

function shouldUseBrowserApiProxy() {
  if (typeof window === "undefined" || !window.location) {
    return false;
  }
  const port = String(window.location.port || "");
  return ["3000", "3007", "3008", "3014", "3015", "3016"].includes(port);
}

function getBrowserProxyApiBaseUrl() {
  if (typeof window === "undefined" || !window.location?.origin) {
    return "";
  }
  return shouldUseBrowserApiProxy() ? `${window.location.origin}/api` : window.location.origin;
}

function shouldUseDockerProxyOnly() {
  if (typeof window === "undefined" || !window.location) {
    return false;
  }
  const port = String(window.location.port || "");
  return ["3000", "3007", "3008", "3014", "3015", "3016"].includes(port);
}

function normalizeApiBaseUrl(value = "") {
  const next = String(value || "").trim().replace(/\/$/, "");
  if (!next) {
    return "";
  }
  return next;
}

function resolveConfiguredApiBaseUrl(value = "") {
  const normalized = normalizeApiBaseUrl(value);
  if (!normalized) {
    return "";
  }
  if (IS_LOCAL_BROWSER_HOST) {
    return normalized;
  }
  try {
    const parsed = new URL(normalized, typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1");
    if (isLoopbackHost(parsed.hostname)) {
      return "";
    }
  } catch (error) {
    return normalized;
  }
  return normalized;
}

function readStoredApiBaseUrl() {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    const proxyBase = getBrowserProxyApiBaseUrl();
    try {
      window.localStorage.removeItem("paywatch_api_base_url_v1");
      window.localStorage.removeItem("paywatch_api_base_url_v2");
    } catch (error) {
      // ignore legacy cleanup issues
    }
    const value = resolveConfiguredApiBaseUrl(window.localStorage.getItem(API_BASE_URL_STORAGE_KEY) || "");
    if (!value) {
      try {
        window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY);
      } catch (error) {
        // ignore storage cleanup issues
      }
      return "";
    }
    if (proxyBase) {
      try {
        const parsed = new URL(value, window.location.origin);
        const expectedPath = shouldUseBrowserApiProxy() ? "/api" : "";
        if (isLoopbackHost(parsed.hostname) && parsed.pathname.replace(/\/$/, "") !== expectedPath) {
          window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY);
          return "";
        }
      } catch (error) {
        // ignore parse issues and keep the value
      }
    }
    return value;
  } catch (error) {
    return "";
  }
}

function rememberApiBaseUrl(value) {
  const normalized = normalizeApiBaseUrl(value);
  if (!normalized) {
    return;
  }
  API_BASE_URL = normalized;
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(API_BASE_URL_STORAGE_KEY, normalized);
  } catch (error) {
    // ignore storage issues
  }
}

let API_BASE_URL =
  getBrowserProxyApiBaseUrl() ||
  readStoredApiBaseUrl() ||
  resolveConfiguredApiBaseUrl(import.meta.env.VITE_API_BASE_URL || "") ||
  `http://${DEFAULT_API_HOST}:8020`;

function safeLocalStorageGet(key) {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return window.localStorage.getItem(key) || "";
  } catch (error) {
    return "";
  }
}

function safeLocalStorageSet(key, value) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (value === null || value === undefined || value === "") {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, String(value));
  } catch (error) {
    // ignore storage issues
  }
}

function safeSessionSnapshot(value) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (!value) {
      window.localStorage.removeItem(SESSION_KEY);
      return;
    }
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch (error) {
    // ignore storage issues
  }
}

export function readStoredAuthSession() {
  const token = safeLocalStorageGet(ACCESS_TOKEN_KEY);
  const refreshToken = safeLocalStorageGet(REFRESH_TOKEN_KEY);
  const role = safeLocalStorageGet(ROLE_KEY);
  const email = safeLocalStorageGet(EMAIL_KEY);
  let session = null;
  try {
    const raw = safeLocalStorageGet(SESSION_KEY);
    session = raw ? JSON.parse(raw) : null;
  } catch (error) {
    session = null;
  }
  return { token, refreshToken, role, email, session };
}

export function rememberAuthSession(payload, fallbackEmail = "") {
  if (!payload || typeof payload !== "object") {
    return readStoredAuthSession();
  }
  const accessToken = payload.access_token || payload.token || safeLocalStorageGet(ACCESS_TOKEN_KEY);
  const refreshToken =
    Object.prototype.hasOwnProperty.call(payload, "refresh_token")
      ? payload.refresh_token || ""
      : "";
  const role = payload.role || payload.user?.role || safeLocalStorageGet(ROLE_KEY) || "VIEWER";
  const email = payload.user?.email || fallbackEmail || safeLocalStorageGet(EMAIL_KEY);
  safeLocalStorageSet(ACCESS_TOKEN_KEY, accessToken);
  safeLocalStorageSet(REFRESH_TOKEN_KEY, refreshToken);
  safeLocalStorageSet(ROLE_KEY, role);
  safeLocalStorageSet(EMAIL_KEY, email);
  safeSessionSnapshot(payload.session || readStoredAuthSession().session);
  return readStoredAuthSession();
}

export function clearStoredAuthSession() {
  safeLocalStorageSet(ACCESS_TOKEN_KEY, "");
  safeLocalStorageSet(REFRESH_TOKEN_KEY, "");
  safeLocalStorageSet(ROLE_KEY, "");
  safeLocalStorageSet(EMAIL_KEY, "");
  safeSessionSnapshot(null);
}

function buildHeaders(token, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const resolvedToken = token || safeLocalStorageGet(ACCESS_TOKEN_KEY);
  if (resolvedToken) {
    headers.Authorization = `Bearer ${resolvedToken}`;
  }
  return headers;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    return { detail: text };
  }
}

function timeoutError(timeoutMs) {
  return new Error(`Request timed out after ${timeoutMs}ms`);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  const externalSignal = options?.signal;
  const controller = new AbortController();

  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason);
  }

  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.addEventListener) {
    externalSignal.addEventListener("abort", forwardAbort, { once: true });
  }

  const timer = setTimeout(() => controller.abort(timeoutError(timeoutMs)), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (externalSignal?.removeEventListener) {
      externalSignal.removeEventListener("abort", forwardAbort);
    }
  }
}

async function probeApiBaseUrl(baseUrl, timeoutMs = API_PROXY_TIMEOUT_MS) {
  for (const healthPath of API_HEALTH_PATH_CANDIDATES) {
    try {
      const response = await fetchWithTimeout(buildCandidateUrl(baseUrl, healthPath), {}, timeoutMs);
      if (!response.ok) {
        continue;
      }
      const payload = await readJson(response);
      if (payload?.status === "UP" && String(payload?.service || "").includes("PayWatch AI Fraud API")) {
        return true;
      }
    } catch (error) {
      // try the next health path
    }
  }
  return false;
}

function buildCandidateUrl(baseUrl, pathWithSearch = "") {
  const base = new URL(baseUrl, typeof window !== "undefined" ? window.location.origin : `http://${DEFAULT_API_HOST}:8020`);
  const rawPath = String(pathWithSearch || "");
  const queryIndex = rawPath.indexOf("?");
  const pathname = queryIndex >= 0 ? rawPath.slice(0, queryIndex) : rawPath;
  const search = queryIndex >= 0 ? rawPath.slice(queryIndex) : "";
  const basePath = (base.pathname || "").replace(/\/$/, "");
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const combinedPath =
    basePath && basePath !== "/" && (normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`))
      ? normalizedPath
      : `${basePath}${normalizedPath}`.replace(/\/{2,}/g, "/");
  return `${base.origin}${combinedPath}${search}`;
}

function extractApiPath(urlOrPath = "") {
  const baseOrigin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : `http://${DEFAULT_API_HOST}:8020`;
  const parsed = new URL(String(urlOrPath || "/"), baseOrigin);
  const proxyBase = getBrowserProxyApiBaseUrl();
  const proxyPath = proxyBase ? new URL(proxyBase, baseOrigin).pathname.replace(/\/$/, "") : "";
  let pathname = parsed.pathname || "/";
  if (proxyPath && proxyPath !== "/" && (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`))) {
    pathname = pathname.slice(proxyPath.length) || "/";
    if (!pathname.startsWith("/")) {
      pathname = `/${pathname}`;
    }
  }
  return `${pathname}${parsed.search || ""}`;
}

async function fetchWithNetworkGuard(url, options = {}, fallbackMessage = "Unable to reach backend API") {
  const requestPath = extractApiPath(url);
  const candidateHosts = new Set([DEFAULT_API_HOST, "127.0.0.1", "localhost"]);
  const candidateBases = [];
  const proxyBase = getBrowserProxyApiBaseUrl();
  const dockerProxyOnly = proxyBase && shouldUseDockerProxyOnly();

  const pushBase = (base) => {
    if (!base || candidateBases.includes(base)) {
      return;
    }
    candidateBases.push(base);
  };

  if (dockerProxyOnly) {
    pushBase(proxyBase);
  } else {
    pushBase(proxyBase);
    pushBase(API_BASE_URL);
    pushBase(readStoredApiBaseUrl());
    pushBase(resolveConfiguredApiBaseUrl(import.meta.env.VITE_API_BASE_URL || ""));
    pushBase(resolveConfiguredApiBaseUrl(import.meta.env.VITE_API_PROXY_TARGET || ""));
    API_BASE_CANDIDATES.forEach(pushBase);

    candidateHosts.forEach((host) => {
      API_PORT_CANDIDATES.forEach((port) => {
        pushBase(`http://${host}:${port}`);
      });
    });
    pushBase(proxyBase);
  }

  let lastError = null;
  for (const baseUrl of candidateBases) {
    const resolved = buildCandidateUrl(baseUrl, requestPath);
    const timeoutMs = baseUrl === proxyBase ? API_PROXY_TIMEOUT_MS : API_REQUEST_TIMEOUT_MS;
    try {
      const response = await fetchWithTimeout(resolved, options, timeoutMs);
      if (baseUrl === proxyBase && response.status >= 500 && response.status < 600) {
        lastError = new Error(`Proxy returned ${response.status}`);
        continue;
      }
      rememberApiBaseUrl(baseUrl);
      return response;
    } catch (error) {
      lastError = error;
    }
  }

  const knownTargets = candidateBases.length ? candidateBases.join(", ") : API_BASE_URL;
  throw new Error(`${fallbackMessage}. Check that FastAPI is running on one of: ${knownTargets}. ${lastError?.message || ""}`.trim());
}

function readSettingsSnapshot() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_SNAPSHOT_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function writeSettingsSnapshot(snapshot) {
  if (typeof window === "undefined" || !snapshot) {
    return;
  }
  try {
    window.localStorage.setItem(SETTINGS_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (error) {
    // ignore storage issues
  }
}

function mergeSettingsSnapshot(partial) {
  const current = readSettingsSnapshot() || {};
  const next = {
    ...current,
    ...partial,
    profile: { ...(current.profile || {}), ...(partial.profile || {}) },
    preferences: { ...(current.preferences || {}), ...(partial.preferences || {}) },
    settings: { ...(current.settings || {}), ...(partial.settings || {}) },
    permissions: { ...(current.permissions || {}), ...(partial.permissions || {}) },
    environment_status: { ...(current.environment_status || {}), ...(partial.environment_status || {}) },
    model_registry: partial.model_registry || current.model_registry,
    audit_logs: partial.audit_logs || current.audit_logs || [],
    timestamp: partial.timestamp || current.timestamp,
  };
  writeSettingsSnapshot(next);
  return next;
}

export async function loginUser(email, password) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    },
    "Unable to sign in"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    const message =
      payload.detail ||
      (response.status === 401
        ? "Invalid email or password"
        : response.status === 403
          ? "Account is pending approval or disabled"
          : "Login failed");
    throw new Error(message);
  }
  rememberAuthSession(payload, email);
  return payload;
}

export async function registerUser(data) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/auth/signup`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    },
    "Unable to register account"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Registration failed");
  }
  return payload;
}

export async function refreshUserSession() {
  const refreshToken = safeLocalStorageGet(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    throw new Error("No refresh token available");
  }
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/auth/refresh`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken })
    },
    "Unable to refresh session"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    clearStoredAuthSession();
    throw new Error(payload.detail || "Session refresh failed");
  }
  rememberAuthSession(payload, payload?.user?.email || safeLocalStorageGet(EMAIL_KEY));
  return payload;
}

export async function logoutUser(token) {
  const refreshToken = safeLocalStorageGet(REFRESH_TOKEN_KEY);
  try {
    await fetchWithNetworkGuard(
      `${API_BASE_URL}/auth/logout`,
      {
        method: "POST",
        headers: buildHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {})
      },
      "Unable to log out cleanly"
    );
  } catch (error) {
    // ignore logout transport issues and clear local state anyway
  }
  clearStoredAuthSession();
  return { status: "ok" };
}

export async function getProfile(token) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/auth/me`,
    {
      headers: buildHeaders(token)
    },
    "Unable to load profile"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch profile");
  }
  return payload;
}

export async function updateProfile(token, profile) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/auth/me`,
    {
      method: "PUT",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(profile)
    },
    "Unable to update profile"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to update profile");
  }
  return payload;
}

export async function getStats(token) {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/stats`, {
    headers: buildHeaders(token)
  }, "Unable to load live stats");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch stats");
  }
  return payload;
}

export async function getDashboardSnapshot(token, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/dashboard/snapshot?${params.toString()}`, {
    headers: buildHeaders(token)
  }, "Unable to load dashboard snapshot");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch dashboard snapshot");
  }
  return payload;
}

export async function getObservabilityLogs(token, limit = 120) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/observability/logs?limit=${encodeURIComponent(limit)}`,
    { headers: buildHeaders(token) },
    "Unable to load observability logs"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch observability logs");
  }
  return payload;
}

export async function searchGlobal(token, query, limit = 6) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/search/global?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`,
    { headers: buildHeaders(token) },
    "Unable to search workspace"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to search workspace");
  }
  return payload;
}

export async function getTransactions(token, options = 25) {
  const params = new URLSearchParams();
  if (typeof options === "number") {
    params.set("limit", String(options));
    params.set("page_size", String(options));
  } else {
    Object.entries(options || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
      }
    });
  }
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/transactions?${params.toString()}`, {
    headers: buildHeaders(token)
  }, "Unable to load transactions");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch transactions");
  }
  return payload;
}

export async function getTransactionDetails(token, transactionId) {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/transactions/${encodeURIComponent(transactionId)}`, {
    headers: buildHeaders(token)
  }, "Unable to load transaction details");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch transaction details");
  }
  return payload;
}

export async function annotateTransactions(token, payload) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/transactions/annotate`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    },
    "Unable to annotate transactions"
  );
  const result = await readJson(response);
  if (!response.ok) {
    throw new Error(result.detail || "Unable to annotate transactions");
  }
  return result;
}

export async function bulkInvestigateTransactions(token, payload) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/transactions/bulk`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    },
    "Unable to run transaction bulk action"
  );
  const result = await readJson(response);
  if (!response.ok) {
    throw new Error(result.detail || "Unable to run transaction bulk action");
  }
  return result;
}

export async function saveTransactionView(token, payload) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/transactions/views`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    },
    "Unable to save transaction view"
  );
  const result = await readJson(response);
  if (!response.ok) {
    throw new Error(result.detail || "Unable to save transaction view");
  }
  return result;
}

export async function saveCasebook(token, payload) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/transactions/casebooks`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    },
    "Unable to save casebook"
  );
  const result = await readJson(response);
  if (!response.ok) {
    throw new Error(result.detail || "Unable to save casebook");
  }
  return result;
}

export async function compareTransactions(token, transactionIds) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/transactions/compare`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ transaction_ids: transactionIds })
    },
    "Unable to compare transactions"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to compare transactions");
  }
  return payload;
}

export async function getTransactionReport(token, transactionId, fileFormat = "case") {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/transactions/${encodeURIComponent(transactionId)}/report?file_format=${encodeURIComponent(fileFormat)}`,
    {
      headers: buildHeaders(token)
    },
    "Unable to generate transaction report"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to generate transaction report");
  }
  return payload;
}

export async function getAlerts(token, limit = 25) {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/alerts?limit=${limit}`, {
    headers: buildHeaders(token)
  }, "Unable to load alerts");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch alerts");
  }
  return payload;
}

export async function getAlertDetails(token, timestamp) {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/alerts/${encodeURIComponent(timestamp)}`, {
    headers: buildHeaders(token)
  }, "Unable to load alert details");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch alert details");
  }
  return payload;
}

export async function reviewAlert(token, timestamp) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/alerts/review`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ timestamp })
    },
    "Unable to review alert"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to review alert");
  }
  return payload;
}

export async function assignAlert(token, timestamp, assignedTo) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/alerts/assign`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ timestamp, assigned_to: assignedTo })
    },
    "Unable to assign alert"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to assign alert");
  }
  return payload;
}

export async function bulkUpdateAlerts(token, payload) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/alerts/bulk`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    },
    "Unable to update alerts"
  );
  const result = await readJson(response);
  if (!response.ok) {
    throw new Error(result.detail || "Unable to update alerts");
  }
  return result;
}

export async function addAlertNote(token, timestamp, note) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/alerts/notes`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ timestamp, note })
    },
    "Unable to add alert note"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to add alert note");
  }
  return payload;
}

export async function addAlertAttachment(token, timestamp, attachment) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/alerts/attachments`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ timestamp, attachment })
    },
    "Unable to add alert evidence"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to add alert evidence");
  }
  return payload;
}

export async function getNotifications(token, limit = 25) {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/notifications?limit=${limit}`, {
    headers: buildHeaders(token)
  }, "Unable to load notifications");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch notifications");
  }
  return payload;
}

export async function markNotificationsRead(token, notificationIds = []) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/notifications/read`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ notification_ids: notificationIds })
    },
    "Unable to update notifications"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to update notifications");
  }
  return payload;
}

export async function getAnalytics(token, model = "ensemble") {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/analytics?model=${encodeURIComponent(model)}`, {
    headers: buildHeaders(token)
  }, "Unable to load analytics");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch analytics");
  }
  return payload;
}

export async function getSettings(token) {
  try {
    const response = await fetchWithNetworkGuard(`${API_BASE_URL}/settings`, {
      headers: buildHeaders(token)
    }, "Unable to load settings");
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || "Unable to fetch settings");
    }
    mergeSettingsSnapshot(payload);
    return payload;
  } catch (error) {
    throw error;
  }
}

export async function updateSettings(token, settings) {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/settings`, {
    method: "POST",
    headers: buildHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(settings)
  }, "Unable to save platform settings");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to update settings");
  }
  mergeSettingsSnapshot(payload);
  return payload;
}

export async function updateSettingsProfile(token, profile) {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/settings/profile`, {
    method: "POST",
    headers: buildHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(profile)
  }, "Unable to save alert and profile preferences");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to update settings profile");
  }
  mergeSettingsSnapshot(payload);
  return payload;
}

export async function sendTestEmail(token, payload) {
  try {
    const response = await fetchWithNetworkGuard(`${API_BASE_URL}/settings/test-email`, {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {})
    }, "Unable to send test email");
    const result = await readJson(response);
    if (!response.ok) {
      throw new Error(result.detail || "Unable to send test email");
    }
    mergeSettingsSnapshot(result);
    return result;
  } catch (error) {
    throw new Error(error.message || "Unable to send test email");
  }
}

export async function getEnvironmentStatus(token) {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/settings/environment`, {
    headers: buildHeaders(token)
  }, "Unable to load environment status");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch environment status");
  }
  return payload;
}

export async function getTeamSettings(token) {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/settings/team`, {
    headers: buildHeaders(token)
  }, "Unable to load team settings");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch team settings");
  }
  return payload;
}

export async function updateTeamPermissions(token, userKey, permissions) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/settings/team/permissions`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ user_key: userKey, permissions })
    },
    "Unable to update team permissions"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to update team permissions");
  }
  return payload;
}

export async function predictTransaction(token, transaction) {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/predict`, {
    method: "POST",
    headers: buildHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(transaction)
  }, "Unable to score transaction");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to score transaction");
  }
  return payload;
}

export async function triggerRetrain(token) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/models/retrain`,
    {
      method: "POST",
      headers: buildHeaders(token)
    },
    "Unable to retrain models"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to retrain models");
  }
  return payload;
}

export async function getModelVersions(token) {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/models/versions`, {
    headers: buildHeaders(token)
  }, "Unable to load model versions");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch model versions");
  }
  return payload;
}

export async function getSchedulerStatus(token) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/models/scheduler-status`,
    {
      headers: buildHeaders(token)
    },
    "Unable to fetch scheduler status"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to fetch scheduler status");
  }
  return payload;
}

export async function runSchedulerCheck(token, force = false) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/models/scheduler/check`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ force })
    },
    "Unable to run scheduler check"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to run scheduler check");
  }
  return payload;
}

export async function rollbackModel(token, version) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/models/rollback`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ version })
    },
    "Unable to roll back model version"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to roll back model version");
  }
  return payload;
}

export async function listUsers(token) {
  const response = await fetchWithNetworkGuard(`${API_BASE_URL}/auth/users`, {
    headers: buildHeaders(token)
  }, "Unable to load users");
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to load users");
  }
  return payload;
}

export async function approveUser(token, userId, role = "VIEWER") {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/auth/users/${userId}/approve`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ role })
    },
    "Unable to approve user"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to approve user");
  }
  return payload;
}

export async function updateUserRole(token, userId, role) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/auth/users/${userId}/role`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ role })
    },
    "Unable to update role"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to update role");
  }
  return payload;
}

export async function updateUserStatus(token, userId, status) {
  const response = await fetchWithNetworkGuard(
    `${API_BASE_URL}/auth/users/${userId}/status`,
    {
      method: "POST",
      headers: buildHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ status })
    },
    "Unable to update status"
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to update status");
  }
  return payload;
}

export function createEventStream(token) {
  return new EventSource(`${API_BASE_URL}/stream?token=${encodeURIComponent(token)}`);
}

function getProxyApiBaseUrl() {
  if (typeof window === "undefined" || !window.location) {
    return "";
  }
  return getBrowserProxyApiBaseUrl();
}

async function resolveRealtimeApiBaseUrl() {
  const proxyBase = getProxyApiBaseUrl();
  if (proxyBase) {
    try {
      if (await probeApiBaseUrl(proxyBase, API_PROXY_TIMEOUT_MS)) {
        rememberApiBaseUrl(proxyBase);
        return proxyBase;
      }
      throw new Error("Proxy health check failed");
    } catch (error) {
      // fall back to discovered API host
    }
  }
  await fetchWithNetworkGuard(`http://${DEFAULT_API_HOST}:8020/healthz`, {}, "Unable to reach realtime API");
  return API_BASE_URL;
}

export function createRealtimeClient(token, handlers = {}) {
  const {
    onEvent = () => {},
    onStatus = () => {},
  } = handlers;
  let eventSource = null;
  let stopped = false;

  const notify = (status, transport, detail = "") => {
    onStatus({
      status,
      transport,
      detail,
      timestamp: new Date().toISOString(),
    });
  };

  const emit = (payload, transport) => {
    onEvent({
      transport,
      payload,
    });
  };

  const startSse = (baseUrl, detail = "Using SSE live stream") => {
    if (stopped) {
      return;
    }
    notify("connecting", "sse", detail);
    eventSource = new EventSource(`${baseUrl}/stream?token=${encodeURIComponent(token)}`);
    const handlePayload = (event) => {
      if (!event?.data) {
        return;
      }
      try {
        emit(JSON.parse(event.data), "sse");
      } catch (error) {
        notify("degraded", "sse", "Unreadable SSE payload");
      }
    };
    eventSource.addEventListener("transaction", handlePayload);
    eventSource.addEventListener("warning", handlePayload);
    eventSource.addEventListener("waiting", handlePayload);
    eventSource.onmessage = handlePayload;
    eventSource.onopen = () => notify("connected", "sse", "Live stream connected");
    eventSource.onerror = () => notify("disconnected", "sse", "Realtime stream disconnected");
  };

  (async () => {
    try {
      const baseUrl = await resolveRealtimeApiBaseUrl();
      if (stopped) {
        return;
      }
      startSse(baseUrl, "Using SSE live stream");
    } catch (error) {
      const fallbackBase = API_BASE_URL;
      if (!stopped && !eventSource) {
        startSse(fallbackBase, "Using SSE live stream");
      }
    }
  })();

  return {
    close() {
      stopped = true;
      try {
        eventSource?.close();
      } catch (error) {
        // ignore
      }
    }
  };
}
