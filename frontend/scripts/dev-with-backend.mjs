import http from "node:http";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, "..");
const projectDir = path.resolve(frontendDir, "..");

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
const HEALTH_TIMEOUT_MS = 1000;
const BACKEND_BOOT_TIMEOUT_MS = 60000;
const HEALTH_POLL_INTERVAL_MS = 750;

function getPositionalCliArgs() {
  return process.argv.slice(2).filter((value) => value && !value.startsWith("-"));
}

function log(message) {
  console.log(`[paywatch-dev] ${message}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCliOption(flag, defaultValue = "") {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === flag && index + 1 < args.length) {
      return args[index + 1];
    }
    if (value.startsWith(`${flag}=`)) {
      return value.slice(flag.length + 1);
    }
  }
  return defaultValue;
}

function getFrontendHostArg() {
  const positionalArgs = getPositionalCliArgs();
  return positionalArgs.find((value) => !/^\d+$/.test(value)) || "";
}

function getFrontendPortArg() {
  const positionalArgs = getPositionalCliArgs();
  return positionalArgs.find((value) => /^\d+$/.test(value)) || "";
}

function buildViteArgs(frontendHost, frontendPort) {
  const originalArgs = process.argv.slice(2);
  const viteArgs = [];

  for (let index = 0; index < originalArgs.length; index += 1) {
    const value = originalArgs[index];

    if (value === "--host" || value === "--port") {
      index += 1;
      continue;
    }

    if (value.startsWith("--host=") || value.startsWith("--port=")) {
      continue;
    }

    if (!value.startsWith("-")) {
      continue;
    }

    viteArgs.push(value);
  }

  viteArgs.push("--host", frontendHost);
  viteArgs.push("--port", String(frontendPort));
  return viteArgs;
}

function resolvePythonExecutable() {
  const candidates = [
    path.join(projectDir, ".venv", "Scripts", "python.exe"),
    path.join(projectDir, ".venv", "bin", "python"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === "win32" ? "python" : "python3";
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

function normalizeApiTarget(value = "") {
  const next = String(value || "").trim().replace(/\/$/, "");
  if (!next) {
    return "";
  }
  if (/^https?:\/\//i.test(next)) {
    return next;
  }
  return `http://${next}`;
}

function targetToUrl(target) {
  const normalized = normalizeApiTarget(target);
  return normalized ? new URL(normalized) : null;
}

function requestHealth(target, pathName) {
  const targetUrl = targetToUrl(target);
  if (!targetUrl) {
    return Promise.resolve(false);
  }

  const basePath = (targetUrl.pathname || "").replace(/\/$/, "");
  const requestPath = `${basePath}${pathName}`.replace(/\/{2,}/g, "/");

  return new Promise((resolve) => {
    const request = http.get(
      {
        host: targetUrl.hostname,
        port: targetUrl.port || 80,
        path: requestPath,
        timeout: HEALTH_TIMEOUT_MS,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (body.length < 4096) {
            body += chunk;
          }
        });
        response.on("end", () => resolve(responseMatchesPayWatch(response.statusCode, body)));
      }
    );

    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });

    request.on("error", () => resolve(false));
  });
}

async function probePayWatch(target) {
  for (const pathName of API_HEALTH_PATH_CANDIDATES) {
    if (await requestHealth(target, pathName)) {
      return true;
    }
  }
  return false;
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, "127.0.0.1");
  });
}

function killProcessTree(child) {
  if (!child?.pid) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => {});
    return;
  }

  try {
    child.kill("SIGTERM");
  } catch (error) {
    // ignore kill failures
  }
}

async function waitForBackend(target, child = null) {
  const startTime = Date.now();
  while (Date.now() - startTime < BACKEND_BOOT_TIMEOUT_MS) {
    if (await probePayWatch(target)) {
      return true;
    }
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      return false;
    }
    await wait(HEALTH_POLL_INTERVAL_MS);
  }
  return false;
}

function buildBackendEnv() {
  return {
    ...process.env,
    REDIS_HOST: "127.0.0.1",
    REDIS_PORT: "6379",
    PAYWATCH_REDIS_REQUIRED: "false",
    PAYWATCH_KAFKA_ENABLED: "false",
    PAYWATCH_KAFKA_REQUIRED: "false",
    PAYWATCH_KAFKA_BOOTSTRAP_SERVERS: "127.0.0.1:9092",
    PAYWATCH_KAFKA_TOPIC: "paywatch-transactions",
    PAYWATCH_STREAM_SOURCE: "local",
  };
}

async function ensureBackend() {
  for (const port of API_PORT_CANDIDATES) {
    const target = `http://127.0.0.1:${port}`;
    if (await probePayWatch(target)) {
      log(`Using existing backend on ${target}`);
      return { target, child: null };
    }
  }

  for (const target of API_BASE_CANDIDATES) {
    if (await probePayWatch(target)) {
      log(`Using existing backend via ${target}`);
      return { target, child: null };
    }
  }

  const pythonExecutable = resolvePythonExecutable();
  for (const port of API_PORT_CANDIDATES) {
    if (!(await isPortAvailable(port))) {
      continue;
    }

    log(`Starting backend on http://127.0.0.1:${port}`);
    const target = `http://127.0.0.1:${port}`;
    const child = spawn(
      pythonExecutable,
      ["-m", "uvicorn", "api.app:app", "--host", "127.0.0.1", "--port", String(port)],
      {
        cwd: projectDir,
        stdio: "inherit",
        env: buildBackendEnv(),
        windowsHide: false,
      }
    );

    const ready = await waitForBackend(target, child);
    if (ready) {
      log(`Backend is ready on ${target}`);
      return { target, child };
    }

    log(`Backend failed to become ready on port ${port}`);
    killProcessTree(child);
  }

  throw new Error("FastAPI could not be started on any known local port.");
}

async function main() {
  const backend = await ensureBackend();
  const frontendHost = getCliOption("--host", getFrontendHostArg() || "127.0.0.1");
  const frontendPort = getCliOption("--port", getFrontendPortArg() || process.env.PORT || process.env.VITE_PORT || "3015");
  const browserHost = frontendHost === "0.0.0.0" ? "127.0.0.1" : frontendHost;

  const viteEnv = {
    ...process.env,
    PAYWATCH_FRONTEND_URL: `http://${browserHost}:${frontendPort}`,
    VITE_API_PROXY_TARGET: backend.target,
    VITE_API_BASE_URL: "/api",
  };

  const viteBin = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");
  const vite = spawn(process.execPath, [viteBin, ...buildViteArgs(frontendHost, frontendPort)], {
    cwd: frontendDir,
    stdio: "inherit",
    env: viteEnv,
    windowsHide: false,
  });

  const shutdown = (exitCode = 0) => {
    if (backend.child) {
      killProcessTree(backend.child);
    }
    process.exit(exitCode);
  };

  process.on("SIGINT", () => {
    vite.kill("SIGINT");
    shutdown(0);
  });

  process.on("SIGTERM", () => {
    vite.kill("SIGTERM");
    shutdown(0);
  });

  vite.on("exit", (code) => {
    shutdown(code ?? 0);
  });
}

main().catch((error) => {
  console.error(`[paywatch-dev] ${error.message}`);
  process.exit(1);
});
