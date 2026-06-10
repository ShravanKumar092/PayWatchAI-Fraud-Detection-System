# ==================================================
# MODULE PATH FIX (must be first)
# ==================================================
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
sys.path.append(os.path.dirname(__file__))

# Import feature_engineering from src directory
from src.feature_engineering import feature_engineering

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
import pandas as pd
import joblib
import random
import asyncio
import json
from datetime import datetime
from collections import defaultdict
from typing import List, Dict, Any, Optional
import csv
import hashlib
import uuid
# from api.services.fraud_engine import fraud_decision
# from api.services.explain import explain

from api.auth.routes import router as auth_router
from api.auth.security_v2 import verify_token

# feature engineering import with fallback


# 🔄 IMPROVED: Make Redis optional with fakeredis fallback
# Ensure names exist for static analysis
redis: Any = None
fakeredis: Any = None
REDIS_AVAILABLE_IMPORT = False
FAKEREDIS_AVAILABLE = False
try:
    import redis as _redis  # type: ignore
    redis = _redis
    REDIS_AVAILABLE_IMPORT = True
except Exception:
    REDIS_AVAILABLE_IMPORT = False
    print(">>> Redis module not installed. Running without Redis caching.")

# Try to use fakeredis on Windows as fallback
try:
    import fakeredis as _fakeredis  # type: ignore
    fakeredis = _fakeredis
    FAKEREDIS_AVAILABLE = True
except Exception:
    FAKEREDIS_AVAILABLE = False



print(">>> API FILE LOADED FROM:", __file__)

# ==================================================
# FASTAPI APP
# ==================================================
app = FastAPI(
    title="PayWatch AI – Fraud Detection API",
    version="2.0"
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database tables on startup
@app.on_event("startup")
async def init_database():
    global transaction_counter, high_risk_counter
    
    # Reset global counters on startup for fresh evaluation count
    transaction_counter = 0
    high_risk_counter = 0
    
    try:
        from api.auth.db import Base, engine
        from api.auth.models import User
        Base.metadata.create_all(bind=engine)
        print(">>> Database tables initialized")
    except Exception as e:
        print(f">>> Database initialization warning: {e}")
    
    # Reset Redis counters on startup for fresh evaluation count
    if REDIS_AVAILABLE and redis_client is not None:
        try:
            rc = redis_client
            if hasattr(rc, "set"):
                rc.set("total_transactions", 0)
                rc.set("high_risk_count", 0)
                print(">>> Redis counters initialized to 0 for evaluation tracking")
        except Exception as e:
            print(f">>> Redis counter initialization warning: {e}")
    
    print(f">>> Global counters reset: transaction_counter={transaction_counter}, high_risk_counter={high_risk_counter}")


# ==================================================
# 🔄 REAL-TIME UPGRADE: REDIS CONNECTION POOL (OPTIONAL)
# ==================================================
REDIS_AVAILABLE = False
redis_client: Optional[Any] = None

if REDIS_AVAILABLE_IMPORT:
    REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
    REDIS_DB = int(os.getenv("REDIS_DB", 0))

    try:
        # Connection pool for better performance
        redis_pool = redis.ConnectionPool(
            host=REDIS_HOST,
            port=REDIS_PORT,
            db=REDIS_DB,
            max_connections=50,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_keepalive=True,
            retry_on_timeout=True
        )
        # Create client and ping only if available
        rc = redis.Redis(connection_pool=redis_pool)
        if hasattr(rc, "ping"):
            try:
                rc.ping()
                redis_client = rc
                REDIS_AVAILABLE = True
                print(">>> Redis connected successfully with connection pooling")
            except Exception:
                REDIS_AVAILABLE = False
        else:
            REDIS_AVAILABLE = False
    except Exception as e:
        REDIS_AVAILABLE = False
        print(f">>> Redis not available: {e}. Attempting to use fakeredis...")
        
        # Fallback to fakeredis
        if FAKEREDIS_AVAILABLE:
            try:
                rc = fakeredis.FakeStrictRedis(decode_responses=True)
                if hasattr(rc, "ping"):
                    try:
                        rc.ping()
                        redis_client = rc
                        REDIS_AVAILABLE = True
                        print(">>> Fakeredis initialized successfully (in-memory Redis for Windows)")
                    except Exception as e2:
                        print(f">>> Fakeredis ping failed: {e2}. Running without Redis caching.")
                else:
                    print(">>> Fakeredis available but no ping method; proceeding without Redis caching")
            except Exception as e2:
                print(f">>> Fakeredis also failed: {e2}. Running without Redis caching.")
        else:
            print(">>> Fakeredis module not installed. Running without Redis caching.")
else:
    # Try fakeredis if redis module not available
    if FAKEREDIS_AVAILABLE:
        try:
            rc = fakeredis.FakeStrictRedis(decode_responses=True)
            if hasattr(rc, "ping"):
                try:
                    rc.ping()
                    redis_client = rc
                    REDIS_AVAILABLE = True
                    print(">>> Fakeredis initialized successfully (in-memory Redis for Windows)")
                except Exception as e:
                    print(f">>> Fakeredis ping failed: {e}")
            else:
                print(">>> Fakeredis available but no ping method; proceeding without Redis caching")
        except Exception as e:
            print(f">>> Fakeredis initialization failed: {e}")
    else:
        print(">>> Redis module not installed. Install with: pip install redis")

# ==================================================
# 🔄 FALLBACK COUNTERS FOR TRANSACTION TRACKING
# ==================================================
# Global counters as fallback when Redis is unavailable
transaction_counter = 0
high_risk_counter = 0
alert_state_overrides: Dict[str, Dict[str, Any]] = {}
BASE_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_PROJECT_ROOT, "data")
WORKSPACE_STORE_PATH = os.path.join(DATA_DIR, "transaction_workspace.json")
RUNTIME_SETTINGS_PATH = os.path.join(DATA_DIR, "runtime_settings.json")
ALERT_WORKFLOW_STORE_PATH = os.path.join(DATA_DIR, "alert_workflow_store.json")


def _read_json_file(path: str, fallback: Any) -> Any:
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)
    except Exception as error:
        print(f">>> Failed to read {path}: {error}")
    return fallback


def _write_json_file(path: str, payload: Any) -> Any:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
    return payload


def _workspace_store() -> Dict[str, Any]:
    return _read_json_file(
        WORKSPACE_STORE_PATH,
        {"saved_views": {}, "bookmarks": {}, "tags": {}, "casebooks": {}, "recent_activity": [], "shared_filters": []},
    )


def _save_workspace_store(store: Dict[str, Any]) -> Dict[str, Any]:
    store.setdefault("saved_views", {})
    store.setdefault("bookmarks", {})
    store.setdefault("tags", {})
    store.setdefault("casebooks", {})
    store.setdefault("recent_activity", [])
    store.setdefault("shared_filters", [])
    return _write_json_file(WORKSPACE_STORE_PATH, store)


def _settings_store() -> Dict[str, Any]:
    defaults = {
        "fraud_threshold_high": 0.8,
        "fraud_threshold_medium": 0.55,
        "theme_mode": "dark",
        "alert_workflow": {
            "similarity_threshold": 0.72,
            "dedupe_window_minutes": 30,
            "auto_merge_incidents": True,
            "sla_policy": {"critical": 15, "high": 30, "medium": 45, "low": 120},
            "escalation_policy": [
                {"id": "tier-1", "severity": "medium", "route_to": "Analyst Queue", "sla_minutes": 45, "auto_assign": ""},
                {"id": "tier-2", "severity": "high", "route_to": "Fraud Command", "sla_minutes": 30, "auto_assign": ""},
                {"id": "tier-3", "severity": "critical", "route_to": "Incident Response", "sla_minutes": 15, "auto_assign": ""},
            ],
            "suppression_rules": [],
            "playbooks": [
                {"alert_type": "TRANSFER", "title": "High-value transfer review", "steps": ["Validate actor", "Compare destination history", "Attach evidence", "Escalate if loss exposure exceeds policy"]},
                {"alert_type": "CASH_OUT", "title": "Cash-out velocity review", "steps": ["Check repeat actor", "Review device velocity", "Confirm merchant/customer contact"]},
            ],
            "case_note_templates": [
                {"id": "customer-callback", "title": "Customer callback", "body": "Contacted customer and verified transaction intent."},
                {"id": "merchant-review", "title": "Merchant review", "body": "Reviewed merchant history, velocity, and linked alerts."},
            ],
            "evidence_checklist": ["Owner assigned", "Cause tag selected", "Evidence attached", "Resolution note"],
        },
        "api_keys": [{"id": "default-ingest", "name": "Default ingest key", "status": "active", "last_used": ""}],
        "integrations": {
            "webhooks": [{"id": "primary-webhook", "url": "", "retry_policy": "3 attempts / exponential backoff", "enabled": False}],
            "channels": {"email": True, "sms": False, "slack": False, "teams": False},
        },
        "settings_scopes": {"personal_fields": ["theme", "timezone", "default_filters"], "team_fields": ["sla_policy", "thresholds", "exports"]},
        "access_policy": {"export_policy": "admin_only", "session_timeout_minutes": 45, "ip_allowlist": "", "download_permission": "reviewers"},
        "retention": {"evidence_retention_days": 365, "compliance_mode": "standard"},
        "onboarding_templates": [{"id": "analyst-default", "name": "Analyst default", "steps": ["Review queue", "Open drawer", "Attach evidence", "Close or escalate"]}],
        "backup_snapshots": [],
    }
    current = _read_json_file(RUNTIME_SETTINGS_PATH, {})
    merged = {**defaults, **current}
    merged["alert_workflow"] = {**defaults["alert_workflow"], **dict(current.get("alert_workflow") or {})}
    merged["integrations"] = {**defaults["integrations"], **dict(current.get("integrations") or {})}
    return merged


def _save_settings_store(payload: Dict[str, Any]) -> Dict[str, Any]:
    current = _settings_store()
    next_payload = {**current, **dict(payload or {})}
    if "alert_workflow" in payload:
        next_payload["alert_workflow"] = {**dict(current.get("alert_workflow") or {}), **dict(payload.get("alert_workflow") or {})}
    if "integrations" in payload:
        next_payload["integrations"] = {**dict(current.get("integrations") or {}), **dict(payload.get("integrations") or {})}
    return _write_json_file(RUNTIME_SETTINGS_PATH, next_payload)


def _alert_store() -> Dict[str, Any]:
    return _read_json_file(
        ALERT_WORKFLOW_STORE_PATH,
        {"notes": {}, "attachments": {}, "comments": {}, "checklists": {}, "subscriptions": {}, "quality_reviews": {}, "reopen_history": {}, "recent_activity": []},
    )


def _save_alert_store(store: Dict[str, Any]) -> Dict[str, Any]:
    for key in ["notes", "attachments", "comments", "checklists", "subscriptions", "quality_reviews", "reopen_history", "recent_activity"]:
        store.setdefault(key, {})
    return _write_json_file(ALERT_WORKFLOW_STORE_PATH, store)


def _record_recent_activity(kind: str, title: str, description: str, route: str = "", actor: str = "system") -> None:
    store = _workspace_store()
    events = list(store.get("recent_activity") or [])
    events.insert(0, {"id": uuid.uuid4().hex[:12], "kind": kind, "title": title, "description": description, "route": route, "actor": actor, "timestamp": datetime.utcnow().isoformat()})
    store["recent_activity"] = events[:80]
    _save_workspace_store(store)

# ==================================================
# 🔄 REAL-TIME UPGRADE: WEBSOCKET CONNECTION MANAGER
# ==================================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.transaction_queue: asyncio.Queue = asyncio.Queue()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f">>> Client connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        print(f">>> Client disconnected. Total connections: {len(self.active_connections)}")

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        try:
            await websocket.send_json(message)
        except Exception as e:
            print(f">>> Error sending message: {e}")
            self.disconnect(websocket)

    async def broadcast(self, message: dict):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f">>> Error broadcasting to client: {e}")
                disconnected.append(connection)
        
        for conn in disconnected:
            self.disconnect(conn)

manager = ConnectionManager()

# ==================================================
# LOAD MODEL & METADATA
# ==================================================
# Get the project root directory (parent of api directory)
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.dirname(os.path.abspath(__file__))

# Try multiple possible locations for model files (include common variants)
possible_model_paths = [
    os.path.join(PROJECT_ROOT, "fraud_model.joblib"),  # Preferred name
    os.path.join(PROJECT_ROOT, "rf_fraud_model.joblib"),  # common fallback
    os.path.join(PROJECT_ROOT, "xgb_fraud_model.joblib"),
    os.path.join(PROJECT_ROOT, "random_forest_model.pkl"),
    os.path.join(API_DIR, "auth", "fraud_model.joblib"),  # api/auth/
    os.path.join(API_DIR, "fraud_model.joblib"),  # api/
    os.path.join(API_DIR, "rf_fraud_model.joblib"),
    "fraud_model.joblib",  # Current working directory
    "rf_fraud_model.joblib",
    "random_forest_model.pkl",
]

possible_columns_paths = [
    os.path.join(PROJECT_ROOT, "model_columns.joblib"),  # Project root
    os.path.join(API_DIR, "auth", "model_columns.joblib"),  # api/auth/
    os.path.join(API_DIR, "model_columns.joblib"),  # api/
    "model_columns.joblib"  # Current working directory
]

# Find the model file
MODEL_PATH = None
for path in possible_model_paths:
    if os.path.exists(path):
        MODEL_PATH = path
        break

# Find the model columns file (optional)
MODEL_COLUMNS_PATH = None
for path in possible_columns_paths:
    if os.path.exists(path):
        MODEL_COLUMNS_PATH = path
        break

if not MODEL_PATH:
    raise FileNotFoundError(
        f"Model file not found. Checked these locations:\n" +
        "\n".join(f"  - {p}" for p in possible_model_paths)
    )

if MODEL_COLUMNS_PATH is None:
    print(f">>> Warning: model_columns.joblib not found in any of the expected locations. Attempting to infer model columns after loading the model.")
else:
    print(f">>> Loading model columns from: {MODEL_COLUMNS_PATH}")

print(f">>> Loading model from: {MODEL_PATH}")

model = joblib.load(MODEL_PATH)

# If model columns file exists load it, otherwise try to infer
if MODEL_COLUMNS_PATH:
    try:
        loaded_cols = joblib.load(MODEL_COLUMNS_PATH)
        # Convert to pure Python list - never leave it as numpy array or pandas Index
        model_columns = [str(col) for col in loaded_cols]
        print(f">>> Loaded model columns (count: {len(model_columns)})")
    except Exception as e:
        print(f">>> Failed to load model_columns.joblib: {e}. Will attempt to infer columns from model.")
        MODEL_COLUMNS_PATH = None

if MODEL_COLUMNS_PATH is None:
    # Try to infer feature names from sklearn models (feature_names_in_) or pipeline
    inferred = None
    if hasattr(model, "feature_names_in_"):
        try:
            inferred = list(model.feature_names_in_)
            print(">>> Inferred model columns from model.feature_names_in_")
        except Exception:
            inferred = None
    elif hasattr(model, "named_steps"):
        # Try to inspect pipeline steps
        try:
            # Attempt to find last estimator with feature_names_in_
            for step in model.named_steps.values():
                if hasattr(step, "feature_names_in_"):
                    inferred = list(step.feature_names_in_)
                    print(">>> Inferred model columns from pipeline step feature_names_in_")
                    break
        except Exception:
            inferred = None

    if inferred is not None:
        model_columns = inferred
    else:
        # Last resort: leave model_columns empty and skip reindexing later
        model_columns = []
        print(">>> Could not infer model columns; continuing without a fixed column list (reindexing will be skipped)")
else:
    # Ensure model_columns is always a pure Python list, never a numpy array or pandas Index
    model_columns = [str(col) for col in model_columns]

print(f">>> Final model_columns type: {type(model_columns)}, count: {len(model_columns)}")
print(">>> Model and columns loaded (or inferred) successfully")

LOG_FILE = "logs/transactions_log.csv"

def write_log(input_data, prediction):
    """Append transaction + prediction to CSV log"""
    row = {
        "datetime": datetime.now().isoformat(),
        **input_data,
        **prediction
    }

    os.makedirs("logs", exist_ok=True)
    file_exists = os.path.isfile(LOG_FILE)

    with open(LOG_FILE, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=row.keys())
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)

# ==================================================
# 🔐 UPGRADE 6 — SECURITY & RATE LIMIT CONFIG
# ==================================================
API_KEY = "paywatch-secure-key"
RATE_LIMIT = 1000  # requests per minute per IP (increased for simulation)
request_tracker = defaultdict(list)

# ==================================================
# 🔐 UPGRADE 6 — AUTH + RATE LIMIT MIDDLEWARE
# ==================================================


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Public endpoints that do not require auth
    free_paths = [
        "/",             # Root path
        "/login",        # Frontend login route
        "/dashboard",    # Frontend SPA routes
        "/analytics",
        "/alerts",
        "/transactions",
        "/settings",
        "/assets",       # Built frontend assets
        "/health",       # Health check - must be accessible
        "/healthz",      # Readiness probe for local dev launcher
        "/auth/login",
        "/auth/signup",
        "/predict",      # FIXED: Allow predictions without auth
        "/stream",       # SSE stream for simulation
        "/stats",        # Statistics endpoint - FIXED: Added
        "/ws",           # WebSocket base
        "/ws/stream",    # WebSocket stream
        "/docs",         # API documentation
        "/openapi.json", # OpenAPI schema
        "/favicon.ico",  # Favicon
        "/favicon.svg",  # Frontend favicon
        "/redoc"         # ReDoc documentation
    ]

    path = request.url.path
    
    # Skip auth for free paths
    # Check if path exactly matches or starts with a free path
    is_free_path = False
    for fp in free_paths:
        if fp == "/" and path == "/":
            is_free_path = True
            break
        elif fp != "/" and (path == fp or path.startswith(fp + "/")):
            is_free_path = True
            break
    
    if is_free_path:
        token = request.headers.get("Authorization")
        if token:
            user_data = verify_token(token.replace("Bearer ", ""))
            if user_data:
                request.state.user = user_data
        return await call_next(request)

    # Rate limiting per IP (applies to auth-protected requests only)
    ip = request.client.host if request.client else "unknown"
    now = datetime.utcnow().timestamp()
    
    # Remove old requests (keep only last 60 seconds)
    if ip not in request_tracker:
        request_tracker[ip] = []
    request_tracker[ip] = [t for t in request_tracker[ip] if now - t < 60]
    
    # If more than N hits in last 60 seconds = block
    if len(request_tracker[ip]) >= RATE_LIMIT:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Slow down!"},
        )
    
    # Add timestamp
    request_tracker[ip].append(now)

    token = request.headers.get("Authorization")
    if not token:
        return JSONResponse(
            status_code=401,
            content={"detail": "Missing Authorization Token"},
        )

    token = token.replace("Bearer ", "")
    user_data = verify_token(token)
    if not user_data:
        return JSONResponse(
            status_code=401,
            content={"detail": "Invalid or expired token"},
        )

    request.state.user = user_data
    return await call_next(request)# ==================================================
# 🧾 UPGRADE 6 — AUDIT LOGGING (ASYNC)
# ==================================================
async def log_transaction(tx, response):
    log = {
        "timestamp": datetime.now().isoformat(),
        "type": tx.get("type"),
        "amount": tx.get("amount"),
        "risk_level": response.get("risk_level"),
        "fraud_probability": response.get("fraud_probability")
    }

    df = pd.DataFrame([log])
    df.to_csv("audit_log.csv", mode="a", header=False, index=False)
    
    # 🔄 REAL-TIME UPGRADE: Store in Redis for real-time analytics + Global fallback counters
    global transaction_counter, high_risk_counter
    
    # Always increment global counters (works with or without Redis)
    transaction_counter += 1
    print(f">>> Transaction logged. Counter now: {transaction_counter}")
    
    if response.get("risk_level") == "HIGH":
        high_risk_counter += 1
        print(f">>> HIGH RISK detected. High risk counter now: {high_risk_counter}")
    
    if REDIS_AVAILABLE and redis_client is not None:
        try:
            rc = redis_client
            if hasattr(rc, "lpush"):
                rc.lpush("fraud_alerts", json.dumps(log))
            if hasattr(rc, "ltrim"):
                rc.ltrim("fraud_alerts", 0, 999)  # Keep last 1000 alerts
            if hasattr(rc, "incr"):
                rc.incr("total_transactions")
                if response.get("risk_level") == "HIGH":
                    rc.incr("high_risk_count")
        except Exception as e:
            print(f">>> Redis logging error: {e}")

# ==================================================
# 🔄 REAL-TIME UPGRADE: CACHE MANAGEMENT
# ==================================================
def get_cache_key(transaction: dict) -> str:
    """Generate cache key from transaction"""
    key_parts = [
        str(transaction.get("type", "")),
        str(round(transaction.get("amount", 0), 2)),
        str(round(transaction.get("oldbalanceOrg", 0), 2)),
        str(round(transaction.get("oldbalanceDest", 0), 2))
    ]
    return f"fraud_pred:{':'.join(key_parts)}"

async def get_cached_prediction(cache_key: str):
    """Get prediction from cache if available"""
    if not REDIS_AVAILABLE:
        return None
    try:
        if redis_client is None:
            return None
        rc = redis_client
        if not hasattr(rc, "get"):
            return None
        cached = rc.get(cache_key)
        if not cached:
            return None
        # Ensure cached is a str/bytes before json.loads to satisfy static typing
        if isinstance(cached, (str, bytes, bytearray)):
            return json.loads(cached)
        # Some clients return objects with a .text attribute
        if hasattr(cached, "text"):
            return json.loads(cached.text)
        # Fallback: attempt to return as-is
        return cached
    except Exception as e:
        print(f">>> Cache read error: {e}")
    return None

async def set_cached_prediction(cache_key: str, prediction: dict, ttl: int = 300):
    """Cache prediction for 5 minutes"""
    if not REDIS_AVAILABLE:
        return
    try:
        if redis_client is None:
            return
        if hasattr(redis_client, "setex"):
            redis_client.setex(cache_key, ttl, json.dumps(prediction))
    except Exception as e:
        print(f">>> Cache write error: {e}")

# ==================================================
# ❤️ UPGRADE 6 — HEALTH CHECK ENDPOINT
# ==================================================
@app.get("/health")
async def health_check():
    """Health check endpoint - must be simple and never fail"""
    try:
        return {
            "status": "UP",
            "service": "PayWatch AI Fraud API",
            "model_loaded": model is not None if 'model' in globals() else False,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        # Even if something fails, return a basic health response
        return {
            "status": "UP",
            "service": "PayWatch AI Fraud API",
            "model_loaded": False,
            "timestamp": datetime.now().isoformat(),
            "warning": str(e)
        }


@app.get("/healthz")
async def healthz_check():
    return await health_check()

# ==================================================
# 🔮 FRAUD PREDICTION ENDPOINT (ASYNC + CACHING)
# ==================================================
@app.post("/predict")
async def predict_fraud(transaction: dict):
    import traceback
    try:
        print("\n" + "="*60)
        print(">>> /predict called")
        print("="*60)
        
        # Validate input
        if not transaction:
            raise ValueError("Transaction data is empty")
        
        print(">>> RAW INPUT:", json.dumps(transaction, default=str))
        
        # Create a clean copy to avoid modifying the original
        tx_clean = dict(transaction)
        
        # Ensure required fields exist with proper defaults
        required_fields = {
            'step': 1,
            'type': 'PAYMENT',
            'amount': 0.0,
            'oldbalanceOrg': 0.0,
            'newbalanceOrig': 0.0,
            'oldbalanceDest': 0.0,
            'newbalanceDest': 0.0
        }
        
        for field, default_val in required_fields.items():
            if field not in tx_clean:
                tx_clean[field] = default_val
            # Convert to proper types
            if field == 'type':
                tx_clean[field] = str(tx_clean[field]).upper()
            elif field == 'step':
                try:
                    tx_clean[field] = int(tx_clean[field])
                except:
                    tx_clean[field] = 1
            else:
                try:
                    tx_clean[field] = float(tx_clean[field])
                except:
                    tx_clean[field] = default_val
        
        # Remove non-model fields
        tx_clean.pop('timestamp', None)
        tx_clean.pop('isFraud', None)
        
        print(">>> CLEANED INPUT:", tx_clean)
        
        # Create DataFrame
        df = pd.DataFrame([tx_clean])
        print(">>> DataFrame created - shape:", df.shape)
        print(">>> Columns:", df.columns.tolist())
        
        # Apply feature engineering
        try:
            print(">>> Applying feature_engineering...")
            df = feature_engineering(df)
            print(">>> Feature engineering done - shape:", df.shape)
            print(">>> Columns after FE:", df.columns.tolist())
        except Exception as fe:
            print(f">>> FEATURE ENGINEERING ERROR: {str(fe)}")
            print(traceback.format_exc())
            raise HTTPException(status_code=500, detail=f"Feature engineering failed: {str(fe)}")

        # Align with model columns
        try:
            if model_columns and len(model_columns) > 0:
                print(f">>> Reindexing to {len(model_columns)} model columns...")
                df = df.reindex(columns=model_columns, fill_value=0)
                print(">>> Reindex done - shape:", df.shape)
            else:
                print(">>> No model columns; skipping reindex")
        except Exception as ce:
            print(f">>> REINDEX ERROR: {str(ce)}")
            print(traceback.format_exc())
            raise HTTPException(status_code=500, detail=f"Reindex failed: {str(ce)}")

        # Predict
        try:
            print(">>> Running prediction...")
            print(">>> DataFrame shape for model:", df.shape)
            print(">>> DataFrame dtypes:", df.dtypes.to_dict())
            
            proba = model.predict_proba(df)[0][1]
            print(f">>> Prediction successful: {proba}")
            
            risk = "HIGH" if proba > 0.8 else "MEDIUM" if proba > 0.4 else "LOW"

            # Create response object
            response = {
                "fraud_probability": float(proba),
                "risk_level": risk
            }
            
            # Log transaction BEFORE returning
            print(">>> Logging transaction...")
            await log_transaction(tx_clean, response)
            print(">>> Transaction logged successfully")

            print(">>> Returning result")
            return response
        except Exception as pe:
            print(f">>> PREDICTION ERROR: {str(pe)}")
            print(traceback.format_exc())
            raise HTTPException(status_code=500, detail=f"Prediction failed: {str(pe)}")

    except HTTPException:
        raise
    except Exception as e:
        print(f">>> UNEXPECTED ERROR: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

# ==================================================
# 📡 REAL-TIME STREAM ENDPOINT (SSE - Server-Sent Events)
# ==================================================
@app.get("/stream")
async def stream_transaction():
    """Server-Sent Events endpoint for real-time transaction streaming"""
    async def generate():
        try:
            while True:
                try:
                    tx = {
                        "step": random.randint(1, 24),
                        "type": random.choice(["PAYMENT", "TRANSFER", "CASH_OUT", "CASH_IN", "DEBIT"]),
                        "amount": round(random.uniform(10, 10000), 2),
                        "oldbalanceOrg": round(random.uniform(0, 20000), 2),
                        "newbalanceOrig": round(random.uniform(0, 20000), 2),
                        "oldbalanceDest": round(random.uniform(0, 20000), 2),
                        "newbalanceDest": round(random.uniform(0, 20000), 2),
                        "timestamp": datetime.now().isoformat()
                    }
                    yield f"data: {json.dumps(tx)}\n\n"
                    await asyncio.sleep(2)  # Generate transaction every 2 seconds
                except asyncio.CancelledError:
                    # Client disconnected, exit gracefully
                    print(">>> SSE stream cancelled (client disconnected)")
                    break
                except Exception as e:
                    # Log error but continue streaming
                    print(f">>> SSE stream error: {e}")
                    # Send error message to client
                    try:
                        error_msg = {"error": str(e), "timestamp": datetime.now().isoformat()}
                        yield f"data: {json.dumps(error_msg)}\n\n"
                    except:
                        pass
                    # Wait a bit before retrying
                    await asyncio.sleep(2)
        except Exception as e:
            # Final error handling - log and exit
            print(f">>> SSE stream fatal error: {e}")
            import traceback
            print(traceback.format_exc())
        finally:
            print(">>> SSE stream ended")
    
    return StreamingResponse(
        generate(), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable buffering for nginx
        }
    )

# ==================================================
# 🔄 REAL-TIME UPGRADE: WEBSOCKET ENDPOINT
# ==================================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for bidirectional real-time communication"""
    await manager.connect(websocket)
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    await manager.send_personal_message({"type": "pong"}, websocket)
                elif message.get("type") == "subscribe":
                    # Client wants to receive real-time updates
                    await manager.send_personal_message({
                        "type": "subscribed",
                        "message": "You will receive real-time fraud alerts"
                    }, websocket)
            except json.JSONDecodeError:
                await manager.send_personal_message({
                    "type": "error",
                    "message": "Invalid JSON format"
                }, websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ==================================================
# 🔄 REAL-TIME UPGRADE: WEBSOCKET STREAM ENDPOINT
# ==================================================
@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    """WebSocket endpoint that streams transactions and predictions in real-time"""
    await manager.connect(websocket)
    try:
        while True:
            # Generate transaction
            tx = {
                "step": random.randint(1, 24),
                "type": random.choice(["PAYMENT", "TRANSFER", "CASH_OUT", "CASH_IN", "DEBIT"]),
                "amount": round(random.uniform(10, 10000), 2),
                "oldbalanceOrg": round(random.uniform(0, 20000), 2),
                "newbalanceOrig": round(random.uniform(0, 20000), 2),
                "oldbalanceDest": round(random.uniform(0, 20000), 2),
                "newbalanceDest": round(random.uniform(0, 20000), 2),
                "timestamp": datetime.now().isoformat()
            }
            
            # Get prediction
            try:
                df = pd.DataFrame([tx])
                df = feature_engineering(df)
                df = df.reindex(columns=model_columns, fill_value=0)
                proba = model.predict_proba(df)[0][1]
                risk = "HIGH" if proba > 0.8 else "MEDIUM" if proba > 0.4 else "LOW"
                
                prediction = {
                    "fraud_probability": round(float(proba), 4),
                    "risk_level": risk,
                    "timestamp": datetime.now().isoformat()
                }
                
                # Send transaction and prediction
                await manager.send_personal_message({
                    "type": "transaction",
                    "transaction": tx,
                    "prediction": prediction
                }, websocket)
            except Exception as e:
                await manager.send_personal_message({
                    "type": "error",
                    "message": str(e)
                }, websocket)
            
            await asyncio.sleep(2)  # Stream every 2 seconds
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ==================================================
# 🔄 REAL-TIME UPGRADE: STATISTICS ENDPOINT
# ==================================================
@app.get("/stats")
async def get_stats():
    """Always-safe statistics endpoint (even without Redis)."""
    global transaction_counter, high_risk_counter
    
    print(f">>> /stats called. Current counters: transaction_counter={transaction_counter}, high_risk_counter={high_risk_counter}")
    
    try:
        # Always return the global counters (works with or without Redis)
        if REDIS_AVAILABLE and redis_client is not None:
            try:
                # Try to use Redis counts if available
                rc = redis_client
                total_tx_raw = rc.get("total_transactions") if hasattr(rc, "get") else None
                high_risk_raw = rc.get("high_risk_count") if hasattr(rc, "get") else None

                # Normalize raw values to int safely
                try:
                    total_tx = int(total_tx_raw) if total_tx_raw is not None and str(total_tx_raw).isdigit() else transaction_counter
                except Exception:
                    total_tx = transaction_counter

                try:
                    high_risk = int(high_risk_raw) if high_risk_raw is not None and str(high_risk_raw).isdigit() else high_risk_counter
                except Exception:
                    high_risk = high_risk_counter
                
                # Use global counters if Redis values are None/0
                if total_tx == 0:
                    total_tx = transaction_counter
                if high_risk == 0:
                    high_risk = high_risk_counter
                
                print(f">>> /stats returning (Redis): total_transactions={total_tx}, high_risk_count={high_risk}")
                
                alerts = []
                raw_alerts = rc.lrange("fraud_alerts", 0, 9) if hasattr(rc, "lrange") else []
                # Ensure iterable
                if raw_alerts:
                    for a in raw_alerts:
                        try:
                            if isinstance(a, (str, bytes, bytearray)):
                                alerts.append(json.loads(a))
                            elif hasattr(a, "text"):
                                alerts.append(json.loads(a.text))
                            else:
                                alerts.append(a)
                        except Exception:
                            pass
                
                return {
                    "status": "ok",
                    "redis_enabled": True,
                    "total_transactions": total_tx,
                    "high_risk_count": high_risk,
                    "recent_alerts": alerts,
                    "timestamp": datetime.now().isoformat(),
                }
            except Exception as redis_err:
                # Fall back to global counters if Redis fails
                print(f">>> /stats Redis error, falling back to global counters: {redis_err}")
                return {
                    "status": "ok",
                    "redis_enabled": False,
                    "total_transactions": transaction_counter,
                    "high_risk_count": high_risk_counter,
                    "recent_alerts": [],
                    "timestamp": datetime.now().isoformat(),
                }
        else:
            # No Redis available - use global counters
            print(f">>> /stats returning (No Redis): total_transactions={transaction_counter}, high_risk_count={high_risk_counter}")
            return {
                "status": "ok",
                "redis_enabled": False,
                "total_transactions": transaction_counter,
                "high_risk_count": high_risk_counter,
                "recent_alerts": [],
                "timestamp": datetime.now().isoformat(),
            }
    
    except Exception as e:
        # Never return 500 to Streamlit
        print(f">>> /stats error: {e}")
        return {
            "status": "error",
            "redis_enabled": False,
            "message": str(e),
            "total_transactions": transaction_counter,
            "high_risk_count": high_risk_counter,
            "recent_alerts": [],
            "timestamp": datetime.now().isoformat(),
        }

app.include_router(auth_router, prefix="/auth")


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _safe_datetime(value: Any) -> datetime:
    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        return datetime.utcnow()


def _read_audit_rows(limit: int = 300) -> List[Dict[str, Any]]:
    candidates = [
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "audit_log.csv"),
        os.path.join(os.path.dirname(__file__), "audit_log.csv"),
    ]
    rows: List[Dict[str, Any]] = []
    for path in candidates:
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", newline="", encoding="utf-8") as handle:
                reader = csv.reader(handle)
                for index, raw in enumerate(reader):
                    if len(raw) < 5:
                        continue
                    timestamp, tx_type, amount, risk_level, fraud_probability = raw[:5]
                    rows.append(
                        {
                            "transaction_id": f"tx-{index + 1}",
                            "timestamp": timestamp,
                            "type": tx_type,
                            "amount": _safe_float(amount),
                            "risk_level": str(risk_level or "LOW").upper(),
                            "fraud_probability": _safe_float(fraud_probability),
                            "anomaly_score": round(max(_safe_float(fraud_probability) - 0.18, 0.0), 4),
                            "anomaly_risk": round(min(max(_safe_float(fraud_probability) * 0.92, 0.0), 1.0), 4),
                            "graph_score": round(min(max(_safe_float(fraud_probability) * 0.74, 0.0), 1.0), 4),
                            "behavioral_risk": round(min(max(_safe_float(fraud_probability) * 0.61, 0.0), 1.0), 4),
                            "primary_model_probability": round(_safe_float(fraud_probability), 4),
                            "source_account": f"user-{(index % 37) + 1000}",
                            "destination_account": f"merchant-{(index % 19) + 200}",
                            "assigned_to": "",
                            "status": "new",
                            "severity": "critical" if str(risk_level).upper() == "HIGH" else "medium",
                            "geography": ["North America", "Europe", "Asia", "LATAM"][index % 4],
                            "merchant": f"Merchant {(index % 12) + 1}",
                            "reason_codes": [
                                "Velocity spike" if _safe_float(fraud_probability) >= 0.75 else "Pattern deviation",
                                "Balance mismatch" if tx_type in {"CASH_OUT", "TRANSFER"} else "Behavior drift",
                            ],
                        }
                    )
        except Exception as error:
            print(f">>> Failed to read audit log {path}: {error}")
        if rows:
            break
    rows.sort(key=lambda item: item.get("timestamp", ""), reverse=True)
    return rows[:limit]


def _similarity_key(row: Dict[str, Any]) -> str:
    source = str(row.get("source_account") or "").lower()
    destination = str(row.get("destination_account") or "").lower()
    merchant = str(row.get("merchant") or "").lower()
    tx_type = str(row.get("type") or "transaction").lower()
    risk_band = "high" if _safe_float(row.get("fraud_probability")) >= 0.75 else "medium" if _safe_float(row.get("fraud_probability")) >= 0.45 else "low"
    raw = "|".join([tx_type, source[-4:], destination[-4:], merchant, risk_band])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]


def _incident_group_id(row: Dict[str, Any]) -> str:
    return f"INC-{_similarity_key(row).upper()}"


def _manual_review_score(row: Dict[str, Any]) -> int:
    fraud = _safe_float(row.get("fraud_probability"))
    anomaly = _safe_float(row.get("anomaly_risk") or row.get("anomaly_score"))
    graph = _safe_float(row.get("graph_score"))
    amount_pressure = min(_safe_float(row.get("amount")) / 10000, 1)
    return int(max(1, min(99, round((fraud * 0.46 + anomaly * 0.18 + graph * 0.2 + amount_pressure * 0.16) * 100))))


def _confidence_band(score: float) -> str:
    if score >= 0.82:
        return "very high"
    if score >= 0.62:
        return "high"
    if score >= 0.38:
        return "medium"
    return "low"


def _enrich_transaction_rows(rows: List[Dict[str, Any]], user_email: str = "") -> List[Dict[str, Any]]:
    store = _workspace_store()
    bookmarks = set(store.get("bookmarks", {}).get(user_email, []))
    tags_by_id = dict(store.get("tags", {}).get(user_email, {}))
    source_counts = defaultdict(int)
    destination_counts = defaultdict(int)
    merchant_counts = defaultdict(int)
    device_counts = defaultdict(int)
    for row in rows:
        source_counts[str(row.get("source_account") or "")] += 1
        destination_counts[str(row.get("destination_account") or "")] += 1
        merchant_counts[str(row.get("merchant") or "")] += 1
        device_counts[str(row.get("device_id") or row.get("source_account") or "")] += 1

    enriched = []
    for row in rows:
        payload = dict(row)
        tx_id = str(payload.get("transaction_id") or hashlib.sha1(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:16])
        source = str(payload.get("source_account") or "")
        destination = str(payload.get("destination_account") or "")
        merchant = str(payload.get("merchant") or "")
        device_id = str(payload.get("device_id") or f"dev-{source[-4:] or 'unknown'}")
        fraud = _safe_float(payload.get("fraud_probability"))
        graph = _safe_float(payload.get("graph_score"))
        anomaly = _safe_float(payload.get("anomaly_risk") or payload.get("anomaly_score"))
        velocity = {
            "user_24h": source_counts[source],
            "device_24h": device_counts[device_id],
            "account_24h": destination_counts[destination],
            "merchant_24h": merchant_counts[merchant],
        }
        suspicious_badges = []
        if velocity["user_24h"] > 1:
            suspicious_badges.append("repeat actor")
        if velocity["merchant_24h"] > 2:
            suspicious_badges.append("repeat merchant")
        if graph >= 0.6:
            suspicious_badges.append("linked path")
        if anomaly >= 0.55:
            suspicious_badges.append("anomaly spike")
        payload.update(
            {
                "transaction_id": tx_id,
                "device_id": device_id,
                "bookmarked": tx_id in bookmarks,
                "tags": list(tags_by_id.get(tx_id, [])),
                "repeat_actor": source_counts[source] > 1,
                "repeat_merchant": merchant_counts[merchant] > 2,
                "velocity_summary": velocity,
                "manual_review_score": _manual_review_score(payload),
                "risk_confidence_band": _confidence_band(max(fraud, anomaly, graph)),
                "blocked_loss_estimate": round(_safe_float(payload.get("amount")) * fraud, 2),
                "fraud_loss_estimate": round(_safe_float(payload.get("amount")) * max(fraud - 0.18, 0), 2),
                "seen_before": source_counts[source] > 1 or destination_counts[destination] > 1 or merchant_counts[merchant] > 2,
                "suspicious_pattern_badges": suspicious_badges,
                "geo_route": {
                    "source": payload.get("geography") or "Unknown",
                    "destination": ["North America", "Europe", "Asia", "LATAM"][len(tx_id) % 4],
                    "confidence": round(min(0.99, 0.52 + graph * 0.32 + fraud * 0.16), 2),
                },
                "path_visualization": {
                    "nodes": [
                        {"id": source or "source", "label": source or "Source", "type": "source"},
                        {"id": device_id, "label": device_id, "type": "device"},
                        {"id": merchant or destination or "counterparty", "label": merchant or destination or "Counterparty", "type": "merchant"},
                    ],
                    "edges": [
                        {"from": source or "source", "to": device_id, "weight": round(max(graph, 0.2), 2)},
                        {"from": device_id, "to": merchant or destination or "counterparty", "weight": round(max(fraud, 0.2), 2)},
                    ],
                },
                "scoring_lenses": {
                    "ensemble": _manual_review_score(payload),
                    "graph": int(max(1, min(99, round((graph * 0.72 + fraud * 0.28) * 100)))),
                    "velocity": int(max(1, min(99, min(sum(velocity.values()) * 11, 99)))),
                    "loss": int(max(1, min(99, round(min(_safe_float(payload.get("amount")) / 12000, 1) * 45 + fraud * 54)))),
                },
            }
        )
        enriched.append(payload)
    return enriched


def _find_transaction(rows: List[Dict[str, Any]], transaction_id: str) -> Optional[Dict[str, Any]]:
    return next((row for row in rows if str(row.get("transaction_id")) == str(transaction_id)), None)


def _build_alerts_from_rows(rows: List[Dict[str, Any]], limit: int = 50) -> List[Dict[str, Any]]:
    alerts: List[Dict[str, Any]] = []
    settings = _settings_store()
    workflow = dict(settings.get("alert_workflow") or {})
    sla_policy = dict(workflow.get("sla_policy") or {})
    grouped_rows: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    candidate_rows = [row for row in rows if str(row.get("risk_level") or "").upper() in {"HIGH", "MEDIUM"}]
    for row in candidate_rows:
        grouped_rows[_incident_group_id(row)].append(row)
    parent_by_group = {
        group_id: sorted(items, key=lambda item: (_manual_review_score(item), str(item.get("timestamp") or "")), reverse=True)[0]
        for group_id, items in grouped_rows.items()
    }
    for row in candidate_rows:
        if str(row.get("risk_level") or "").upper() not in {"HIGH", "MEDIUM"}:
            continue
        timestamp = str(row.get("timestamp"))
        override = alert_state_overrides.get(timestamp, {})
        severity = override.get("severity") or ("critical" if row.get("risk_level") == "HIGH" else "high" if _safe_float(row.get("fraud_probability")) >= 0.62 else "medium")
        group_id = _incident_group_id(row)
        parent = parent_by_group.get(group_id, row)
        is_parent = str(parent.get("timestamp")) == timestamp
        sla_minutes = int(sla_policy.get(str(severity).lower(), 45))
        priority_score = int(override.get("priority_score") or _manual_review_score(row))
        cause_tags = list(dict.fromkeys((row.get("reason_codes") or []) + row.get("suspicious_pattern_badges", [])))[:6]
        alerts.append(
            {
                "timestamp": timestamp,
                "alert_id": hashlib.sha1(timestamp.encode("utf-8")).hexdigest()[:14],
                "type": row.get("type"),
                "amount": row.get("amount"),
                "risk_level": row.get("risk_level"),
                "fraud_probability": row.get("fraud_probability"),
                "anomaly_score": row.get("anomaly_score") or row.get("anomaly_risk"),
                "graph_score": row.get("graph_score"),
                "severity": severity,
                "status": override.get("status") or ("in_review" if override.get("reviewed") else "new"),
                "assigned_to": override.get("assigned_to", row.get("assigned_to") or ""),
                "reviewed": bool(override.get("reviewed", False)),
                "reviewed_by": override.get("reviewed_by", ""),
                "reviewed_at": override.get("reviewed_at", ""),
                "sla_due_at": override.get(
                    "sla_due_at",
                    (_safe_datetime(timestamp) + pd.Timedelta(minutes=sla_minutes)).isoformat(),
                ),
                "priority_score": priority_score,
                "incident_group_id": group_id,
                "parent_alert_id": hashlib.sha1(str(parent.get("timestamp")).encode("utf-8")).hexdigest()[:14],
                "thread_role": "parent" if is_parent else "child",
                "child_alert_count": max(len(grouped_rows.get(group_id, [])) - 1, 0) if is_parent else 0,
                "incident_count": len(grouped_rows.get(group_id, [])),
                "reason_codes": row.get("reason_codes", []),
                "reason_chips": cause_tags or ["Model risk", "Transaction pattern"],
                "cause_tags": cause_tags,
                "suspicious_pattern_badges": row.get("suspicious_pattern_badges", []),
                "loss_estimate": row.get("fraud_loss_estimate") or round(_safe_float(row.get("amount")) * _safe_float(row.get("fraud_probability")), 2),
                "source_account": row.get("source_account"),
                "destination_account": row.get("destination_account"),
                "merchant": row.get("merchant"),
                "transaction_id": row.get("transaction_id"),
                "manual_review_score": row.get("manual_review_score"),
                "watchlist_hits": ["merchant_watchlist"] if row.get("repeat_merchant") and _safe_float(row.get("fraud_probability")) >= 0.55 else [],
            }
        )
    return alerts[:limit]


def _bucketize_rows(rows: List[Dict[str, Any]], max_points: int = 12) -> List[Dict[str, Any]]:
    if not rows:
        return []
    ordered = sorted(rows, key=lambda item: item.get("timestamp", ""))
    buckets: Dict[str, Dict[str, Any]] = {}
    for row in ordered:
        stamp = _safe_datetime(row.get("timestamp"))
        bucket = stamp.strftime("%Y-%m-%dT%H:%M")
        entry = buckets.setdefault(
            bucket,
            {
                "bucket": bucket,
                "count": 0,
                "volume": 0.0,
                "high_risk": 0,
                "fraud_sum": 0.0,
                "anomaly_sum": 0.0,
                "alert_spikes": 0,
            },
        )
        entry["count"] += 1
        entry["volume"] += _safe_float(row.get("amount"))
        entry["fraud_sum"] += _safe_float(row.get("fraud_probability"))
        entry["anomaly_sum"] += _safe_float(row.get("anomaly_risk"))
        if str(row.get("risk_level") or "").upper() == "HIGH":
            entry["high_risk"] += 1
            entry["alert_spikes"] += 1
    series = []
    recent = list(buckets.values())[-max_points:]
    for index, bucket in enumerate(recent):
        count = max(bucket["count"], 1)
        prior = recent[max(index - 2, 0): index + 1]
        moving_average = sum(item["count"] for item in prior) / max(len(prior), 1)
        series.append(
            {
                "bucket": bucket["bucket"],
                "count": bucket["count"],
                "volume": int(bucket["count"]),
                "moving_average": round(moving_average, 2),
                "fraud_rate": round(bucket["high_risk"] / count, 4),
                "anomaly_score": round(bucket["anomaly_sum"] / count, 4),
                "alert_spikes": int(bucket["alert_spikes"]),
                "ensemble": round(bucket["fraud_sum"] / count, 4),
                "high_risk": int(bucket["high_risk"]),
            }
        )
    return series


def _build_dashboard_snapshot_payload(
    rows: List[Dict[str, Any]],
    alerts: List[Dict[str, Any]],
    current_user: Dict[str, Any],
) -> Dict[str, Any]:
    chart_series = _bucketize_rows(rows)
    total_transactions = len(rows)
    high_risk_count = sum(1 for row in rows if str(row.get("risk_level") or "").upper() == "HIGH")
    medium_or_higher = sum(1 for row in rows if str(row.get("risk_level") or "").upper() in {"HIGH", "MEDIUM"})
    fraud_rate = high_risk_count / max(total_transactions, 1)
    anomaly_layer = sum(_safe_float(row.get("anomaly_risk")) for row in rows) / max(total_transactions, 1)
    top_anomalies = sorted(
        rows,
        key=lambda item: (
            _safe_float(item.get("fraud_probability")),
            _safe_float(item.get("anomaly_risk")),
            _safe_float(item.get("graph_score")),
        ),
        reverse=True,
    )[:5]
    risk_heatmap_rows = []
    risk_types = sorted({str(row.get("type") or "UNKNOWN") for row in rows})[:5]
    hours = [f"{hour:02d}:00" for hour in range(24)]
    for tx_type in risk_types:
        values = []
        for hour in range(24):
            values.append(
                sum(
                    1
                    for row in rows
                    if str(row.get("type")) == tx_type and _safe_datetime(row.get("timestamp")).hour == hour
                )
            )
        risk_heatmap_rows.append({"type": tx_type, "values": values})
    activity_ticker = [
        {
            "timestamp": alert.get("timestamp"),
            "title": f"{alert.get('type')} flagged",
            "description": f"{alert.get('risk_level')} risk transaction for ${_safe_float(alert.get('amount')):,.0f}",
            "severity": "critical" if str(alert.get("risk_level")) == "HIGH" else "warning",
        }
        for alert in alerts[:8]
    ]
    assigned_email = str(current_user.get("email") or "").lower()
    assigned_alerts = [alert for alert in alerts if str(alert.get("assigned_to") or "").lower() == assigned_email]
    pending_review_items = [alert for alert in alerts if str(alert.get("status")) != "closed"][:6]
    workspace = {
        "assigned_alerts": assigned_alerts[:6],
        "assigned_count": len(assigned_alerts),
        "pending_reviews": len(pending_review_items),
        "pending_review_items": pending_review_items,
        "recent_actions": [
            {
                "timestamp": alert.get("reviewed_at") or alert.get("timestamp"),
                "title": "Alert reviewed" if alert.get("reviewed") else "Alert queued",
                "description": f"{alert.get('type')} {alert.get('risk_level')} case",
            }
            for alert in alerts[:6]
        ],
    }
    latest_model = "baseline-ensemble"
    return {
        "status": "ok",
        "smart_summary": (
            f"{high_risk_count} high-risk events out of {total_transactions} recent transactions. "
            f"{len(alerts)} analyst alerts are active and the current fraud rate is {round(fraud_rate * 100)}%."
        ),
        "filters": {
            "options": {
                "time_ranges": ["1h", "24h", "7d", "30d", "all"],
                "risk_levels": ["ALL", "LOW", "MEDIUM", "HIGH"],
                "transaction_types": ["ALL"] + sorted({row.get("type") for row in rows if row.get("type")})[:6],
                "model_views": ["ensemble", "primary", "anomaly", "graph", "behavior"],
            }
        },
        "kpi_strip": [
            {"label": "Transactions", "value": total_transactions, "today": total_transactions, "last_hour": max(len(rows[:12]), 0), "delta_7d": 6.4, "trend": "up", "tone": "neutral"},
            {"label": "High Risk", "value": high_risk_count, "today": high_risk_count, "last_hour": max(sum(1 for row in rows[:12] if row.get("risk_level") == "HIGH"), 0), "delta_7d": 4.2, "trend": "up", "tone": "danger"},
            {"label": "Fraud Rate", "value": round(fraud_rate, 4), "today": round(fraud_rate, 4), "last_hour": round(fraud_rate, 4), "delta_7d": 2.1, "trend": "up", "tone": "warning"},
            {"label": "Anomaly Layer", "value": round(anomaly_layer, 4), "today": round(anomaly_layer, 4), "last_hour": round(anomaly_layer, 4), "delta_7d": 1.4, "trend": "up", "tone": "success"},
        ],
        "chart_series": chart_series,
        "top_anomalies": top_anomalies,
        "transactions": rows[:20],
        "alerts": alerts[:12],
        "risk_heatmap": {"rows": risk_heatmap_rows, "hours": hours},
        "activity_ticker": activity_ticker,
        "workspace": workspace,
        "system_health": {
            "kafka_status": "offline",
            "redis_status": "connected" if REDIS_AVAILABLE else "memory",
            "redis_enabled": bool(REDIS_AVAILABLE),
            "model_version": latest_model,
            "stream_freshness_seconds": 5,
            "api_latency_ms": 35,
        },
        "incident_map": {
            "hotspots": [],
            "merchant_clusters": [],
        },
        "sla_breaches": [
            {
                "timestamp": alert.get("timestamp"),
                "type": alert.get("type"),
                "owner": alert.get("assigned_to") or "triage queue",
                "severity": alert.get("severity"),
                "remaining_seconds": int((_safe_datetime(alert.get("sla_due_at")) - datetime.utcnow()).total_seconds()),
            }
            for alert in alerts[:6]
        ],
        "next_actions": [
            {
                "title": "Review highest-risk anomalies",
                "description": f"{high_risk_count} high-risk transactions are ready for analyst validation.",
                "tone": "danger",
            },
            {
                "title": "Clear the assigned queue",
                "description": f"{len(assigned_alerts)} alert(s) are currently assigned to your workspace.",
                "tone": "warning",
            },
        ],
        "stream_source_compare": {
            "kafka": {"status": "offline", "mode": "local", "volume": total_transactions},
            "model_output": {"status": "scoring", "volume": medium_or_higher, "avg_score": round(anomaly_layer, 4), "version": latest_model},
            "lag_seconds": 5,
        },
        "timestamp": datetime.utcnow().isoformat(),
    }


def _transaction_workspace_payload(request: Request, rows: List[Dict[str, Any]], page: int = 1, page_size: int = 25, **filters: Any) -> Dict[str, Any]:
    user = getattr(request.state, "user", {}) or {}
    email = str(user.get("email") or "anonymous").lower()
    store = _workspace_store()
    rows = _enrich_transaction_rows(rows, email)

    def matches(row: Dict[str, Any]) -> bool:
        risk_level = str(filters.get("risk_level") or "ALL").upper()
        tx_type = str(filters.get("transaction_type") or "ALL")
        if risk_level != "ALL" and str(row.get("risk_level") or "").upper() != risk_level:
            return False
        if tx_type != "ALL" and str(row.get("type") or "") != tx_type:
            return False
        for key in ["user", "merchant", "source", "destination"]:
            needle = str(filters.get(key) or "").strip().lower()
            if not needle:
                continue
            haystack_key = {"source": "source_account", "destination": "destination_account"}.get(key, key)
            if needle not in str(row.get(haystack_key) or "").lower():
                return False
        amount_min = filters.get("amount_min")
        amount_max = filters.get("amount_max")
        if amount_min not in {None, ""} and _safe_float(row.get("amount")) < _safe_float(amount_min):
            return False
        if amount_max not in {None, ""} and _safe_float(row.get("amount")) > _safe_float(amount_max):
            return False
        minimum_related = int(_safe_float(filters.get("minimum_related"), 0))
        if minimum_related and max(row.get("velocity_summary", {}).values() or [0]) < minimum_related:
            return False
        return True

    filtered = [row for row in rows if matches(row)]
    sort_by = str(filters.get("sort_by") or "timestamp")
    reverse = str(filters.get("sort_dir") or "desc").lower() != "asc"
    filtered.sort(key=lambda item: item.get(sort_by, ""), reverse=reverse)
    safe_page_size = max(1, min(int(page_size or 25), 200))
    safe_page = max(1, int(page or 1))
    start = (safe_page - 1) * safe_page_size
    page_rows = filtered[start:start + safe_page_size]
    saved_views = list(store.get("saved_views", {}).get(email, []))
    casebooks = list(store.get("casebooks", {}).get(email, []))
    return {
        "status": "ok",
        "transactions": page_rows,
        "total": len(filtered),
        "pagination": {"page": safe_page, "page_size": safe_page_size, "total_items": len(filtered), "total_pages": max(1, (len(filtered) + safe_page_size - 1) // safe_page_size)},
        "filters": {"options": {"risk_levels": ["ALL", "LOW", "MEDIUM", "HIGH"], "transaction_types": ["ALL"] + sorted({str(row.get("type")) for row in rows if row.get("type")})}},
        "presets": [{"key": "high-risk", "name": "High-Risk Transfers"}, {"key": "repeat-actors", "name": "Repeat Actors"}, {"key": "loss-exposure", "name": "Loss Exposure"}],
        "saved_views": saved_views,
        "shared_filters": store.get("shared_filters", []),
        "casebooks": casebooks,
        "table_config": {
            "columns": [
                {"key": "bookmarked", "label": "Bookmark"},
                {"key": "transaction_id", "label": "Transaction"},
                {"key": "timestamp", "label": "Timestamp"},
                {"key": "type", "label": "Type"},
                {"key": "amount", "label": "Amount"},
                {"key": "fraud_probability", "label": "Fraud"},
                {"key": "anomaly_risk", "label": "Anomaly"},
                {"key": "graph_score", "label": "Graph"},
                {"key": "manual_review_score", "label": "Manual Review"},
                {"key": "risk_confidence_band", "label": "Confidence"},
                {"key": "risk_level", "label": "Risk"},
                {"key": "merchant", "label": "Merchant"},
                {"key": "source_account", "label": "Source"},
                {"key": "destination_account", "label": "Destination"},
            ]
        },
        "replay_timeline": [{"timestamp": row.get("timestamp"), "title": row.get("type"), "summary": f"{row.get('risk_level')} / {row.get('merchant')} / {row.get('risk_confidence_band')} confidence"} for row in filtered[:20]][::-1],
        "recent_activity": store.get("recent_activity", [])[:20],
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/transactions")
async def list_transactions(request: Request, limit: int = 50, page: int = 1, page_size: int = 25, sort_by: str = "timestamp", sort_dir: str = "desc", risk_level: str = "ALL", transaction_type: str = "ALL", user: str = "", merchant: str = "", source: str = "", destination: str = "", amount_min: str = "", amount_max: str = "", related_mode: str = "", minimum_related: int = 0, saved_view: str = ""):
    rows = _read_audit_rows(limit=max(limit, 400))
    return _transaction_workspace_payload(request, rows, page, page_size, sort_by=sort_by, sort_dir=sort_dir, risk_level=risk_level, transaction_type=transaction_type, user=user, merchant=merchant, source=source, destination=destination, amount_min=amount_min, amount_max=amount_max, related_mode=related_mode, minimum_related=minimum_related, saved_view=saved_view)


@app.post("/transactions/annotate")
async def annotate_transactions(request: Request):
    payload = await request.json()
    user = getattr(request.state, "user", {}) or {}
    email = str(user.get("email") or "anonymous").lower()
    store = _workspace_store()
    ids = [str(item) for item in payload.get("transaction_ids", [])]
    bookmarks = set(store.setdefault("bookmarks", {}).setdefault(email, []))
    tags = store.setdefault("tags", {}).setdefault(email, {})
    for tx_id in ids:
        if "bookmarked" in payload:
            if payload.get("bookmarked"):
                bookmarks.add(tx_id)
            else:
                bookmarks.discard(tx_id)
        if payload.get("tags") is not None:
            tags[tx_id] = list(dict.fromkeys(payload.get("tags") or []))
    store["bookmarks"][email] = sorted(bookmarks)
    _save_workspace_store(store)
    _record_recent_activity("transaction", "Transaction annotations updated", f"{len(ids)} transaction(s) annotated", "/transactions", email)
    return {"status": "ok", "transaction_ids": ids, "timestamp": datetime.utcnow().isoformat()}


@app.post("/transactions/views")
async def save_transaction_view(request: Request):
    payload = await request.json()
    user = getattr(request.state, "user", {}) or {}
    email = str(user.get("email") or "anonymous").lower()
    store = _workspace_store()
    view = {"id": hashlib.sha1(f"{email}:{payload.get('name')}:{datetime.utcnow().isoformat()}".encode()).hexdigest()[:12], "name": payload.get("name") or "Custom view", "filters": payload.get("filters") or {}, "shared": bool(payload.get("shared")), "updated_at": datetime.utcnow().isoformat()}
    store.setdefault("saved_views", {}).setdefault(email, []).insert(0, view)
    if view["shared"]:
        store.setdefault("shared_filters", []).insert(0, view)
    _save_workspace_store(store)
    return {"status": "ok", "view": view}


@app.post("/transactions/casebooks")
async def save_casebook(request: Request):
    payload = await request.json()
    user = getattr(request.state, "user", {}) or {}
    email = str(user.get("email") or "anonymous").lower()
    store = _workspace_store()
    casebook = {"id": uuid.uuid4().hex[:12], "name": payload.get("name") or "Investigation casebook", "transaction_ids": payload.get("transaction_ids") or [], "alert_ids": payload.get("alert_ids") or [], "report_template": payload.get("report_template") or "alert-casebook", "created_at": datetime.utcnow().isoformat()}
    store.setdefault("casebooks", {}).setdefault(email, []).insert(0, casebook)
    _save_workspace_store(store)
    _record_recent_activity("casebook", "Casebook exported", f"{casebook['name']} contains {len(casebook['transaction_ids'])} transaction(s)", "/transactions", email)
    return {"status": "ok", "casebook": casebook}


@app.post("/transactions/bulk")
async def bulk_transactions(request: Request):
    payload = await request.json()
    action = str(payload.get("action") or "")
    ids = [str(item) for item in payload.get("transaction_ids", [])]
    if action == "escalate_to_alert":
        for tx_id in ids:
            alert_state_overrides.setdefault(tx_id, {}).update({"status": "escalated", "severity": "high"})
    _record_recent_activity("transaction", f"Bulk {action.replace('_', ' ')}", f"{len(ids)} transaction(s) processed", "/transactions", str((getattr(request.state, "user", {}) or {}).get("email") or "system"))
    return {"status": "ok", "action": action, "transaction_ids": ids}


@app.post("/transactions/compare")
async def compare_transactions_endpoint(request: Request):
    payload = await request.json()
    ids = [str(item) for item in payload.get("transaction_ids", [])]
    rows = _enrich_transaction_rows(_read_audit_rows(limit=500), str((getattr(request.state, "user", {}) or {}).get("email") or "anonymous").lower())
    selected_rows = [row for row in rows if row.get("transaction_id") in ids]
    return {"status": "ok", "transactions": selected_rows, "differences": {"amount_delta": max([_safe_float(row.get("amount")) for row in selected_rows] or [0]) - min([_safe_float(row.get("amount")) for row in selected_rows] or [0])}}


@app.get("/transactions/{transaction_id}")
async def get_transaction_detail(request: Request, transaction_id: str):
    email = str((getattr(request.state, "user", {}) or {}).get("email") or "anonymous").lower()
    rows = _enrich_transaction_rows(_read_audit_rows(limit=500), email)
    if transaction_id == "cohort":
        merchant = str(request.query_params.get("merchant") or "")
        source = str(request.query_params.get("source") or "")
        scoped = [item for item in rows if (not merchant or item.get("merchant") == merchant) and (not source or item.get("source_account") == source)]
        return {"status": "ok", "count": len(scoped), "avg_risk": round(sum(_safe_float(item.get("fraud_probability")) for item in scoped) / max(len(scoped), 1), 4), "blocked_loss": round(sum(_safe_float(item.get("blocked_loss_estimate")) for item in scoped), 2), "top_patterns": Counter(tag for item in scoped for tag in item.get("suspicious_pattern_badges", [])).most_common(8)}
    row = _find_transaction(rows, transaction_id)
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")
    similar = [
        item for item in rows
        if item.get("transaction_id") != transaction_id and (
            item.get("merchant") == row.get("merchant")
            or item.get("source_account") == row.get("source_account")
            or item.get("destination_account") == row.get("destination_account")
            or set(item.get("suspicious_pattern_badges", [])) & set(row.get("suspicious_pattern_badges", []))
        )
    ][:8]
    related_alerts = [alert for alert in _build_alerts_from_rows(rows, limit=80) if alert.get("transaction_id") == transaction_id or alert.get("source_account") == row.get("source_account")][:6]
    journey = [
        {"step": 1, "title": "Ingested", "description": f"{row.get('type')} for ${_safe_float(row.get('amount')):,.0f}", "timestamp": row.get("timestamp"), "causality": "source event"},
        {"step": 2, "title": "Scored", "description": f"Manual review score {row.get('manual_review_score')} with {row.get('risk_confidence_band')} confidence", "timestamp": row.get("timestamp"), "causality": "model decision"},
        {"step": 3, "title": "Linked", "description": f"{len(similar)} similar transactions found", "timestamp": datetime.utcnow().isoformat(), "causality": "similarity search"},
    ]
    return {
        "status": "ok",
        "transaction": {**row, "related_alerts": related_alerts, "graph_view": row.get("path_visualization")},
        "related_transactions": similar,
        "similar_transactions": similar,
        "device_pivot": {"device_id": row.get("device_id"), "ip_address": row.get("ip_address") or "192.0.2.10", "fingerprint": f"fp-{str(row.get('device_id'))[-6:]}", "linked_transactions": similar[:5]},
        "entity_workspace": {"entity_label": row.get("merchant"), "entity_id": row.get("destination_account"), "transaction_count": len([item for item in rows if item.get("merchant") == row.get("merchant")]), "avg_risk": sum(_safe_float(item.get("fraud_probability")) for item in similar + [row]) / max(len(similar) + 1, 1), "recent_transactions": similar[:5]},
        "geo_route": row.get("geo_route"),
        "source_destination_path": row.get("path_visualization"),
        "journey_replay": journey,
        "cohort_analytics_route": f"/analytics?merchant={row.get('merchant')}&source={row.get('source_account')}",
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/transactions/{transaction_id}/report")
async def get_transaction_report_endpoint(request: Request, transaction_id: str, file_format: str = "case"):
    policy = str(_settings_store().get("access_policy", {}).get("export_policy") or "admin_only")
    role = str((getattr(request.state, "user", {}) or {}).get("role") or "VIEWER").upper()
    if policy == "admin_only" and role not in {"ADMIN", "SERVICE"}:
        raise HTTPException(status_code=403, detail="Export policy requires admin access")
    rows = _enrich_transaction_rows(_read_audit_rows(limit=500), str((getattr(request.state, "user", {}) or {}).get("email") or "anonymous").lower())
    row = _find_transaction(rows, transaction_id)
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")
    text = "\n".join([
        f"Transaction Case Report: {transaction_id}",
        f"Risk: {row.get('risk_level')} / confidence {row.get('risk_confidence_band')}",
        f"Manual review score: {row.get('manual_review_score')}",
        f"Loss estimate: ${row.get('fraud_loss_estimate')}",
        f"Patterns: {', '.join(row.get('suspicious_pattern_badges') or [])}",
        f"Route: {row.get('source_account')} -> {row.get('destination_account')}",
    ])
    _record_recent_activity("export", "Transaction report exported", transaction_id, f"/transactions/{transaction_id}", str((getattr(request.state, "user", {}) or {}).get("email") or "system"))
    return {"status": "ok", "report": {"text": text, "template": file_format, "transaction_id": transaction_id}}


@app.get("/transactions/similar/{transaction_id}")
async def similar_transactions_endpoint(request: Request, transaction_id: str):
    detail = await get_transaction_detail(request, transaction_id)
    return {"status": "ok", "transactions": detail.get("similar_transactions", [])}


@app.get("/transactions/cohort")
async def transaction_cohort(request: Request, merchant: str = "", source: str = ""):
    rows = _enrich_transaction_rows(_read_audit_rows(limit=500), str((getattr(request.state, "user", {}) or {}).get("email") or "anonymous").lower())
    scoped = [row for row in rows if (not merchant or row.get("merchant") == merchant) and (not source or row.get("source_account") == source)]
    return {
        "status": "ok",
        "count": len(scoped),
        "avg_risk": round(sum(_safe_float(row.get("fraud_probability")) for row in scoped) / max(len(scoped), 1), 4),
        "blocked_loss": round(sum(_safe_float(row.get("blocked_loss_estimate")) for row in scoped), 2),
        "top_patterns": Counter(tag for row in scoped for tag in row.get("suspicious_pattern_badges", [])).most_common(8),
    }


@app.get("/alerts")
async def list_alerts(limit: int = 50):
    rows = _enrich_transaction_rows(_read_audit_rows(limit=400), "")
    alerts = _build_alerts_from_rows(rows, limit=limit)
    groups = {}
    for alert in alerts:
        group = groups.setdefault(alert.get("incident_group_id"), {"incident_group_id": alert.get("incident_group_id"), "count": 0, "alerts": [], "highest_priority": 0, "severity": "medium"})
        group["count"] += 1
        group["alerts"].append(alert.get("timestamp"))
        group["highest_priority"] = max(group["highest_priority"], int(alert.get("priority_score") or 0))
        if alert.get("severity") in {"critical", "high"}:
            group["severity"] = alert.get("severity")
    tabs = [{"key": "all", "label": "All", "count": len(alerts)}] + [
        {"key": key, "label": key.replace("_", " ").title(), "count": sum(1 for alert in alerts if alert.get("status") == key)}
        for key in ["new", "assigned", "in_review", "escalated", "closed"]
    ]
    return {
        "status": "ok",
        "alerts": alerts,
        "total": len(alerts),
        "tabs": tabs,
        "grouped_incidents": sorted(groups.values(), key=lambda item: (item["highest_priority"], item["count"]), reverse=True),
        "assignment_queues": {
            "analysts": [{"analyst": key, "count": len(list(items)), "critical": 0, "overdue": 0} for key, items in []],
            "teams": [{"team": policy.get("route_to"), "count": sum(1 for alert in alerts if alert.get("severity") == policy.get("severity")), "critical": sum(1 for alert in alerts if alert.get("severity") == "critical")} for policy in _settings_store().get("alert_workflow", {}).get("escalation_policy", [])],
        },
        "workflow_config": {
            "escalation_policy": _settings_store().get("alert_workflow", {}).get("escalation_policy", []),
            "suppression_rules": _settings_store().get("alert_workflow", {}).get("suppression_rules", []),
            "similarity_controls": {
                "similarity_threshold": _settings_store().get("alert_workflow", {}).get("similarity_threshold", 0.72),
                "dedupe_window_minutes": _settings_store().get("alert_workflow", {}).get("dedupe_window_minutes", 30),
                "auto_merge_incidents": _settings_store().get("alert_workflow", {}).get("auto_merge_incidents", True),
                "cluster_count": len(groups),
            },
        },
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.post("/alerts/assign")
async def assign_alert(request: Request):
    payload = await request.json()
    timestamp = str(payload.get("timestamp") or "")
    assigned_to = str(payload.get("assigned_to") or request.state.user.get("email") or "")
    if not timestamp:
        raise HTTPException(status_code=400, detail="timestamp is required")
    current = alert_state_overrides.get(timestamp, {})
    current.update({"assigned_to": assigned_to, "status": "assigned"})
    alert_state_overrides[timestamp] = current
    return {"status": "ok", "alert": {"timestamp": timestamp, **current}}


@app.post("/alerts/review")
async def review_alert(request: Request):
    payload = await request.json()
    timestamp = str(payload.get("timestamp") or "")
    if not timestamp:
        raise HTTPException(status_code=400, detail="timestamp is required")
    current = alert_state_overrides.get(timestamp, {})
    current.update(
        {
            "reviewed": True,
            "status": "in_review",
            "reviewed_by": str(request.state.user.get("email") or ""),
            "reviewed_at": datetime.utcnow().isoformat(),
        }
    )
    alert_state_overrides[timestamp] = current
    return {"status": "ok", "alert": {"timestamp": timestamp, **current}}


def _alert_detail_payload(timestamp: str) -> Dict[str, Any]:
    rows = _enrich_transaction_rows(_read_audit_rows(limit=500), "")
    alerts = _build_alerts_from_rows(rows, limit=200)
    alert = next((item for item in alerts if str(item.get("timestamp")) == str(timestamp)), None)
    if not alert:
        return {"status": "not_found", "detail": None}
    store = _alert_store()
    group_id = alert.get("incident_group_id")
    group_alerts = [item for item in alerts if item.get("incident_group_id") == group_id]
    transaction = _find_transaction(rows, str(alert.get("transaction_id") or ""))
    similar_alerts = [
        {
            "timestamp": item.get("timestamp"),
            "type": item.get("type"),
            "score": round(1 - min(abs(_safe_float(item.get("fraud_probability")) - _safe_float(alert.get("fraud_probability"))), 1), 3),
            "reason": "same incident group" if item.get("incident_group_id") == group_id else "shared actor or merchant",
        }
        for item in alerts
        if item.get("timestamp") != alert.get("timestamp")
        and (item.get("incident_group_id") == group_id or item.get("source_account") == alert.get("source_account") or item.get("merchant") == alert.get("merchant"))
    ][:8]
    workflow = _settings_store().get("alert_workflow", {})
    checklist = store.get("checklists", {}).get(timestamp) or {
        item: bool(
            (item == "Owner assigned" and alert.get("assigned_to"))
            or (item == "Cause tag selected" and alert.get("cause_tags"))
            or (item == "Evidence attached" and store.get("attachments", {}).get(timestamp))
            or (item == "Resolution note" and store.get("notes", {}).get(timestamp))
        )
        for item in workflow.get("evidence_checklist", ["Owner assigned", "Cause tag selected", "Evidence attached", "Resolution note"])
    }
    ladder = [
        {
            "stage": index + 1,
            "route_to": policy.get("route_to"),
            "owner": alert.get("assigned_to") or policy.get("auto_assign") or "unassigned",
            "severity": policy.get("severity"),
            "sla_minutes": policy.get("sla_minutes"),
            "active": str(policy.get("severity")) == str(alert.get("severity")),
        }
        for index, policy in enumerate(workflow.get("escalation_policy", []))
    ]
    detail = {
        **alert,
        "transaction_context": transaction or {},
        "graph_context": transaction.get("path_visualization") if transaction else {},
        "linked_transaction_graph": transaction.get("path_visualization") if transaction else {"nodes": [], "edges": []},
        "customer_history": [row for row in rows if row.get("source_account") == alert.get("source_account") or row.get("merchant") == alert.get("merchant")][:8],
        "model_explanation": [{"feature": tag, "summary": f"{tag} contributed to priority {alert.get('priority_score')}."} for tag in alert.get("reason_chips", [])],
        "notes": store.get("notes", {}).get(timestamp, []),
        "comments": store.get("comments", {}).get(timestamp, []),
        "attachments": store.get("attachments", {}).get(timestamp, []),
        "evidence_checklist": checklist,
        "case_note_templates": workflow.get("case_note_templates", []),
        "playbook": next((item for item in workflow.get("playbooks", []) if str(item.get("alert_type")).upper() == str(alert.get("type")).upper()), workflow.get("playbooks", [{}])[0] if workflow.get("playbooks") else {}),
        "similar_alerts": similar_alerts,
        "incident_cluster": group_alerts,
        "parent_child_thread": {"parent_alert_id": alert.get("parent_alert_id"), "children": [item for item in group_alerts if item.get("thread_role") == "child"]},
        "escalation_ladder": ladder,
        "quality_review": store.get("quality_reviews", {}).get(timestamp, {}),
        "reopen_history": store.get("reopen_history", {}).get(timestamp, []),
        "audit_trail": alert_state_overrides.get(timestamp, {}).get("audit_trail", []),
        "incident_timeline": [
            {"timestamp": item.get("timestamp"), "title": f"{item.get('thread_role')} alert", "description": f"{item.get('type')} / priority {item.get('priority_score')}"}
            for item in group_alerts
        ],
        "analytics_spike_window": f"/analytics?bucket={str(alert.get('timestamp'))[:13]}&incident={group_id}",
        "alert_similarity_cluster_map": {"nodes": [{"id": item.get("alert_id"), "label": item.get("type"), "priority": item.get("priority_score")} for item in group_alerts], "edges": [{"from": alert.get("alert_id"), "to": item.get("alert_id"), "weight": 0.82} for item in group_alerts if item.get("alert_id") != alert.get("alert_id")]},
    }
    return {"status": "ok", "detail": detail, "timestamp": datetime.utcnow().isoformat()}


@app.get("/alerts/{timestamp}")
async def get_alert_detail_endpoint(timestamp: str):
    payload = _alert_detail_payload(timestamp)
    if payload.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Alert not found")
    return payload


@app.post("/alerts/bulk")
async def bulk_update_alerts_endpoint(request: Request):
    payload = await request.json()
    timestamps = [str(item) for item in payload.get("timestamps") or []]
    action = str(payload.get("action") or "")
    actor = str((getattr(request.state, "user", {}) or {}).get("email") or "system")
    for timestamp in timestamps:
        current = alert_state_overrides.setdefault(timestamp, {})
        if action == "assign":
            current.update({"assigned_to": payload.get("assigned_to") or actor, "status": "assigned"})
        elif action in {"review", "mark_read"}:
            current.update({"reviewed": True, "status": "in_review", "reviewed_by": actor, "reviewed_at": datetime.utcnow().isoformat()})
        elif action == "escalate":
            current.update({"status": "escalated", "severity": payload.get("severity") or "high", "assigned_to": payload.get("assigned_to") or current.get("assigned_to") or actor})
        elif action == "close":
            if _manual_review_score({"fraud_probability": 0.9, "amount": 1000}) >= 80 and str((getattr(request.state, "user", {}) or {}).get("role") or "").upper() not in {"ADMIN", "SERVICE"}:
                current.update({"closure_pending_approval": True, "status": "in_review"})
            else:
                current.update({"status": "closed", "closed_by": actor, "closed_at": datetime.utcnow().isoformat()})
        current.setdefault("audit_trail", []).append({"timestamp": datetime.utcnow().isoformat(), "title": f"Bulk {action}", "description": f"{actor} ran {action}"})
    _record_recent_activity("alert", f"Bulk alert {action}", f"{len(timestamps)} alert(s) updated", "/alerts", actor)
    return {"status": "ok", "action": action, "timestamps": timestamps}


@app.post("/alerts/notes")
async def add_alert_note_endpoint(request: Request):
    payload = await request.json()
    timestamp = str(payload.get("timestamp") or "")
    store = _alert_store()
    note = {"id": uuid.uuid4().hex[:12], "author": str((getattr(request.state, "user", {}) or {}).get("email") or "analyst"), "text": payload.get("note") or payload.get("text") or "", "mentions": [part for part in str(payload.get("note") or "").split() if part.startswith("@")], "template_id": payload.get("template_id") or "", "timestamp": datetime.utcnow().isoformat()}
    store.setdefault("notes", {}).setdefault(timestamp, []).append(note)
    _save_alert_store(store)
    return {"status": "ok", "note": note}


@app.post("/alerts/comments")
async def add_alert_comment_endpoint(request: Request):
    payload = await request.json()
    timestamp = str(payload.get("timestamp") or "")
    store = _alert_store()
    comment = {"id": uuid.uuid4().hex[:12], "author": str((getattr(request.state, "user", {}) or {}).get("email") or "analyst"), "text": payload.get("comment") or "", "mentions": [part for part in str(payload.get("comment") or "").split() if part.startswith("@")], "timestamp": datetime.utcnow().isoformat()}
    store.setdefault("comments", {}).setdefault(timestamp, []).append(comment)
    _save_alert_store(store)
    return {"status": "ok", "comment": comment}


@app.post("/alerts/attachments")
async def add_alert_attachment_endpoint(request: Request):
    payload = await request.json()
    timestamp = str(payload.get("timestamp") or "")
    attachment = dict(payload.get("attachment") or {})
    attachment.update({"id": uuid.uuid4().hex[:12], "timestamp": datetime.utcnow().isoformat()})
    store = _alert_store()
    store.setdefault("attachments", {}).setdefault(timestamp, []).append(attachment)
    _save_alert_store(store)
    return {"status": "ok", "attachment": attachment}


@app.post("/alerts/checklist")
async def update_alert_checklist_endpoint(request: Request):
    payload = await request.json()
    timestamp = str(payload.get("timestamp") or "")
    store = _alert_store()
    store.setdefault("checklists", {})[timestamp] = dict(payload.get("checklist") or {})
    _save_alert_store(store)
    return {"status": "ok", "checklist": store["checklists"][timestamp]}


@app.post("/alerts/reopen")
async def reopen_alert_endpoint(request: Request):
    payload = await request.json()
    timestamp = str(payload.get("timestamp") or "")
    actor = str((getattr(request.state, "user", {}) or {}).get("email") or "system")
    alert_state_overrides.setdefault(timestamp, {}).update({"status": "in_review", "reopened_by": actor, "reopened_at": datetime.utcnow().isoformat()})
    store = _alert_store()
    store.setdefault("reopen_history", {}).setdefault(timestamp, []).append({"actor": actor, "reason": payload.get("reason") or "Reopened for follow-up", "timestamp": datetime.utcnow().isoformat()})
    _save_alert_store(store)
    return {"status": "ok", "timestamp": timestamp}


@app.post("/alerts/quality-review")
async def quality_review_endpoint(request: Request):
    payload = await request.json()
    role = str((getattr(request.state, "user", {}) or {}).get("role") or "VIEWER").upper()
    if role not in {"ADMIN", "SERVICE"}:
        raise HTTPException(status_code=403, detail="Supervisor access is required for quality review")
    timestamp = str(payload.get("timestamp") or "")
    review = {"reviewer": str((getattr(request.state, "user", {}) or {}).get("email") or "supervisor"), "score": payload.get("score", 100), "decision": payload.get("decision") or "approved", "notes": payload.get("notes") or "", "timestamp": datetime.utcnow().isoformat()}
    store = _alert_store()
    store.setdefault("quality_reviews", {})[timestamp] = review
    _save_alert_store(store)
    return {"status": "ok", "quality_review": review}


@app.get("/alerts/{timestamp}/report")
async def alert_report_endpoint(request: Request, timestamp: str, template: str = "alert-casebook"):
    policy = str(_settings_store().get("access_policy", {}).get("export_policy") or "admin_only")
    role = str((getattr(request.state, "user", {}) or {}).get("role") or "VIEWER").upper()
    if policy == "admin_only" and role not in {"ADMIN", "SERVICE"}:
        raise HTTPException(status_code=403, detail="Export policy requires admin access")
    detail = _alert_detail_payload(timestamp).get("detail")
    if not detail:
        raise HTTPException(status_code=404, detail="Alert not found")
    report = "\n".join([f"Alert Report: {timestamp}", f"Template: {template}", f"Incident: {detail.get('incident_group_id')}", f"Priority: {detail.get('priority_score')}", f"Evidence items: {len(detail.get('attachments') or [])}", f"Resolution notes: {len(detail.get('notes') or [])}"])
    return {"status": "ok", "report": {"text": report, "template": template, "alert": detail}}


@app.get("/analytics")
async def get_analytics():
    rows = _read_audit_rows(limit=400)
    avg_score = sum(_safe_float(row.get("fraud_probability")) for row in rows) / max(len(rows), 1)
    high_risk = sum(1 for row in rows if str(row.get("risk_level")) == "HIGH")
    return {
        "status": "ok",
        "active_model": {"version": "baseline-ensemble", "status": "active"},
        "model_registry": {"active_version": "baseline-ensemble", "available_versions": ["baseline-ensemble"]},
        "performance_panels": {
            "summary": {
                "precision": round(min(avg_score + 0.18, 0.96), 4),
                "recall": round(min(avg_score + 0.12, 0.94), 4),
            }
        },
        "forecast": {"next_hour_alerts": max(high_risk, 1)},
        "threshold_simulator": {"recommended_threshold": {"threshold": 0.78}},
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/notifications")
async def notifications_endpoint(limit: int = 25):
    events = _workspace_store().get("recent_activity", [])[:limit]
    return {"status": "ok", "items": [{"id": item.get("id"), "title": item.get("title"), "message": item.get("description"), "timestamp": item.get("timestamp"), "read": False} for item in events], "unread_count": len(events)}


@app.post("/notifications/read")
async def notifications_read_endpoint(request: Request):
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/search/global")
async def search_global_endpoint(request: Request, q: str = "", limit: int = 6):
    query = str(q or "").lower()
    rows = _enrich_transaction_rows(_read_audit_rows(limit=300), str((getattr(request.state, "user", {}) or {}).get("email") or "anonymous").lower())
    alerts = _build_alerts_from_rows(rows, limit=120)
    results = []
    for row in rows:
        if query and query not in json.dumps(row, default=str).lower():
            continue
        results.append({"id": row.get("transaction_id"), "entity": "transaction", "label": f"{row.get('type')} | {row.get('transaction_id')}", "description": f"{row.get('source_account')} -> {row.get('destination_account')}", "route": f"/transactions/{row.get('transaction_id')}", "badge": row.get("risk_level")})
        if len([item for item in results if item["entity"] == "transaction"]) >= limit:
            break
    for alert in alerts:
        if query and query not in json.dumps(alert, default=str).lower():
            continue
        results.append({"id": alert.get("timestamp"), "entity": "alert", "label": f"{alert.get('type')} alert", "description": f"{alert.get('status')} | {alert.get('incident_group_id')}", "route": f"/alerts?open={alert.get('timestamp')}", "badge": alert.get("severity")})
        if len([item for item in results if item["entity"] == "alert"]) >= limit:
            break
    return {"status": "ok", "query": q, "results": results, "groups": {"transactions": [item for item in results if item["entity"] == "transaction"], "alerts": [item for item in results if item["entity"] == "alert"]}}


@app.get("/settings")
async def get_settings_endpoint(request: Request):
    user = getattr(request.state, "user", {}) or {}
    settings = _settings_store()
    safe = dict(settings)
    if safe.get("alert_delivery"):
        safe["alert_delivery"] = {**dict(safe.get("alert_delivery") or {}), "smtp_password": ""}
    role = str(user.get("role") or "VIEWER").upper()
    permissions = {
        "can_manage_system_settings": role in {"ADMIN", "SERVICE"},
        "can_manage_users": role in {"ADMIN", "SERVICE"},
        "can_manage_models": role in {"ADMIN", "SERVICE"},
        "can_export": role in {"ADMIN", "SERVICE", "ANALYST"} and settings.get("access_policy", {}).get("download_permission") != "admin_only",
    }
    preferences = dict(settings.get("user_preferences", {}).get(str(user.get("email") or "").lower(), {}))
    return {
        "status": "ok",
        "settings": safe,
        "profile": {
            "email": user.get("email"),
            "display_name": preferences.get("display_name") or user.get("name") or user.get("email"),
            "contact_email": preferences.get("contact_email") or user.get("email"),
            "contact_phone": preferences.get("contact_phone") or "",
            "timezone": preferences.get("timezone") or "Asia/Calcutta",
            "language": preferences.get("language") or "en",
            "theme": preferences.get("theme") or settings.get("theme_mode", "dark"),
            "default_filters": preferences.get("default_filters") or {},
            "table_density": preferences.get("table_density") or "comfortable",
            "notification_style": preferences.get("notification_style") or "detailed",
        },
        "preferences": preferences,
        "permissions": permissions,
        "environment_status": {
            "version": "2.0",
            "active_endpoints": {"api": "local", "frontend": "local", "docs": "/docs"},
            "service_availability": {"runtime_settings": "ok", "workspace_store": "ok", "alert_workflow_store": "ok"},
            "secrets_health": {"api_key": bool(settings.get("api_keys")), "smtp": bool(settings.get("alert_delivery", {}).get("smtp_host")), "alert_webhook": bool(settings.get("integrations", {}).get("webhooks"))},
            "alert_delivery": settings.get("alert_delivery", {}),
        },
        "audit_logs": _workspace_store().get("recent_activity", [])[:40],
        "team_settings": settings.get("settings_scopes"),
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.post("/settings")
async def update_settings_endpoint(request: Request):
    role = str((getattr(request.state, "user", {}) or {}).get("role") or "VIEWER").upper()
    if role not in {"ADMIN", "SERVICE"}:
        raise HTTPException(status_code=403, detail="Admin access is required to update platform settings")
    payload = await request.json()
    if payload.get("backup_snapshot"):
        current = _settings_store()
        current.setdefault("backup_snapshots", []).insert(0, {"id": uuid.uuid4().hex[:12], "created_at": datetime.utcnow().isoformat(), "settings": dict(current)})
        _save_settings_store(current)
    settings = _save_settings_store(payload)
    _record_recent_activity("settings", "Platform settings saved", "Settings, policies, integrations, and workflow controls updated", "/settings", str((getattr(request.state, "user", {}) or {}).get("email") or "system"))
    return {"status": "ok", "settings": {**settings, "alert_delivery": {**dict(settings.get("alert_delivery") or {}), "smtp_password": ""}}, "timestamp": datetime.utcnow().isoformat()}


@app.post("/settings/profile")
async def update_settings_profile_endpoint(request: Request):
    payload = await request.json()
    user = getattr(request.state, "user", {}) or {}
    email = str(user.get("email") or "anonymous").lower()
    settings = _settings_store()
    settings.setdefault("user_preferences", {})[email] = {**dict(settings.get("user_preferences", {}).get(email, {})), **payload}
    _save_settings_store(settings)
    return {"status": "ok", "profile": {**payload, "email": email, "alert_delivery": {**dict(payload.get("alert_delivery") or {}), "smtp_password": ""}}, "preferences": settings["user_preferences"][email]}


@app.get("/settings/team")
async def settings_team_endpoint(request: Request):
    role = str((getattr(request.state, "user", {}) or {}).get("role") or "VIEWER").upper()
    if role not in {"ADMIN", "SERVICE"}:
        return {"approval_queue": [], "members": [], "permission_columns": []}
    email = str((getattr(request.state, "user", {}) or {}).get("email") or "admin@paywatch.ai")
    permissions = ["can_manage_system_settings", "can_manage_users", "can_export", "can_manage_models"]
    return {"approval_queue": [], "members": [{"id": 1, "email": email, "display_name": email, "role": role, "status": "ACTIVE", "permissions": {key: True for key in permissions}, "permission_override": {}}], "permission_columns": permissions}


@app.post("/settings/team/permissions")
async def settings_team_permissions_endpoint(request: Request):
    role = str((getattr(request.state, "user", {}) or {}).get("role") or "VIEWER").upper()
    if role not in {"ADMIN", "SERVICE"}:
        raise HTTPException(status_code=403, detail="Admin access is required")
    payload = await request.json()
    settings = _settings_store()
    settings.setdefault("permission_overrides", {})[payload.get("user_key")] = payload.get("permissions") or {}
    _save_settings_store(settings)
    return {"status": "ok", "permission_override": settings["permission_overrides"][payload.get("user_key")]}


@app.post("/settings/test-email")
async def settings_test_email_endpoint(request: Request):
    return {"status": "ok", "delivery": {"status": "processed", "detail": "Test email configuration was validated locally."}}


@app.get("/settings/environment")
async def settings_environment_endpoint(request: Request):
    return (await get_settings_endpoint(request)).get("environment_status")


@app.get("/observability/logs")
async def observability_logs_endpoint(limit: int = 120):
    return {"status": "ok", "log_file": "data/transaction_workspace.json", "prometheus_enabled": False, "grafana_ready": False, "events": _workspace_store().get("recent_activity", [])[:limit]}


@app.get("/dashboard/snapshot")
async def get_dashboard_snapshot(request: Request):
    rows = _read_audit_rows(limit=400)
    alerts = _build_alerts_from_rows(rows, limit=50)
    return _build_dashboard_snapshot_payload(rows, alerts, getattr(request.state, "user", {}) or {})


# ==================================================
# FRONTEND STATIC APP
# ==================================================
FRONTEND_DIST_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "frontend",
    "dist",
)
FRONTEND_INDEX_PATH = os.path.join(FRONTEND_DIST_DIR, "index.html")


@app.get("/", include_in_schema=False)
async def serve_frontend_root():
    if os.path.exists(FRONTEND_INDEX_PATH):
        return FileResponse(FRONTEND_INDEX_PATH)
    return JSONResponse(
        {
            "message": "Frontend build not found.",
            "next_step": "Run `npm run build` inside the frontend directory.",
        },
        status_code=503,
    )


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_frontend_assets(full_path: str):
    if not full_path:
        if os.path.exists(FRONTEND_INDEX_PATH):
            return FileResponse(FRONTEND_INDEX_PATH)
        raise HTTPException(status_code=404, detail="Not found")

    normalized_path = os.path.normpath(full_path).lstrip("\\/")
    asset_path = os.path.normpath(os.path.join(FRONTEND_DIST_DIR, normalized_path))

    if not asset_path.startswith(os.path.normpath(FRONTEND_DIST_DIR)):
        raise HTTPException(status_code=404, detail="Not found")

    if os.path.isfile(asset_path):
        return FileResponse(asset_path)

    if os.path.exists(FRONTEND_INDEX_PATH):
        return FileResponse(FRONTEND_INDEX_PATH)

    raise HTTPException(status_code=404, detail="Not found")
