from __future__ import annotations

from typing import Any, Dict, List

from api.auth.db import SessionLocal
from api.auth.models import User
from api.services.model_lifecycle import list_model_versions
from api.services.realtime_store import realtime_store
from api.services.transaction_center import get_transactions_workspace


def _matches(query: str, *values: Any) -> bool:
    text = query.strip().lower()
    if not text:
        return False
    return any(text in str(value or "").lower() for value in values)


def search_workspace(query: str, user_email: str, role: str, limit: int = 6) -> Dict[str, Any]:
    text = str(query or "").strip()
    if not text:
        return {"status": "ok", "query": "", "results": [], "groups": {}}

    safe_limit = max(1, min(int(limit), 12))
    results: List[Dict[str, Any]] = []

    transaction_payload = get_transactions_workspace(user_email, page=1, page_size=120)
    for row in transaction_payload.get("transactions", []):
        if _matches(
            text,
            row.get("transaction_id"),
            row.get("type"),
            row.get("source_account"),
            row.get("destination_account"),
            row.get("merchant"),
            row.get("user"),
        ):
            results.append(
                {
                    "id": row.get("transaction_id"),
                    "entity": "transaction",
                    "label": f"{row.get('type')} | {row.get('transaction_id')}",
                    "description": f"{row.get('source_account')} -> {row.get('destination_account')} | {row.get('risk_level')}",
                    "route": f"/transactions/{row.get('transaction_id')}",
                    "badge": row.get("risk_level"),
                }
            )
        if len([item for item in results if item["entity"] == "transaction"]) >= safe_limit:
            break

    for alert in realtime_store.get_recent_alerts(limit=120):
        if _matches(
            text,
            alert.get("timestamp"),
            alert.get("type"),
            alert.get("status"),
            alert.get("severity"),
            alert.get("source_account"),
            alert.get("destination_account"),
        ):
            results.append(
                {
                    "id": alert.get("timestamp"),
                    "entity": "alert",
                    "label": f"{alert.get('type')} alert",
                    "description": f"{alert.get('status', 'new')} | {alert.get('severity', 'medium')} | {alert.get('source_account')} -> {alert.get('destination_account')}",
                    "route": f"/alerts?open={alert.get('timestamp')}",
                    "badge": str(alert.get("severity") or "medium").upper(),
                }
            )
        if len([item for item in results if item["entity"] == "alert"]) >= safe_limit:
            break

    versions = list_model_versions().get("versions", [])
    for item in versions:
        metadata = dict(item.get("metadata") or {})
        if _matches(text, item.get("version"), metadata.get("trigger"), metadata.get("status")):
            results.append(
                {
                    "id": item.get("version"),
                    "entity": "model",
                    "label": item.get("version"),
                    "description": f"{metadata.get('status', 'version')} | rows {metadata.get('rows', 0)}",
                    "route": f"/analytics?version={item.get('version')}",
                    "badge": "ACTIVE" if item.get("current") else "ARCHIVE",
                }
            )
        if len([entry for entry in results if entry["entity"] == "model"]) >= safe_limit:
            break

    if str(role or "").upper() in {"ADMIN", "SERVICE"}:
        with SessionLocal() as db:
            users = db.query(User).order_by(User.id.desc()).all()
        for user in users:
            if _matches(text, user.name, user.email, user.role, user.status):
                results.append(
                    {
                        "id": user.email,
                        "entity": "user",
                        "label": user.name,
                        "description": f"{user.email} | {user.role} | {user.status}",
                        "route": f"/settings?member={user.email}",
                        "badge": user.role,
                    }
                )
            if len([entry for entry in results if entry["entity"] == "user"]) >= safe_limit:
                break

    groups = {
        "transactions": [item for item in results if item["entity"] == "transaction"][:safe_limit],
        "alerts": [item for item in results if item["entity"] == "alert"][:safe_limit],
        "models": [item for item in results if item["entity"] == "model"][:safe_limit],
        "users": [item for item in results if item["entity"] == "user"][:safe_limit],
    }
    return {
        "status": "ok",
        "query": text,
        "results": results[: safe_limit * 4],
        "groups": groups,
    }
