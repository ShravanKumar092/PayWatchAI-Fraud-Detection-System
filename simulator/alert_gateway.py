import json
import secrets
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from fastapi import FastAPI, Header, HTTPException, Request

from api.services.secrets import read_secret


app = FastAPI(title="PayWatch Alert Gateway", version="1.0")

DATA_DIR = Path(read_secret("PAYWATCH_ALERT_GATEWAY_DATA_DIR", "./data/mock_alerts") or "./data/mock_alerts")
SMS_LOG = DATA_DIR / "sms_events.jsonl"
WEBHOOK_LOG = DATA_DIR / "webhook_events.jsonl"


def _append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, default=str) + "\n")


def _read_events(path: Path, limit: int = 50) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()[-limit:]
    events: List[Dict[str, Any]] = []
    for line in lines:
        try:
            events.append(json.loads(line))
        except Exception:
            continue
    return events


def _verify_twilio_auth(authorization: str | None) -> None:
    expected_sid = str(read_secret("PAYWATCH_TWILIO_ACCOUNT_SID", "paywatch-twilio-sid") or "paywatch-twilio-sid")
    expected_token = str(read_secret("PAYWATCH_TWILIO_AUTH_TOKEN", "paywatch-twilio-token") or "paywatch-twilio-token")
    if not authorization or not authorization.lower().startswith("basic "):
        raise HTTPException(status_code=401, detail="Missing Twilio basic auth")

    import base64

    try:
        raw_value = base64.b64decode(authorization.split(" ", 1)[1]).decode("utf-8")
        account_sid, auth_token = raw_value.split(":", 1)
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid basic auth payload: {exc}")

    if not (
        secrets.compare_digest(account_sid, expected_sid)
        and secrets.compare_digest(auth_token, expected_token)
    ):
        raise HTTPException(status_code=401, detail="Invalid Twilio credentials")


def _verify_webhook_auth(authorization: str | None) -> None:
    expected_token = str(read_secret("PAYWATCH_ALERT_WEBHOOK_TOKEN", "") or "").strip()
    if not expected_token:
        return
    expected_header = f"Bearer {expected_token}"
    if not authorization or not secrets.compare_digest(authorization, expected_header):
        raise HTTPException(status_code=401, detail="Invalid webhook token")


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "UP",
        "sms_events": len(_read_events(SMS_LOG)),
        "webhook_events": len(_read_events(WEBHOOK_LOG)),
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.post("/2010-04-01/Accounts/{account_sid}/Messages.json")
async def twilio_messages(account_sid: str, request: Request, authorization: str | None = Header(default=None)) -> Dict[str, Any]:
    _verify_twilio_auth(authorization)
    expected_sid = str(read_secret("PAYWATCH_TWILIO_ACCOUNT_SID", "paywatch-twilio-sid") or "paywatch-twilio-sid")
    if account_sid != expected_sid:
        raise HTTPException(status_code=404, detail="Unknown account SID")

    form = await request.form()
    payload = {
        "timestamp": datetime.utcnow().isoformat(),
        "account_sid": account_sid,
        "from": form.get("From"),
        "to": form.get("To"),
        "body": form.get("Body"),
    }
    _append_jsonl(SMS_LOG, payload)
    return {"status": "queued", "sid": f"SM{int(datetime.utcnow().timestamp())}", "message": payload}


@app.post("/webhook")
async def alert_webhook(request: Request, authorization: str | None = Header(default=None)) -> Dict[str, Any]:
    _verify_webhook_auth(authorization)
    payload = await request.json()
    event = {
        "timestamp": datetime.utcnow().isoformat(),
        "payload": payload,
    }
    _append_jsonl(WEBHOOK_LOG, event)
    return {"status": "ok", "received": True}


@app.get("/events")
async def get_events(limit: int = 25) -> Dict[str, Any]:
    safe_limit = max(1, min(int(limit), 200))
    return {
        "status": "ok",
        "sms_events": _read_events(SMS_LOG, safe_limit),
        "webhook_events": _read_events(WEBHOOK_LOG, safe_limit),
        "timestamp": datetime.utcnow().isoformat(),
    }
