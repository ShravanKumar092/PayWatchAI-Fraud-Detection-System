import streamlit as st
import pandas as pd
import requests
import plotly.express as px
import asyncio
import time
import json
import random
from datetime import datetime
from typing import Any

try:
    import websockets
except Exception:
    websockets = None


JsonDict = dict[str, Any]


def normalise_role(role_value: Any) -> str:
    return str(role_value or "USER").strip().upper()


def ensure_dict_payload(value: Any, *, fallback_error: str = "INVALID_PAYLOAD") -> JsonDict:
    if isinstance(value, dict):
        return value
    return {"error": fallback_error, "message": "The backend returned an unexpected payload format."}

# Decorative repeating currency-symbol background for Streamlit (subtle, behind UI)
background_css = """
<style>
    /* Put decorative symbols behind the app and keep them subtle */
    .stApp {
        position: relative;
        z-index: 1;
    }
    .stApp::before {
        content: "";
        position: fixed;
        left: 0;
        right: 0;
        top: 0;
        height: 180px; /* only show decoration near the top */
        z-index: -1; /* behind Streamlit UI */
        pointer-events: none;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><text x='10' y='50' font-size='36' fill='rgba(0,0,0,0.02)' font-family='Segoe UI, Arial, sans-serif'>₹ $ € £ ¥</text></svg>");
        background-repeat: repeat-x;
        background-position: center top;
        background-size: 220px 180px;
        opacity: 1;
        filter: blur(0.4px);
        transform: translateZ(0);
    }
    /* If dark mode or custom widgets need stacking, ensure content stays above */
    .stApp > * {
        position: relative;
        z-index: 2;
    }
</style>
"""

# Inject the CSS early so it applies to all pages
import streamlit as _st_inject
_st_inject.markdown(background_css, unsafe_allow_html=True)

# ============================================================
# AUTH LOGIN SCREEN (MUST RUN BEFORE EVERYTHING ELSE)
# ============================================================
if "page" not in st.session_state:
    st.session_state.page = "home"  # home, login, register, app


if "token" not in st.session_state:
    st.session_state.token = None

# ============================================================
# LOGIN SCREEN
# ============================================================
if st.session_state.page == "login" and not st.session_state.token:
    st.header("🔐 Login to PayWatch")

    email = st.text_input("Email")
    pwd = st.text_input("Password", type="password")

    if st.button("Login"):
        # Validate inputs
        if not email or not email.strip():
            st.error("Please enter your email address")
            st.stop()
        if not pwd:
            st.error("Please enter your password")
            st.stop()
        
        try:
            res = requests.post(
                "http://127.0.0.1:8020/auth/login",
                json={"email": email.strip().lower(), "password": pwd},
                timeout=10,
                headers={"Content-Type": "application/json"}
            )

            if res.status_code == 200:
                data = res.json()
                st.session_state.token = data["access_token"]
                st.session_state.role = normalise_role(data.get("role"))
                st.session_state.page = "app"
                st.rerun()
            else:
                # Show actual error message from API
                try:
                    error_data = res.json()
                    error_msg = error_data.get("detail", "Invalid credentials")
                    st.error(f"❌ {error_msg}")
                except:
                    st.error(f"❌ Login failed: {res.status_code}")
        except requests.exceptions.ConnectionError:
            st.error("❌ Cannot connect to the API server. Please make sure the server is running.")
        except Exception as e:
            st.error(f"❌ An error occurred: {str(e)}")

    if st.button("⬅ Back"):
        st.session_state.page = "home"
        st.rerun()

    st.stop()
# ============================================================
# REGISTRATION SCREEN
# ============================================================
if st.session_state.page == "register" and not st.session_state.token:
    st.header("📝 Create a New Account")

    name = st.text_input("Full Name")
    email = st.text_input("Email")
    pwd = st.text_input("Password", type="password")
    role = st.selectbox("Role", ["User"])   # later allow admin approval

    if st.button("Create Account"):
        # Validate inputs
        if not name or not name.strip():
            st.error("Please enter your full name")
            st.stop()
        if not email or not email.strip():
            st.error("Please enter your email address")
            st.stop()
        if not pwd or len(pwd.strip()) < 6:
            st.error("Password must be at least 6 characters long")
            st.stop()
        
        # Check if API server is running first
        try:
            health_check = requests.get("http://127.0.0.1:8020/health", timeout=5)
            if health_check.status_code != 200:
                st.error("❌ API server is not responding correctly. Please check if the server is running.")
                st.stop()
        except requests.exceptions.ConnectionError:
            st.error("❌ Cannot connect to the API server. Please make sure the server is running on http://127.0.0.1:8020")
            st.info("💡 Start the API server with: `python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload`")
            st.stop()
        except Exception as e:
            st.warning(f"⚠️ Could not verify API server: {str(e)}")
        
        # Show loading state
        with st.spinner("Creating account..."):
            try:
                res = requests.post(
                    "http://127.0.0.1:8020/auth/signup",
                    json={"name": name.strip(), "email": email.strip().lower(), "password": pwd, "role": role.lower()},
                    timeout=30,
                    headers={"Content-Type": "application/json"}
                )
                
                if res.status_code == 200:
                    data = res.json()
                    st.success(f"✅ Account created successfully! Welcome {data.get('name', name)}!")
                    time.sleep(1)
                    st.session_state.page = "login"
                    st.rerun()
                else:
                    # Show actual error message from API
                    try:
                        error_data = res.json()
                        error_msg = error_data.get("detail", "Registration failed")
                        st.error(f"❌ {error_msg}")
                    except:
                        st.error(f"❌ Registration failed: {res.status_code} - {res.text}")
            except requests.exceptions.ConnectionError:
                st.error("❌ Cannot connect to the API server. Please make sure the server is running on http://127.0.0.1:8020")
            except requests.exceptions.Timeout:
                st.error("❌ Request timed out after 30 seconds. The server may be overloaded or the database operation is taking too long.")
                st.info("💡 Try again, or check the API server logs for errors.")
            except Exception as e:
                st.error(f"❌ An error occurred: {str(e)}")

    if st.button("⬅ Back"):
        st.session_state.page = "home"
        st.rerun()

    st.stop()

# ============================================================
# HOME SCREEN (Landing Page)
# ============================================================
if st.session_state.page == "home":
    st.title("👋 Welcome to PayWatch AI")
    st.write("A Real-Time AI System for Financial Fraud Detection")

    col1, col2 = st.columns(2)
    with col1:
        if st.button("🔐 Login"):
            st.session_state.page = "login"
            st.rerun()
    with col2:
        if st.button("📝 Register"):
            st.session_state.page = "register"
            st.rerun()
    
    st.stop()

# ============================================================
# SESSION STATE INITIALIZATION
# ============================================================
if "simulate" not in st.session_state:
    st.session_state.simulate = False

if "fraud_count" not in st.session_state:
    st.session_state.fraud_count = 0

# Counters only for transactions during active simulation (reset when simulation starts)
if "simulation_tx_count" not in st.session_state:
    st.session_state.simulation_tx_count = 0
if "simulation_high_risk_count" not in st.session_state:
    st.session_state.simulation_high_risk_count = 0

if "risk_history" not in st.session_state:
    st.session_state.risk_history = []

if "tx_history" not in st.session_state:
    st.session_state.tx_history = []
if "user_profile" not in st.session_state:
    st.session_state.user_profile = {
        "avg_amount": 0.0,
        "tx_count": 0,
        "risk_score": 0.0,
        "last_tx_time": time.time()
    }
if "role" not in st.session_state:
    st.session_state.role = "USER"

if "all_transactions" not in st.session_state:
    st.session_state.all_transactions = []

if "insights_generated" not in st.session_state:
    st.session_state.insights_generated = False

if "evaluation_complete" not in st.session_state:
    st.session_state.evaluation_complete = False

# ============================================================
# API CONFIG
# ============================================================
PREDICT_API = "http://127.0.0.1:8020/predict"
STREAM_API = "http://127.0.0.1:8020/stream"
TRANSACTIONS_API = "http://127.0.0.1:8020/transactions"
STATS_API = "http://127.0.0.1:8020/stats"
HEALTH_API = "http://127.0.0.1:8020/health"
WS_API = "ws://127.0.0.1:8020/ws/stream"


async def _fetch_ws_prediction(token: str) -> JsonDict:
    if websockets is None:
        raise RuntimeError("The websockets dependency is not installed.")
    headers = {"Authorization": f"Bearer {token}"}

    try:
        connection = websockets.connect(
            WS_API,
            extra_headers=headers,
            open_timeout=5,
            close_timeout=2,
        )
    except TypeError:
        connection = websockets.connect(
            WS_API,
            additional_headers=headers,
            open_timeout=5,
            close_timeout=2,
        )

    async with connection as websocket:
        payload = await asyncio.wait_for(websocket.recv(), timeout=8)
        return ensure_dict_payload(json.loads(payload), fallback_error="WEBSOCKET_INVALID_PAYLOAD")


def fetch_ws_prediction(token: str | None) -> JsonDict:
    if not token:
        return {"error": "AUTH_REQUIRED", "message": "Login is required before opening the WebSocket stream."}
    try:
        return ensure_dict_payload(asyncio.run(_fetch_ws_prediction(token)), fallback_error="WEBSOCKET_INVALID_PAYLOAD")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return ensure_dict_payload(
                loop.run_until_complete(_fetch_ws_prediction(token)),
                fallback_error="WEBSOCKET_INVALID_PAYLOAD",
            )
        finally:
            loop.close()
    except Exception as e:
        return {"error": "WEBSOCKET_ERROR", "message": str(e)}


def fetch_poll_transaction(token: str | None) -> JsonDict:
    if not token:
        return {"error": "AUTH_REQUIRED", "message": "Login is required before polling transactions."}

    try:
        res = requests.get(
            TRANSACTIONS_API,
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
        if res.status_code != 200:
            try:
                error_json = res.json()
                error_detail = error_json.get("detail", res.text)
            except Exception:
                error_detail = res.text
            return {"error": f"POLLING_ERROR: {res.status_code}", "message": error_detail}

        payload = ensure_dict_payload(res.json(), fallback_error="POLLING_INVALID_PAYLOAD")
        if "error" in payload:
            return payload

        tx = payload.get("transaction")
        if isinstance(tx, dict):
            return tx

        transactions = payload.get("transactions") or []
        if isinstance(transactions, list):
            for candidate in reversed(transactions):
                if isinstance(candidate, dict):
                    return candidate

        return {"error": "POLLING_EMPTY", "message": "No transaction data was returned by the backend."}
    except requests.exceptions.ConnectionError:
        return {"error": "CONNECTION_ERROR", "message": "Cannot connect to the API polling endpoint."}
    except requests.exceptions.Timeout:
        return {"error": "TIMEOUT", "message": "The API polling endpoint took too long to respond."}
    except Exception as e:
        return {"error": "UNKNOWN_ERROR", "message": str(e)}


# ============================================================
# 🔄 IMPROVED: API HEALTH CHECK
# ============================================================
def check_api_health():
    """Check if API server is running and accessible"""
    try:
        response = requests.get(HEALTH_API, timeout=5)
        if response.status_code == 200:
            try:
                return True, response.json()
            except:
                return True, {"status": "UP"}
        return False, f"HTTP_{response.status_code}"
    except requests.exceptions.ConnectionError:
        return False, "CONNECTION_REFUSED"
    except requests.exceptions.Timeout:
        return False, "TIMEOUT"
    except requests.exceptions.RequestException as e:
        return False, f"REQUEST_ERROR: {str(e)}"
    except Exception as e:
        return False, f"UNKNOWN_ERROR: {str(e)}"

def get_api_status_message():
    """Get user-friendly API status message"""
    is_healthy, info = check_api_health()
    if is_healthy:
        return "🟢 API Server: Online", "success"
    else:
        if info == "CONNECTION_REFUSED":
            return "🔴 API Server: Offline - Server not running", "error"
        elif info == "TIMEOUT":
            return "🟡 API Server: Timeout - Server may be slow or unresponsive", "warning"
        elif isinstance(info, str) and "REQUEST_ERROR" in info:
            return "🟡 API Server: Connection issue - Check if server is starting", "warning"
        else:
            return f"🔴 API Server: Error - {info}", "error"

def call_fraud_api(input_data: JsonDict) -> JsonDict:
    """Call fraud prediction API with improved error handling"""
    try:
        headers = {"Authorization": f"Bearer {st.session_state.token}"}

        res = requests.post(PREDICT_API, json=input_data, headers=headers, timeout=5)
        if res.status_code != 200:
            # Try to extract error detail from JSON response
            try:
                error_json = res.json()
                error_detail = error_json.get('detail', res.text)
            except:
                error_detail = res.text
            return {"error": f"API_ERROR: {res.status_code}", "message": error_detail}
        payload = ensure_dict_payload(res.json(), fallback_error="INVALID_API_RESPONSE")
        if "error" in payload:
            return payload
        return payload
    except requests.exceptions.ConnectionError:
        return {"error": "CONNECTION_ERROR", "message": "Cannot connect to API server. Please ensure the server is running on port 8020."}
    except requests.exceptions.Timeout:
        return {"error": "TIMEOUT", "message": "API server took too long to respond."}
    except Exception as e:
        return {"error": "UNKNOWN_ERROR", "message": str(e)}


# Currency formatting helper (uses Babel when available, falls back safely)
def format_currency(amount, currency='USD', locale='en_US'):
    try:
        # Try to use Babel if installed for proper locale formatting
        from babel.numbers import format_currency as _format_currency
        return _format_currency(amount, currency, locale=locale)
    except Exception:
        # Fallback: simple symbol map + comma grouping
        symbols = {
            'USD': '$', 'INR': '₹', 'EUR': '€', 'GBP': '£', 'JPY': '¥',
            'AUD': 'A$', 'CAD': 'C$'
        }
        sym = symbols.get((currency or 'USD').upper(), '')
        if sym:
            return f"{sym}{amount:,.2f}"
        return f"{amount:,.2f} {currency.upper()}"
# ============================================================
# 🔹 DECISION INTELLIGENCE ENGINE (UPGRADE 4)
# ============================================================
def decision_engine(risk_level, confidence):
    if risk_level == "HIGH" and confidence >= 0.85:
        return "⛔ BLOCK TRANSACTION"
    elif risk_level == "HIGH":
        return "🕵️ MANUAL REVIEW REQUIRED"
    elif risk_level == "MEDIUM":
        return "👀 MONITOR TRANSACTION"
    else:
        return "✅ ALLOW TRANSACTION"
# ============================================================
# TITLE
# ============================================================
# Stop if user is not logged in
if st.session_state.page != "app" or not st.session_state.token:
    st.stop()


st.markdown(
    "<h1 style='text-align:center; color:#00E5FF;'>🚨 PayWatch AI - Fraud Detection System 🛡️</h1>",
    unsafe_allow_html=True
)
st.write("### ⚡ Real-time Financial Transaction Risk Analysis & Fraud Identification")

# ============================================================
# 🔄 IMPROVED: API STATUS INDICATOR
# ============================================================
status_msg, status_type = get_api_status_message()
if status_type == "success":
    st.success(status_msg)
elif status_type == "error":
    st.error(status_msg)
    with st.expander("📋 How to Start the API Server", expanded=False):
        st.code("""
# Option 1: Using PowerShell
python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload

# Option 2: Using the restart script
.\\restart_api.ps1

# Option 3: Using Command Prompt
python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload
        """, language="bash")
    st.info("💡 **Tip**: Keep the API server running in a separate terminal while using this dashboard.")
else:
    st.warning(status_msg)

# ============================================================
# TEST CASES
# ============================================================
st.sidebar.header("🔍 Test Cases")

# Locale selector for currency formatting
locales = ['en_US', 'en_GB', 'hi_IN', 'ja_JP', 'fr_FR']
default_locale = st.session_state.get('currency_locale', 'en_US')
sel_locale = st.sidebar.selectbox("Currency Locale", locales, index=locales.index(default_locale) if default_locale in locales else 0)
st.session_state['currency_locale'] = sel_locale

test_cases = {
    "Legit - Payment": {
        "step": 1, "type": "PAYMENT", "amount": 100,
        "oldbalanceOrg": 200, "newbalanceOrig": 100,
        "oldbalanceDest": 50, "newbalanceDest": 150
    },
    "Fraud - Transfer": {
        "step": 1, "type": "TRANSFER", "amount": 5000,
        "oldbalanceOrg": 0, "newbalanceOrig": 0,
        "oldbalanceDest": 0, "newbalanceDest": 5000
    }
}

option = st.sidebar.selectbox("Select Example", list(test_cases.keys()))

if st.sidebar.button("Run Test Case"):
    # Check API health first
    is_healthy, _ = check_api_health()
    if not is_healthy:
        st.error("❌ API Server is not running. Please start it first.")
        st.stop()
    
    input_data = test_cases[option]
    # Format amount column according to selected locale
    df = pd.DataFrame([input_data])
    try:
        df_display = df.copy()
        df_display['amount'] = df_display['amount'].apply(lambda x: format_currency(x, 'USD', st.session_state.get('currency_locale','en_US')))
    except Exception:
        df_display = df
    st.table(df_display)

    test_response = call_fraud_api(input_data)

    if "error" not in test_response:
        prob = test_response.get("fraud_probability", 0)
        try:
            prob = float(prob)
        except Exception:
            prob = 0.0

        risk_level = str(test_response.get("risk_level", "LOW") or "LOW")

        confidence = abs(prob - 0.5) * 2
        confidence_pct = round(confidence * 100, 2)

        st.success(f"Risk Level: {risk_level}")
        # Show formatted amount for clarity
        try:
            amt = input_data.get('amount', 0)
            st.write(f"**Amount:** {format_currency(amt, 'USD', st.session_state.get('currency_locale','en_US'))}")
        except Exception:
            pass
        st.metric("Fraud Probability (%)", round(prob * 100, 2))
        st.metric("🎯 Prediction Confidence (%)", confidence_pct)

        with st.expander("🧠 Prediction Insights"):
            for r in test_response.get("explanation", []):
                st.write("•", r)
    else:
        error_type = test_response.get('error', 'UNKNOWN_ERROR')
        error_message = test_response.get('message', 'An unknown error occurred')
        st.error(f"❌ **Error**: {error_type}")
        if error_message:
            st.info(f"💡 {error_message}")

# ============================================================
# CUSTOM INPUT SECTION
# ============================================================
st.markdown("---")
st.header("🧾 Custom Transaction Input")

with st.form("custom_input_form"):
    col1, col2 = st.columns(2)

    with col1:
        step = st.number_input("Step (Time)", 1)
        tx_type = st.selectbox(
            "Transaction Type",
            ["PAYMENT", "TRANSFER", "CASH_OUT", "CASH_IN", "DEBIT"]
        )
        amount = st.number_input("Amount", 1000.0)
        oldbalanceOrg = st.number_input("Old Balance (Sender)", 2000.0)

    with col2:
        newbalanceOrig = st.number_input("New Balance (Sender)", 1000.0)
        oldbalanceDest = st.number_input("Old Balance (Receiver)", 0.0)
        newbalanceDest = st.number_input("New Balance (Receiver)", 1000.0)

    submitted = st.form_submit_button("Predict")

if submitted:
    # Check API health first
    is_healthy, _ = check_api_health()
    if not is_healthy:
        st.error("❌ API Server is not running. Please start it first.")
        st.stop()
    payload = {
        "step": step,
        "type": tx_type,
        "amount": amount,
        "oldbalanceOrg": oldbalanceOrg,
        "newbalanceOrig": newbalanceOrig,
        "oldbalanceDest": oldbalanceDest,
        "newbalanceDest": newbalanceDest
    }

    custom_response = call_fraud_api(payload)

    if "error" not in custom_response:
        prob = custom_response.get("fraud_probability", 0)
        try:
            prob = float(prob)
        except Exception:
            prob = 0.0
        # Show formatted amount for custom input
        try:
            st.write(f"**Amount:** {format_currency(amount, 'USD', st.session_state.get('currency_locale','en_US'))}")
        except Exception:
            pass

        confidence = abs(prob - 0.5) * 2
        confidence_pct = round(confidence * 100, 2)

        st.success(f"Risk Level: {custom_response['risk_level']}")
        st.metric("Fraud Probability (%)", round(prob * 100, 2))
        st.metric("🎯 Prediction Confidence (%)", confidence_pct)

        with st.expander("🧠 Prediction Insights"):
            for r in custom_response.get("explanation", []):
                st.write("•", r)
    else:
        error_type = custom_response.get('error', 'UNKNOWN_ERROR')
        error_message = custom_response.get('message', 'An unknown error occurred')
        st.error(f"❌ **Error**: {error_type}")
        if error_message:
            st.info(f"💡 {error_message}")

# ============================================================
# CSV UPLOAD – BULK PREDICTION
# ============================================================
st.markdown("---")
st.header("📂 Upload CSV for Bulk Fraud Detection")

upload = st.file_uploader("Upload CSV", type=["csv"])

if upload:
    df = pd.read_csv(upload)
    st.dataframe(df.head(),width='stretch')

    risks, probs, confs = [], [], []


    for _, row in df.iterrows():
        row_payload: JsonDict = {str(key): value for key, value in row.to_dict().items()}
        res = call_fraud_api(row_payload)
        prob = res.get("fraud_probability", 0)
        try:
            prob = float(prob)
        except Exception:
            prob = 0.0

        confidence = abs(prob - 0.5) * 2
        confidence_pct = round(confidence * 100, 2)

        risks.append(res.get("risk_level", "ERROR"))
        probs.append(prob)
        confs.append(confidence_pct)

    df["Risk Level"] = risks
    df["Fraud Probability"] = probs
    df["Confidence (%)"] = confs
    st.dataframe(df,width='stretch')

# ============================================================
# DASHBOARD
# ============================================================
st.markdown("---")
st.header("📊 Fraud Analytics Dashboard")

col1, col2 = st.columns([3, 1])

with col1:
    if st.button("Generate Insights", key="generate_insights_btn"):
        st.session_state.insights_generated = True
        st.session_state.evaluation_complete = False

with col2:
    if st.session_state.insights_generated:
        st.caption(f"Status: {'✅ Complete' if st.session_state.evaluation_complete else '⏳ Evaluating...'}")

# Show insights only after evaluation is complete
if st.session_state.insights_generated:
    if not st.session_state.evaluation_complete:
        with st.spinner("📊 Evaluating data... This may take a moment"):
            try:
                data = pd.read_csv("Fraud_Analysis_Dataset.csv")
                time.sleep(1)  # Simulate evaluation time
                st.session_state.evaluation_complete = True
                st.rerun()
            except Exception as e:
                st.error(f"Error loading data: {str(e)}")
                st.session_state.insights_generated = False
    
    if st.session_state.evaluation_complete:
        st.success("✅ Data evaluation complete!")
        st.markdown("---")
        
        # Display insights
        try:
            data = pd.read_csv("Fraud_Analysis_Dataset.csv")
            
            # Metrics
            col1, col2, col3 = st.columns(3)
            with col1:
                st.metric("Total Transactions", len(data))
            with col2:
                st.metric("Frauds Detected", int(data["isFraud"].sum()))
            with col3:
                fraud_rate = (data["isFraud"].sum() / len(data)) * 100
                st.metric("Fraud Rate (%)", f"{fraud_rate:.2f}%")
            
            st.markdown("---")
            
            # Charts
            st.subheader("📈 Fraud Analysis")
            fig = px.bar(
                data, x="type", color="isFraud",
                title="Fraud Count by Transaction Type",
                labels={"type": "Transaction Type", "isFraud": "Fraud Status"}
            )
            st.plotly_chart(fig, use_container_width=True)
            
            # Additional insights
            st.subheader("💡 Key Insights")
            st.info(f"📌 Most common fraud transaction type: {data[data['isFraud']==1]['type'].mode().values[0] if len(data[data['isFraud']==1]) > 0 else 'N/A'}")
            
        except Exception as e:
            st.error(f"Error generating insights: {str(e)}")
        
        # Reset button
        if st.button("🔄 Clear Insights", key="clear_insights_btn"):
            st.session_state.insights_generated = False
            st.session_state.evaluation_complete = False
            st.rerun()

# ============================================================
# 🔄 REAL-TIME UPGRADE: STATISTICS DASHBOARD
# ============================================================
# REAL-TIME SYSTEM STATISTICS (Redis or Local Fallback)
# ============================================================
st.markdown("---")
st.header("📊 Real-Time System Statistics")

# Create placeholders for real-time updates during simulation
stats_placeholder = st.empty()
alerts_placeholder = st.empty()

def refresh_stats_display():
    """Refresh the statistics display during simulation"""
    try:
        # Call stats endpoint with API key and robust error handling
        res = requests.get(
            STATS_API,
            headers={"Authorization": f"Bearer {st.session_state.token}"},
            timeout=5,
        )

        if res.status_code != 200:
            with stats_placeholder.container():
                st.error(f"⚠️ Stats API Error: {res.status_code}")
        else:
            raw_body = res.text
            try:
                stats = res.json()
            except ValueError:
                # Backend returned non‑JSON content
                with stats_placeholder.container():
                    st.error("❌ Stats API returned invalid JSON")
            else:
                status = stats.get("status")

                if status == "ok":
                    # Decide mode based on redis_enabled flag
                    with stats_placeholder.container():
                        if stats.get("redis_enabled"):
                            st.success("✔ Redis Live Stats Active")

                            col1, col2, col3 = st.columns(3)
                            with col1:
                                st.metric("Total Transactions", stats.get("total_transactions", 0))
                            with col2:
                                st.metric("High Risk Count", stats.get("high_risk_count", 0))
                            with col3:
                                if stats.get("total_transactions", 0):
                                    rate = (stats.get("high_risk_count", 0) / stats.get("total_transactions", 1)) * 100
                                    st.metric("High-Risk Rate (%)", round(rate, 2))
                                else:
                                    st.metric("High-Risk Rate (%)", 0.0)

                            recent = stats.get("recent_alerts") or []
                            if recent:
                                with alerts_placeholder.container():
                                    st.subheader("🚨 Recent Fraud Alerts")
                                    alerts_df = pd.DataFrame(recent)
                                    st.dataframe(alerts_df, use_container_width=True)
                            else:
                                with alerts_placeholder.container():
                                    st.caption("No recent fraud alerts from Redis.")
                        else:
                            # Redis disabled/unavailable – only count transactions during active simulation
                            st.warning("⚠ Redis inactive — using local session statistics")

                            # Show counts only from current simulation run; 0 when simulation not running
                            total_tx = st.session_state.simulation_tx_count if st.session_state.simulate else 0
                            high_risk = st.session_state.simulation_high_risk_count if st.session_state.simulate else 0

                            col1, col2 = st.columns(2)
                            with col1:
                                st.metric("Total Transactions Seen", total_tx)
                            with col2:
                                st.metric("High Risk Alerts", high_risk)

                            if st.session_state.tx_history:
                                last = st.session_state.tx_history[-1]
                                st.error(f"Last Alert: {last['Risk']} | ₹{last['Amount']}")
                            else:
                                st.info("No alerts recorded in this session yet.")

                elif status == "error":
                    with stats_placeholder.container():
                        st.error("❌ Stats service reported an error")
                        st.info(stats.get("message", "Unknown error"))
                        with st.expander("🔍 Stats Payload"):
                            st.json(stats)
    except Exception as e:
        with stats_placeholder.container():
            st.error(f"Error fetching stats: {str(e)}")

# Initial stats display
refresh_stats_display()


# ============================================================
# REAL-TIME FRAUD MONITORING SIMULATION (IMPROVED)
# ============================================================
st.markdown("---")
st.header("📡 Real-Time Fraud Monitoring Simulation")

col1, col2, col3 = st.columns(3)

with col1:
    if st.button("▶ Start Simulation", disabled=st.session_state.simulate):
        st.session_state.simulate = True
        st.session_state.simulation_tx_count = 0
        st.session_state.simulation_high_risk_count = 0
        st.rerun()

with col2:
    if st.button("⏹ Stop Simulation", disabled=not st.session_state.simulate):
        st.session_state.simulate = False
        st.rerun()

with col3:
    stream_mode = st.selectbox(
        "Stream Mode",
        ["WebSocket (Recommended)", "SSE (Server-Sent Events)", "Polling (Legacy)"],
        index=0,
        disabled=st.session_state.simulate
    )

if st.session_state.simulate:
    # 🔄 IMPROVED: Check API health before attempting connection
    is_healthy, health_info = check_api_health()
    
    if not is_healthy:
        st.error("❌ **API Server is not running!**")
        st.warning(f"Please start the API server before running the simulation.")
        
        # Show detailed error info
        if health_info:
            st.info(f"**Error Details:** {health_info}")
        
        with st.expander("📋 How to Start the API Server", expanded=True):
            st.markdown(f"""
            **Option 1: Using PowerShell**
            ```powershell
            python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload
            ```
            
            **Option 2: Using the Restart Script**
            ```powershell
            .\\restart_api.ps1
            ```
            
            **Option 3: Using Command Prompt**
            ```cmd
            python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload
            ```
            
            **Verify the server is running:**
            - Health Check: http://127.0.0.1:8020/health
            - API Docs: http://127.0.0.1:8020/docs
            
            **After starting, click the button below to retry:**
            """)
        
        col1, col2 = st.columns(2)
        with col1:
            if st.button("🔄 Retry Connection"):
                st.rerun()
        with col2:
            if st.button("🔍 Check API Status"):
                is_healthy, info = check_api_health()
                if is_healthy:
                    st.success("✅ API Server is running!")
                else:
                    st.error(f"❌ API Server is not accessible: {info}")
        
        st.session_state.simulate = False
        st.stop()
    
    # 🔄 REAL-TIME UPGRADE: Use SSE for better real-time experience
    tx: JsonDict | None = None
    response: JsonDict | None = None
    if stream_mode == "WebSocket (Recommended)":
        ws_payload = ensure_dict_payload(
            fetch_ws_prediction(st.session_state.token),
            fallback_error="WEBSOCKET_INVALID_PAYLOAD",
        )
        if "error" in ws_payload:
            st.error(f"âŒ **WebSocket Error**: {ws_payload.get('error')}")
            st.info(ws_payload.get("message", "Unable to receive a websocket transaction."))
            st.session_state.simulate = False
            time.sleep(2)
            st.rerun()

        tx_value = ws_payload.get("transaction")
        prediction_value = ws_payload.get("prediction", {})
        tx = tx_value if isinstance(tx_value, dict) else None
        response = prediction_value if isinstance(prediction_value, dict) else {}
        if not tx or not response:
            st.error("âŒ **WebSocket Error**: Incomplete websocket payload received")
            st.session_state.simulate = False
            time.sleep(2)
            st.rerun()
    elif stream_mode == "SSE (Server-Sent Events)":
        try:
            # For SSE, use streaming request
            stream_response = requests.get(
                STREAM_API,
                stream=True,
                timeout=5,
                headers={
                    "Accept": "text/event-stream",
                    "Authorization": f"Bearer {st.session_state.token}",
                },
            )
            if stream_response.status_code == 200:
                # Parse SSE format manually
                for line in stream_response.iter_lines(decode_unicode=True):
                    if line and line.startswith("data: "):
                        try:
                            parsed_tx = json.loads(line[6:])  # Remove "data: " prefix
                            tx = parsed_tx if isinstance(parsed_tx, dict) else None
                            stream_response.close()
                            break
                        except json.JSONDecodeError:
                            continue
                
                if tx is None:
                    st.warning(f"⚠️ SSE endpoint returned no data, falling back to polling mode")
                    stream_response.close()
                    poll_tx = fetch_poll_transaction(st.session_state.token)
                    if "error" in poll_tx:
                        fallback_err = poll_tx.get("error")
                        st.info(poll_tx.get("message", "The backend polling fallback did not return a transaction."))
                        st.error(f"❌ Fallback failed: {str(fallback_err)}")
                        st.session_state.simulate = False
                        time.sleep(2)
                        st.rerun()
                    tx = poll_tx
            else:
                st.warning(f"⚠️ SSE endpoint returned status {stream_response.status_code}, falling back to polling mode")
                stream_response.close()
                poll_tx = fetch_poll_transaction(st.session_state.token)
                if "error" in poll_tx:
                    fallback_err = poll_tx.get("error")
                    st.error(f"Polling fallback failed: {poll_tx.get('error')}")
                    st.info(poll_tx.get("message", "The backend polling fallback did not return a transaction."))
                    st.session_state.simulate = False
                    time.sleep(2)
                    st.error(f"Polling fallback failed: {poll_tx.get('error')}")
                    st.error(f"❌ Error generating sample transaction: {str(fallback_err)}")
                    st.session_state.simulate = False
                    time.sleep(2)
                    st.rerun()
                tx = poll_tx
        except requests.exceptions.ConnectionError as e:
            st.error("❌ **Connection Error**: Cannot connect to API server")
            st.info("💡 The API server may have stopped. Please check if it's running on port 8020.")
            st.session_state.simulate = False
            time.sleep(2)
            st.rerun()
        except requests.exceptions.Timeout:
            st.error("❌ **Timeout Error**: API server took too long to respond")
            st.info("💡 The server may be overloaded. Try again in a moment.")
            time.sleep(2)
            st.rerun()
        except Exception as e:
            st.error(f"❌ **Unexpected Error**: {str(e)}")
            st.info("💡 Please check the API server logs for more details.")
            time.sleep(2)
            st.rerun()
    else:
        # Legacy polling mode - fetch a transaction from the backend
        try:
            tx = fetch_poll_transaction(st.session_state.token)
            if "error" in tx:
                st.error(f"Polling Error: {tx.get('error')}")
                st.info(tx.get("message", "Please ensure the API server is running on http://127.0.0.1:8020"))
                st.session_state.simulate = False
                time.sleep(2)
                st.rerun()
        except requests.exceptions.ConnectionError:
            st.error("❌ **Connection Error**: Cannot connect to API server")
            st.info("💡 Please ensure the API server is running on http://127.0.0.1:8020")
            st.session_state.simulate = False
            time.sleep(2)
            st.rerun()
        except requests.exceptions.Timeout:
            st.error("❌ **Timeout Error**: API server took too long to respond")
            time.sleep(2)
            st.rerun()
        except Exception as e:
            st.error(f"❌ **Error**: {str(e)}")
            st.info("💡 Make sure the API server is running on http://127.0.0.1:8020")
            st.session_state.simulate = False
            time.sleep(2)
            st.rerun()
    
    if tx is None:
        poll_tx = fetch_poll_transaction(st.session_state.token)
        if "error" in poll_tx:
            st.error(f"Polling Error: {poll_tx.get('error')}")
            st.info(poll_tx.get("message", "The backend did not return a transaction."))
            st.session_state.simulate = False
            time.sleep(2)
            st.rerun()
        tx = poll_tx

    if tx is None:
        st.error("âŒ Unable to read a transaction from the backend stream.")
        st.session_state.simulate = False
        time.sleep(2)
        st.rerun()

    if response is None:
        response = call_fraud_api(tx)

    if "error" not in response:
        prob = response.get("fraud_probability", 0)
        try:
            prob = float(prob)
        except Exception:
            prob = 0.0

        tx_amount = float(tx.get("amount", 0) or 0.0)
        tx_type = str(tx.get("type", "UNKNOWN") or "UNKNOWN")
        risk_level = str(response.get("risk_level", "LOW") or "LOW")

        confidence = abs(prob - 0.5) * 2
        confidence_pct = round(confidence * 100, 2)

        # ====================================================
        # 🔹 UPGRADE 5 — VELOCITY RISK
        # ====================================================
        current_time = time.time()
        time_diff = current_time - st.session_state.user_profile["last_tx_time"]
        velocity_risk = 0.2 if time_diff < 5 else 0

        # ====================================================
        # 🔹 UPGRADE 5 — SPENDING DRIFT
        # ====================================================
        avg_amt = st.session_state.user_profile["avg_amount"]
        if avg_amt > 0:
            spend_drift = abs(tx_amount - avg_amt) / (avg_amt + 1)
        else:
            spend_drift = 0

        # ====================================================
        # 🔹 UPGRADE 5 — RISK ACCUMULATION
        # ====================================================
        st.session_state.user_profile["risk_score"] += (
            prob * 0.5 + velocity_risk + spend_drift * 0.3
        )

        # Update behavioral profile
        st.session_state.user_profile["tx_count"] += 1
        st.session_state.user_profile["avg_amount"] = (
            (avg_amt * (st.session_state.user_profile["tx_count"] - 1) + tx_amount)
            / st.session_state.user_profile["tx_count"]
        )
        st.session_state.user_profile["last_tx_time"] = current_time

        # ====================================================
        # 🔹 ADAPTIVE THRESHOLD (BEHAVIORAL)
        # ====================================================
        adaptive_threshold = 0.7 - min(
            st.session_state.user_profile["risk_score"], 0.3
        )

        # ====================================================
        # 🔹 BEHAVIORAL DECISION OVERRIDE
        # ====================================================
        if st.session_state.user_profile["risk_score"] > 1.5:
            action = "⛔ BLOCK USER (Behavioral Risk)"
        else:
            action = decision_engine(risk_level, confidence)

        # ====================================================
        # 🔹 UI OUTPUT (UNCHANGED STRUCTURE)
        # ====================================================
        st.subheader("📥 Incoming Transaction")
        st.json(tx)

        st.success(f"Risk Level: {risk_level}")
        st.metric("Fraud Probability (%)", round(prob * 100, 2))
        st.metric("🎯 Prediction Confidence (%)", confidence_pct)

        st.subheader("🧭 System Recommended Action")
        if "BLOCK" in action:
            st.error(action)
        elif "MANUAL" in action:
            st.warning(action)
        elif "MONITOR" in action:
            st.info(action)
        else:
            st.success(action)

        if "BLOCK" in action:
            st.session_state.fraud_count += 1

        st.metric("🚨 High-Risk Count", st.session_state.fraud_count)

        # =========================
        # 🔹 RISK TREND (HISTORY)
        # =========================
        st.session_state.risk_history.append(prob)
        if len(st.session_state.risk_history) >= 5:
            moving_avg = pd.Series(st.session_state.risk_history).rolling(5).mean()
        else:
            moving_avg = None

        trend_df = pd.DataFrame({"Fraud Probability": st.session_state.risk_history})
        if moving_avg is not None:
            trend_df["Moving Average"] = moving_avg

        st.subheader("📈 Live Fraud Risk Trend")
        st.line_chart(trend_df)

        # =========================
        # 🔹 CONCEPT DRIFT INDICATOR
        # =========================
        if len(st.session_state.risk_history) >= 10:
            recent_avg = sum(st.session_state.risk_history[-10:]) / 10
            previous_avg = sum(st.session_state.risk_history[-20:-10]) / 10

            if recent_avg > previous_avg:
                st.warning("⚠ Concept Drift Detected: Fraud Risk Increasing")
            else:
                st.success("✅ Fraud Pattern Stable")

        # =========================
        # 🔹 ANOMALY SCORE (UNSUPERVISED)
        # =========================
        if len(st.session_state.tx_history) >= 5:
            avg_amount = sum(t["Amount"] for t in st.session_state.tx_history) / len(st.session_state.tx_history)
            anomaly_score = abs(tx_amount - avg_amount) / (avg_amount + 1)
            st.metric("📊 Anomaly Score", round(anomaly_score, 2))

        # =========================
        # 🔹 BEHAVIORAL DASHBOARD (UPGRADE 5)
        # =========================
        st.subheader("🧍 Behavioral Risk Profile")
        st.metric(
            "Accumulated Risk Score",
            round(st.session_state.user_profile["risk_score"], 2)
        )
        st.metric(
            "Average Transaction Amount",
            round(st.session_state.user_profile["avg_amount"], 2)
        )
        st.metric(
            "Adaptive Risk Threshold",
            round(adaptive_threshold, 2)
        )
        record = {
            "Type": tx_type,
            "Amount": tx_amount,
            "Risk": risk_level,
            "Probability": round(prob, 3),
            "Confidence (%)": confidence_pct,
        }
        st.session_state.tx_history.append(record)
        st.session_state.tx_history = st.session_state.tx_history[-10:]
        st.session_state.all_transactions.append(record)
        # Only count for real-time stats when simulation is running
        st.session_state.simulation_tx_count = (st.session_state.simulation_tx_count or 0) + 1
        if risk_level == "HIGH":
            st.session_state.simulation_high_risk_count = (st.session_state.simulation_high_risk_count or 0) + 1

        st.subheader("📜 Recent Transactions")
        st.table(pd.DataFrame(st.session_state.tx_history))
        
        # 🔄 REFRESH REAL-TIME STATISTICS DURING SIMULATION
        refresh_stats_display()
        time.sleep(0.5)  # Small delay for better UX


    else:
        # 🔄 IMPROVED: Better error display
        error_type = response.get('error', 'UNKNOWN_ERROR')
        error_message = response.get('message', 'An unknown error occurred')
        
        if error_type == "CONNECTION_ERROR":
            st.error("❌ **Connection Error**: Cannot connect to API server")
            st.warning("**Possible causes:**")
            st.markdown("""
            - API server is not running
            - API server is running on a different port
            - Firewall is blocking the connection
            - Network connectivity issues
            """)
            with st.expander("📋 How to Fix", expanded=True):
                st.code("""
# Start the API server:
uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload
                """, language="bash")
        elif error_type == "TIMEOUT":
            st.error("❌ **Timeout Error**: API server took too long to respond")
            st.info("💡 The server may be overloaded. Try again in a moment.")
        else:
            st.error(f"❌ **API Error**: {error_type}")
            st.info(f"Details: {error_message}")
        
        st.json(response)
        st.session_state.simulate = False
        time.sleep(3)
        st.rerun()
    
    # 🔄 REAL-TIME UPGRADE: Adaptive sleep based on stream mode
    sleep_time = 1.5 if stream_mode == "SSE (Server-Sent Events)" else 2.0
    time.sleep(sleep_time)
    st.rerun()



if st.sidebar.button("Logout"):
    st.session_state.token = None
    # Guard experimental API usage for compatibility with different Streamlit versions
    # Call experimental rerun if available, using getattr to satisfy static analysis
    _exp_rerun = getattr(st, "experimental_rerun", None)
    if callable(_exp_rerun):
        try:
            _exp_rerun()
        except Exception:
            pass
    else:
        _rerun = getattr(st, "rerun", None)
        if callable(_rerun):
            try:
                _rerun()
            except Exception:
                pass


# ============================================================
# USER DASHBOARD
# ============================================================
if normalise_role(st.session_state.role) == "USER":
    st.markdown("---")
    st.header("👤 User Dashboard – Recent Activity")

    if len(st.session_state.tx_history) == 0:
        st.info("No transactions observed yet.")
    else:
        st.subheader("📜 My Recent Transactions")
        st.table(pd.DataFrame(st.session_state.tx_history))
# ============================================================
# ADMIN DASHBOARD
# ============================================================
if normalise_role(st.session_state.role) == "ADMIN":
    st.markdown("---")
    st.header("🛡 Admin Dashboard – System Monitoring")

    total_tx = len(st.session_state.all_transactions)
    high_risk = sum(1 for t in st.session_state.all_transactions if t["Risk"] == "HIGH")

    colA, colB = st.columns(2)
    colA.metric("Total Transactions Seen", total_tx)
    colB.metric("High-Risk Transactions", high_risk)

    if total_tx > 0:
        df_admin = pd.DataFrame(st.session_state.all_transactions)

        st.subheader("📊 Risk Breakdown")
        st.bar_chart(df_admin["Risk"].value_counts())

        st.subheader("📜 All Observed Transactions")
        st.dataframe(df_admin.tail(50),width='stretch')
    else:
        st.info("Waiting for transactions...")
    

    if normalise_role(st.session_state.role) == "ADMIN" and len(st.session_state.all_transactions) > 0:
        csv = pd.DataFrame(st.session_state.all_transactions).to_csv(index=False)
        st.download_button("⬇ Download Transaction Log (CSV)", data=csv, file_name="fraud_log.csv")
    
    


# ============================================================
# END
# ============================================================
st.success("✨ Powered by PayWatch AI | Developed by Shravankumar")
