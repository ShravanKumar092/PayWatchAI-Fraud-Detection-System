import http from "node:http";
import https from "node:https";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_BASE_CANDIDATES = [
  "http://127.0.0.1:8021",
  "http://localhost:8021",
  "http://127.0.0.1:8020",
  "http://localhost:8020",
  "http://127.0.0.1:8080/api",
  "http://localhost:8080/api",
  "http://127.0.0.1:3014/api",
  "http://localhost:3014/api",
  "http://127.0.0.1:3000/api",
  "http://localhost:3000/api",
];
const API_PORT_CANDIDATES = [8021, 8020, 8010, 8000];
const API_HEALTH_PATH_CANDIDATES = ["/healthz", "/health"];
const API_PROBE_TIMEOUT_MS = 800;
const TARGET_REFRESH_INTERVAL_MS = 2000;

function normalizeProxyTarget(value = "") {
  const next = String(value || "").trim().replace(/\/$/, "");
  if (!next || next.startsWith("/")) {
    return "";
  }
  if (/^https?:\/\//i.test(next)) {
    return next;
  }
  return `http://${next}`;
}

function stripApiSuffix(value = "") {
  const normalized = normalizeProxyTarget(value);
  if (!normalized) {
    return "";
  }
  try {
    const url = new URL(normalized);
    const pathname = (url.pathname || "").replace(/\/$/, "");
    if (pathname === "/api") {
      url.pathname = "";
      return url.toString().replace(/\/$/, "");
    }
    return normalized;
  } catch (error) {
    return normalized.replace(/\/api$/i, "");
  }
}

function responseMatchesPayWatch(statusCode, bodyText = "") {
  if (!statusCode || statusCode < 200 || statusCode >= 300) {
    return false;
  }

  try {
    const payload = JSON.parse(bodyText || "{}");
    return payload?.status === "UP" && String(payload?.service || "").includes("PayWatch AI Fraud API");
  } catch (error) {
    return false;
  }
}

function probeTarget(target) {
  const normalizedTarget = normalizeProxyTarget(target);
  if (!normalizedTarget) {
    return Promise.resolve("");
  }

  const targetUrl = new URL(normalizedTarget);
  const transport = targetUrl.protocol === "https:" ? https : http;
  const targetPathPrefix = (targetUrl.pathname || "").replace(/\/$/, "");

  return new Promise((resolve) => {
    const tryPath = (index) => {
      if (index >= API_HEALTH_PATH_CANDIDATES.length) {
        resolve("");
        return;
      }

      const request = transport.get(
        {
          protocol: targetUrl.protocol,
          host: targetUrl.hostname,
          port: targetUrl.port,
          path: `${targetPathPrefix}${API_HEALTH_PATH_CANDIDATES[index]}`.replace(/\/{2,}/g, "/"),
          timeout: API_PROBE_TIMEOUT_MS,
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            if (body.length < 4096) {
              body += chunk;
            }
          });
          response.on("end", () => {
            if (responseMatchesPayWatch(response.statusCode, body)) {
              resolve(normalizedTarget);
              return;
            }
            tryPath(index + 1);
          });
        }
      );

      request.on("timeout", () => {
        request.destroy();
        tryPath(index + 1);
      });
      request.on("error", () => tryPath(index + 1));
    };

    tryPath(0);
  });
}

function buildTargetCandidates(preferredTarget = "") {
  const candidates = [];

  const pushTarget = (value = "") => {
    const normalizedTarget = normalizeProxyTarget(value);
    if (!normalizedTarget || candidates.includes(normalizedTarget)) {
      return;
    }
    candidates.push(normalizedTarget);
  };

  pushTarget(preferredTarget);
  pushTarget(process.env.VITE_API_PROXY_TARGET || "");
  pushTarget(process.env.VITE_API_BASE_URL || "");
  API_BASE_CANDIDATES.forEach(pushTarget);

  for (const host of ["127.0.0.1", "localhost"]) {
    for (const port of API_PORT_CANDIDATES) {
      pushTarget(`http://${host}:${port}`);
    }
  }

  return candidates;
}

async function resolveApiProxyTarget(preferredTarget = "") {
  const candidates = buildTargetCandidates(preferredTarget);
  for (const candidate of candidates) {
    const healthyTarget = await probeTarget(candidate);
    if (healthyTarget) {
      return healthyTarget;
    }
  }

  return candidates[0] || "http://127.0.0.1:8020";
}

function createTargetState(initialTarget) {
  let currentTarget = initialTarget;
  let refreshPromise = null;
  const listeners = new Set();

  const notify = (nextTarget) => {
    listeners.forEach((listener) => listener(nextTarget));
  };

  return {
    get() {
      return currentTarget;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refresh(force = false) {
      if (!force && refreshPromise) {
        return refreshPromise;
      }

      refreshPromise = resolveApiProxyTarget(currentTarget)
        .then((nextTarget) => {
          if (nextTarget && nextTarget !== currentTarget) {
            currentTarget = nextTarget;
            notify(currentTarget);
          } else if (!currentTarget && nextTarget) {
            currentTarget = nextTarget;
          }
          return currentTarget;
        })
        .finally(() => {
          refreshPromise = null;
        });

      return refreshPromise;
    },
  };
}

function createMirroredTargetState(sourceState, mapper) {
  let currentTarget = mapper(sourceState.get());
  const listeners = new Set();

  sourceState.subscribe((nextTarget) => {
    const mappedTarget = mapper(nextTarget);
    if (mappedTarget && mappedTarget !== currentTarget) {
      currentTarget = mappedTarget;
      listeners.forEach((listener) => listener(currentTarget));
    }
  });

  return {
    get() {
      return currentTarget;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refresh(force = false) {
      await sourceState.refresh(force);
      const mappedTarget = mapper(sourceState.get());
      if (mappedTarget && mappedTarget !== currentTarget) {
        currentTarget = mappedTarget;
        listeners.forEach((listener) => listener(currentTarget));
      }
      return currentTarget;
    },
  };
}

function attachSelfHealingProxy(proxy, options, targetState) {
  const syncTarget = (nextTarget) => {
    if (nextTarget) {
      options.target = nextTarget;
    }
  };

  syncTarget(targetState.get());
  targetState.subscribe(syncTarget);

  proxy.on("error", () => {
    void targetState.refresh(true);
  });

  proxy.on("proxyReq", () => {
    syncTarget(targetState.get());
  });

  proxy.on("proxyRes", (proxyRes) => {
    if (proxyRes?.statusCode >= 500) {
      void targetState.refresh(true);
    }
  });
}

export default defineConfig(async () => {
  const apiProxyTarget = await resolveApiProxyTarget();
  const apiTargetState = createTargetState(apiProxyTarget);
  const rootTargetState = createMirroredTargetState(apiTargetState, stripApiSuffix);
  const frontendPort = Number.parseInt(process.env.PORT || process.env.VITE_PORT || "3015", 10);
  const refreshTimer = setInterval(() => {
    void apiTargetState.refresh();
  }, TARGET_REFRESH_INTERVAL_MS);

  if (typeof refreshTimer.unref === "function") {
    refreshTimer.unref();
  }

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: Number.isFinite(frontendPort) ? frontendPort : 3015,
      strictPort: true,
      proxy: {
        "^/api(/.*)?$": {
          target: apiTargetState.get(),
          changeOrigin: true,
          ws: true,
          proxyTimeout: 2000,
          timeout: 2000,
          rewrite: (path) => path.replace(/^\/api/, ""),
          configure: (proxy, options) => attachSelfHealingProxy(proxy, options, apiTargetState),
        },
        "^/(stream|ws|health|healthz|ready|metrics)(/.*)?$": {
          target: rootTargetState.get(),
          changeOrigin: true,
          ws: true,
          proxyTimeout: 2000,
          timeout: 2000,
          configure: (proxy, options) => attachSelfHealingProxy(proxy, options, rootTargetState),
        },
      },
    },
  };
});
