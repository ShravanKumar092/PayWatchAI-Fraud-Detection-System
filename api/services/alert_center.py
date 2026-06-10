from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional

from api.services.realtime_store import realtime_store
from api.services.runtime_settings import get_settings

STATUS_TABS = ["new", "assigned", "in_review", "escalated", "closed"]


def _safe_datetime(value: Any) -> datetime:
    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        return datetime.utcnow()


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def _time_remaining_seconds(value: Any) -> int:
    due = _safe_datetime(value)
    return int((due - datetime.utcnow()).total_seconds())


def _sparkline_for_alert(alert: Dict[str, Any], predictions: List[Dict[str, Any]]) -> List[float]:
    source_account = str(alert.get("source_account") or "")
    related = [
        round(_safe_float(item.get("fraud_probability")), 4)
        for item in predictions
        if str(item.get("source_account") or "") == source_account
    ][-8:]
    if related:
        return related
    fallback = round(_safe_float(alert.get("fraud_probability")), 4)
    return [fallback]


def _normalise_alert_view(alert: Dict[str, Any], predictions: List[Dict[str, Any]], group_counts: Dict[str, int]) -> Dict[str, Any]:
    payload = dict(alert)
    status = str(payload.get("status") or "new").lower()
    payload["status"] = status
    payload["priority_score"] = int(payload.get("priority_score") or 0)
    payload["severity"] = str(payload.get("severity") or "medium").lower()
    payload["duplicate_count"] = max(group_counts.get(str(payload.get("incident_group_id")), 1) - 1, 0)
    payload["incident_count"] = group_counts.get(str(payload.get("incident_group_id")), 1)
    payload["sla_remaining_seconds"] = _time_remaining_seconds(payload.get("sla_due_at"))
    payload["sparkline"] = list(payload.get("sparkline") or _sparkline_for_alert(payload, predictions))
    payload["reason_chips"] = list(payload.get("reason_chips") or [])[:4]
    payload["notification_badges"] = [entry.get("channel") for entry in payload.get("channel_history", []) if entry.get("status") in {"sent", "failed"}]
    return payload


def _build_assignment_queues(alerts: List[Dict[str, Any]], workflow: Dict[str, Any]) -> Dict[str, Any]:
    analyst_counts: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"analyst": "unassigned", "count": 0, "critical": 0, "overdue": 0})
    team_counts: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"team": "analyst-queue", "count": 0, "critical": 0})
    for alert in alerts:
        assignee = str(alert.get("assigned_to") or "unassigned").strip().lower() or "unassigned"
        severity = str(alert.get("severity") or "medium").lower()
        status = str(alert.get("status") or "new").lower()
        analyst_counts[assignee]["analyst"] = assignee
        analyst_counts[assignee]["count"] += 1
        analyst_counts[assignee]["critical"] += int(severity == "critical")
        analyst_counts[assignee]["overdue"] += int(status != "closed" and _time_remaining_seconds(alert.get("sla_due_at")) < 0)

    for policy in list(workflow.get("escalation_policy") or []):
        route = str(policy.get("route_to") or "analyst-queue").strip()
        matching = [alert for alert in alerts if str(alert.get("severity") or "").lower() == str(policy.get("severity") or "").lower()]
        team_counts[route]["team"] = route
        team_counts[route]["count"] += len(matching)
        team_counts[route]["critical"] += sum(1 for alert in matching if str(alert.get("severity") or "").lower() == "critical")

    analysts = sorted(analyst_counts.values(), key=lambda item: (item["count"], item["critical"], item["overdue"]), reverse=True)
    teams = sorted(team_counts.values(), key=lambda item: (item["count"], item["critical"]), reverse=True)
    return {
        "analysts": analysts[:8],
        "teams": teams[:8],
    }


def _build_similarity_controls(workflow: Dict[str, Any], grouped_incidents: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "similarity_threshold": workflow.get("similarity_threshold", 0.72),
        "dedupe_window_minutes": workflow.get("dedupe_window_minutes", 30),
        "auto_merge_incidents": bool(workflow.get("auto_merge_incidents", True)),
        "cluster_count": len(grouped_incidents),
        "largest_cluster": max((item.get("count", 0) for item in grouped_incidents), default=0),
    }


def get_alert_board(status: str = "all", limit: int = 50) -> Dict[str, Any]:
    settings = get_settings()
    workflow = dict(settings.get("alert_workflow") or {})
    alerts = realtime_store.get_recent_alerts(limit=limit)
    predictions = realtime_store.get_recent_predictions(limit=240)
    group_counts = Counter(str(item.get("incident_group_id")) for item in alerts)
    enriched = [_normalise_alert_view(alert, predictions, group_counts) for alert in alerts]
    filtered_status = str(status or "all").lower()
    if filtered_status != "all":
        enriched = [item for item in enriched if str(item.get("status")).lower() == filtered_status]

    tab_counts = Counter(str(item.get("status") or "new").lower() for item in alerts)
    tabs = [{"key": "all", "label": "All", "count": len(alerts)}] + [
        {"key": key, "label": key.replace("_", " ").title(), "count": tab_counts.get(key, 0)}
        for key in STATUS_TABS
    ]
    grouped_incidents = []
    incident_groups: Dict[str, Dict[str, Any]] = {}
    for alert in alerts:
        group_id = str(alert.get("incident_group_id"))
        current = incident_groups.setdefault(
            group_id,
            {
                "incident_group_id": group_id,
                "count": 0,
                "alerts": [],
                "highest_priority": 0,
                "severity": "low",
            },
        )
        current["count"] += 1
        current["alerts"].append(alert.get("timestamp"))
        current["highest_priority"] = max(current["highest_priority"], int(alert.get("priority_score") or 0))
        severity = str(alert.get("severity") or "low").lower()
        if severity in {"critical", "high"}:
            current["severity"] = severity
    grouped_incidents = sorted(incident_groups.values(), key=lambda item: (item["highest_priority"], item["count"]), reverse=True)

    return {
        "status": "ok",
        "alerts": enriched,
        "tabs": tabs,
        "grouped_incidents": grouped_incidents[:12],
        "assignment_queues": _build_assignment_queues(enriched, workflow),
        "workflow_config": {
            "escalation_policy": list(workflow.get("escalation_policy") or []),
            "suppression_rules": list(workflow.get("suppression_rules") or []),
            "similarity_controls": _build_similarity_controls(workflow, grouped_incidents),
        },
        "notifications": get_notification_center(limit=15),
        "timestamp": datetime.utcnow().isoformat(),
    }


def get_notification_center(limit: int = 25) -> Dict[str, Any]:
    notifications = realtime_store.get_recent_notifications(limit=limit)
    ordered = sorted(notifications, key=lambda item: str(item.get("timestamp") or ""), reverse=True)
    unread_count = sum(1 for item in ordered if not item.get("read"))
    return {
        "items": ordered,
        "unread_count": unread_count,
    }


def get_alert_detail(timestamp: str) -> Dict[str, Any]:
    alert = realtime_store.get_alert(timestamp)
    if not alert:
        return {"status": "not_found", "detail": None}

    predictions = realtime_store.get_recent_predictions(limit=240)
    group_id = str(alert.get("incident_group_id"))
    related_alerts = [
        item for item in realtime_store.get_recent_alerts(limit=120)
        if str(item.get("incident_group_id")) == group_id
    ]
    source_account = str(alert.get("source_account") or "")
    destination_account = str(alert.get("destination_account") or "")
    customer_history = [
        {
            "timestamp": item.get("timestamp"),
            "type": item.get("type"),
            "amount": item.get("amount"),
            "risk_level": item.get("risk_level"),
            "fraud_probability": item.get("fraud_probability"),
        }
        for item in predictions
        if str(item.get("source_account") or "") == source_account or str(item.get("destination_account") or "") == destination_account
    ][-8:]

    detected_at = _safe_datetime(alert.get("timestamp"))
    contextual_events = []
    for item in predictions:
        stamp = _safe_datetime(item.get("timestamp"))
        if abs((stamp - detected_at).total_seconds()) > 3600:
            continue
        if str(item.get("source_account") or "") != source_account and str(item.get("destination_account") or "") != destination_account:
            continue
        contextual_events.append(
            {
                "timestamp": str(item.get("timestamp")),
                "title": f"{item.get('type', 'Transaction')} observed",
                "description": f"Risk {item.get('risk_level', 'LOW')} with score {round(_safe_float(item.get('fraud_probability')), 4)}.",
                "category": "transaction",
                "severity": "info",
            }
        )

    timeline = sorted(
        list(alert.get("incident_timeline") or []) + contextual_events,
        key=lambda item: str(item.get("timestamp") or ""),
    )

    detail = _normalise_alert_view(alert, predictions, Counter(str(item.get("incident_group_id")) for item in related_alerts))
    detail["customer_history"] = customer_history
    detail["incident_cluster"] = [
        {
            "timestamp": item.get("timestamp"),
            "status": item.get("status"),
            "severity": item.get("severity"),
            "priority_score": item.get("priority_score"),
        }
        for item in related_alerts
    ]
    detail["incident_timeline"] = timeline
    detail["channel_history"] = list(alert.get("channel_history") or [])
    detail["audit_trail"] = list(alert.get("audit_trail") or [])
    detail["attachments"] = list(alert.get("attachments") or [])
    return {
        "status": "ok",
        "detail": detail,
        "timestamp": datetime.utcnow().isoformat(),
    }
