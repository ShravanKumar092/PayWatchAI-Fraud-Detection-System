from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from api.auth.models import User
from api.services.fraud_engine import get_engine_status
from api.services.kafka_layer import kafka_bridge
from api.services.model_lifecycle import get_scheduler_status, list_model_versions
from api.services.realtime_store import realtime_store
from api.services.runtime_settings import (
    build_effective_permissions,
    get_permission_override,
    get_settings,
    get_user_preferences,
    update_permission_override,
    update_settings,
    update_user_preferences,
)
from api.services.secrets import read_secret


def build_profile(user: Dict[str, Any]) -> Dict[str, Any]:
    identity = str(user.get("email") or "").strip().lower()
    preferences = get_user_preferences(identity)
    return {
        "email": identity,
        "display_name": preferences.get("display_name") or user.get("name") or identity,
        "avatar_url": preferences.get("avatar_url") or "",
        "contact_email": preferences.get("contact_email") or identity,
        "contact_phone": preferences.get("contact_phone") or user.get("phone") or "",
        "timezone": preferences.get("timezone"),
        "language": preferences.get("language"),
        "theme": preferences.get("theme"),
        "email_alerts_enabled": preferences.get("email_alerts_enabled", True),
        "sms_alerts_enabled": preferences.get("sms_alerts_enabled", False),
        "alert_preferences": preferences.get("alert_preferences", {}),
        "alert_delivery": {
            **dict(preferences.get("alert_delivery") or {}),
            "smtp_password": "",
        },
    }


def update_profile(identity: str, payload: Dict[str, Any], user_name: str = "", user_phone: str = "") -> Dict[str, Any]:
    profile = update_user_preferences(
        identity,
        {
            "display_name": payload.get("display_name") or user_name,
            "avatar_url": payload.get("avatar_url"),
            "contact_email": payload.get("contact_email") or identity,
            "contact_phone": payload.get("contact_phone") or user_phone,
            "timezone": payload.get("timezone"),
            "language": payload.get("language"),
            "theme": payload.get("theme"),
            "default_filters": payload.get("default_filters") or {},
            "table_density": payload.get("table_density"),
            "notification_style": payload.get("notification_style"),
            "email_alerts_enabled": payload.get("email_alerts_enabled"),
            "sms_alerts_enabled": payload.get("sms_alerts_enabled"),
            "alert_preferences": payload.get("alert_preferences") or {},
            "alert_delivery": payload.get("alert_delivery") or {},
        },
    )
    return {
        "email": identity,
        "display_name": profile.get("display_name") or user_name or identity,
        "avatar_url": profile.get("avatar_url"),
        "contact_email": profile.get("contact_email"),
        "contact_phone": profile.get("contact_phone"),
        "timezone": profile.get("timezone"),
        "language": profile.get("language"),
        "theme": profile.get("theme"),
        "email_alerts_enabled": profile.get("email_alerts_enabled", True),
        "sms_alerts_enabled": profile.get("sms_alerts_enabled", False),
        "alert_preferences": profile.get("alert_preferences", {}),
        "alert_delivery": {
            **dict(profile.get("alert_delivery") or {}),
            "smtp_password": "",
        },
    }


def build_environment_status() -> Dict[str, Any]:
    settings = get_settings()
    engine_status = get_engine_status()
    scheduler_status = get_scheduler_status()
    alert_delivery = dict(settings.get("alert_delivery") or {})
    smtp_host = read_secret("PAYWATCH_SMTP_HOST") or str(alert_delivery.get("smtp_host") or "").strip()
    smtp_port = read_secret("PAYWATCH_SMTP_PORT") or str(alert_delivery.get("smtp_port") or "1025")
    smtp_mode = "external-smtp" if smtp_host and smtp_host not in {"127.0.0.1", "localhost", "mailpit"} else "local-smtp"
    secrets_health = {
        "api_key": bool(read_secret("PAYWATCH_API_KEY")),
        "jwt_secret": bool(read_secret("PAYWATCH_JWT_SECRET")),
        "admin_signup_key": bool(read_secret("PAYWATCH_ADMIN_SIGNUP_KEY")),
        "smtp": bool(smtp_host),
        "twilio": bool(read_secret("PAYWATCH_TWILIO_ACCOUNT_SID")),
        "alert_webhook": bool(read_secret("PAYWATCH_ALERT_WEBHOOK_URL")),
    }
    return {
        "version": "2.0",
        "active_endpoints": {
            "api": "http://127.0.0.1:8020",
            "docs": "http://127.0.0.1:8020/docs",
            "frontend": "http://127.0.0.1:3000",
        },
        "service_availability": {
            "realtime_store": realtime_store.health(),
            "kafka": kafka_bridge.health(),
            "scheduler": scheduler_status,
            "engine": engine_status,
        },
        "alert_delivery": {
            "recipient": str(read_secret("PAYWATCH_ALERT_EMAIL_TO") or alert_delivery.get("email_recipient") or "").strip().lower(),
            "sender": str(read_secret("PAYWATCH_ALERT_EMAIL_FROM") or alert_delivery.get("email_sender") or "").strip().lower(),
            "smtp_host": smtp_host or "auto-detect",
            "smtp_port": smtp_port,
            "mode": smtp_mode,
        },
        "secrets_health": secrets_health,
        "theme": settings.get("theme"),
        "timestamp": datetime.utcnow().isoformat(),
    }


def build_review_logs(limit: int = 40) -> List[Dict[str, Any]]:
    items = realtime_store.get_recent_activities(limit=limit)
    return items[::-1]


def build_settings_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    identity = str(user.get("email") or "").strip().lower()
    role = str(user.get("role") or "USER").strip().upper()
    settings = get_settings()
    safe_settings = dict(settings)
    safe_alert_delivery = dict(safe_settings.get("alert_delivery") or {})
    if safe_alert_delivery:
        safe_alert_delivery["smtp_password"] = ""
        safe_settings["alert_delivery"] = safe_alert_delivery
    preferences = get_user_preferences(identity)
    safe_preferences = dict(preferences)
    safe_preferences["alert_delivery"] = {
        **dict(safe_preferences.get("alert_delivery") or {}),
        "smtp_password": "",
    }
    permissions = build_effective_permissions(role, identity)
    return {
        "status": "ok",
        "settings": safe_settings,
        "profile": build_profile(user),
        "preferences": safe_preferences,
        "permissions": permissions,
        "environment_status": build_environment_status(),
        "audit_logs": build_review_logs(),
        "model_registry": list_model_versions() if permissions.get("can_manage_models") else {"versions": []},
        "timestamp": datetime.utcnow().isoformat(),
    }


def build_team_workspace(users: List[User]) -> Dict[str, Any]:
    queue = []
    members = []
    for user in users:
        user_dict = {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "phone": getattr(user, "phone", None),
            "role": str(getattr(user, "role", "USER") or "USER").upper(),
            "status": str(getattr(user, "status", "PENDING") or "PENDING").upper(),
            "approved_by": getattr(user, "approved_by", None),
            "approved_at": getattr(user, "approved_at", None),
            "created_at": getattr(user, "created_at", None),
            "updated_at": getattr(user, "updated_at", None),
        }
        profile = get_user_preferences(user.email)
        permissions = build_effective_permissions(user_dict["role"], user.email)
        override = get_permission_override(user.email)
        member = {
            **user_dict,
            "display_name": profile.get("display_name") or user.name,
            "timezone": profile.get("timezone"),
            "language": profile.get("language"),
            "permissions": permissions,
            "permission_override": override,
        }
        members.append(member)
        if user_dict["status"] == "PENDING":
            queue.append(member)
    members.sort(key=lambda item: (item["status"] != "PENDING", item["email"]))
    return {
        "approval_queue": queue,
        "members": members,
        "permission_columns": list(build_effective_permissions("ADMIN").keys()),
        "timestamp": datetime.utcnow().isoformat(),
    }


def update_permission_matrix(user_key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    override = update_permission_override(user_key, payload)
    return {
        "status": "ok",
        "user_key": user_key,
        "permission_override": override,
        "timestamp": datetime.utcnow().isoformat(),
    }


def save_global_settings(payload: Dict[str, Any]) -> Dict[str, Any]:
    settings = update_settings(payload)
    safe_settings = dict(settings)
    safe_alert_delivery = dict(safe_settings.get("alert_delivery") or {})
    if safe_alert_delivery:
        safe_alert_delivery["smtp_password"] = ""
        safe_settings["alert_delivery"] = safe_alert_delivery
    return {"status": "ok", "settings": safe_settings, "timestamp": datetime.utcnow().isoformat()}
