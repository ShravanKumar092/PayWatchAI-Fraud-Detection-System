import smtplib
import ssl
import hashlib
from datetime import datetime
from email.message import EmailMessage
from typing import Any, Dict, Optional

import requests

from api.services.realtime_store import realtime_store
from api.services.secrets import read_secret
from api.services.runtime_settings import get_settings, get_user_preferences


class AlertManager:
    def __init__(self) -> None:
        pass

    def _resolve_recipient_email(self, client_id: str) -> str:
        identity = str(client_id or "").strip().lower()
        if "@" not in identity:
            return ""
        preferences = get_user_preferences(identity)
        return str(preferences.get("contact_email") or identity).strip().lower()

    def _resolve_user_preferences(self, client_id: str) -> Dict[str, Any]:
        identity = str(client_id or "").strip().lower()
        if "@" not in identity:
            return {}
        return dict(get_user_preferences(identity) or {})

    def _default_severity(self, prediction: Dict[str, Any]) -> str:
        probability = float(prediction.get("fraud_probability") or 0.0)
        graph_score = float(prediction.get("graph_score") or 0.0)
        risk_level = str(prediction.get("risk_level") or "LOW").upper()
        if probability >= 0.9 or graph_score >= 0.5:
            return "critical"
        if risk_level == "HIGH" or probability >= 0.75:
            return "high"
        if risk_level == "MEDIUM" or probability >= 0.45:
            return "medium"
        return "low"

    def _priority_score(self, prediction: Dict[str, Any]) -> int:
        probability = float(prediction.get("fraud_probability") or 0.0)
        anomaly = float(prediction.get("anomaly_score") or prediction.get("anomaly_risk") or 0.0)
        graph = float(prediction.get("graph_score") or 0.0)
        return max(1, min(int(round(probability * 70 + anomaly * 20 + graph * 10)), 100))

    def _incident_group_id(self, tx: Dict[str, Any], prediction: Dict[str, Any]) -> str:
        seed = "|".join(
            [
                str(tx.get("source_account") or "unknown"),
                str(tx.get("destination_account") or "unknown"),
                str(tx.get("type") or "unknown").upper(),
                str(prediction.get("risk_level") or "LOW").upper(),
            ]
        )
        return f"incident-{hashlib.md5(seed.encode('utf-8')).hexdigest()[:10]}"

    def build_alert(self, tx: Dict[str, Any], prediction: Dict[str, Any], client_id: str) -> Dict[str, Any]:
        timestamp = datetime.now().isoformat()
        severity = self._default_severity(prediction)
        explanation = list(prediction.get("explanation") or [])
        explanation_details = list(prediction.get("explanation_details") or [])
        sparkline = [
            float(item.get("fraud_probability") or 0.0)
            for item in realtime_store.get_recent_predictions(limit=12)
            if str(item.get("source_account") or "") == str(tx.get("source_account") or "")
        ][-7:]
        if prediction.get("fraud_probability") is not None:
            sparkline.append(float(prediction.get("fraud_probability") or 0.0))
        return {
            "timestamp": timestamp,
            "client_id": client_id,
            "type": tx.get("type"),
            "amount": tx.get("amount"),
            "source_account": tx.get("source_account"),
            "destination_account": tx.get("destination_account"),
            "risk_level": prediction.get("risk_level"),
            "fraud_probability": prediction.get("fraud_probability"),
            "graph_score": prediction.get("graph_score"),
            "anomaly_score": prediction.get("anomaly_score"),
            "status": "new",
            "severity": severity,
            "priority_score": self._priority_score(prediction),
            "incident_group_id": self._incident_group_id(tx, prediction),
            "reason_chips": explanation[:4] or list(prediction.get("behavioral_signals") or [])[:4],
            "model_explanation": explanation_details,
            "graph_context": {
                "graph_score": prediction.get("graph_score"),
                "ring_detected": prediction.get("ring_detected"),
                "triangle_cycle_detected": prediction.get("triangle_cycle_detected"),
                "hub_flag": prediction.get("hub_flag"),
                "mule_flag": prediction.get("mule_flag"),
                "burst_cluster_flag": prediction.get("burst_cluster_flag"),
                "shared_counterparties": prediction.get("shared_counterparties"),
                "prior_risk_hits": prediction.get("prior_risk_hits"),
            },
            "transaction_context": {
                "type": tx.get("type"),
                "amount": tx.get("amount"),
                "source_account": tx.get("source_account"),
                "destination_account": tx.get("destination_account"),
                "oldbalanceOrg": tx.get("oldbalanceOrg"),
                "newbalanceOrig": tx.get("newbalanceOrig"),
                "oldbalanceDest": tx.get("oldbalanceDest"),
                "newbalanceDest": tx.get("newbalanceDest"),
            },
            "sparkline": sparkline,
            "audit_trail": [
                {
                    "timestamp": timestamp,
                    "action": "detected",
                    "title": "Alert created",
                    "description": "Fraud engine raised a new alert from the live scoring pipeline.",
                    "severity": severity,
                    "category": "detection",
                    "actor": "system",
                }
            ],
            "incident_timeline": [
                {
                    "timestamp": timestamp,
                    "action": "detected",
                    "title": "Fraud signal detected",
                    "description": f"Alert opened with probability {prediction.get('fraud_probability')}.",
                    "severity": severity,
                    "category": "detection",
                    "actor": "system",
                }
            ],
        }

    def _send_email(self, alert: Dict[str, Any]) -> Dict[str, str]:
        settings = get_settings()
        user_preferences = self._resolve_user_preferences(str(alert.get("client_id") or ""))
        user_email_enabled = user_preferences.get("email_alerts_enabled")
        if user_email_enabled is None:
            user_email_enabled = bool(
                dict(user_preferences.get("alert_preferences") or {}).get("channels", {}).get("email", True)
            )
        if not user_email_enabled:
            return {"status": "disabled", "detail": "Email alerts are disabled for this user.", "target": ""}
        if not settings.get("email_alerts_enabled", True):
            return {"status": "disabled", "detail": "Email alerts are disabled in runtime settings.", "target": ""}

        delivery = dict(settings.get("alert_delivery") or {})
        user_delivery = dict(user_preferences.get("alert_delivery") or {})
        recipient = (
            read_secret("PAYWATCH_ALERT_EMAIL_TO")
            or str(user_delivery.get("email_recipient") or "").strip().lower()
            or str(delivery.get("email_recipient") or "").strip().lower()
            or self._resolve_recipient_email(str(alert.get("client_id") or ""))
        )
        sender = (
            read_secret("PAYWATCH_ALERT_EMAIL_FROM")
            or str(user_delivery.get("email_sender") or "").strip().lower()
            or str(delivery.get("email_sender") or "").strip().lower()
            or "alerts@paywatch.local"
        )
        configured_host = (
            read_secret("PAYWATCH_SMTP_HOST")
            or str(user_delivery.get("smtp_host") or "").strip()
            or str(delivery.get("smtp_host") or "").strip()
        )
        smtp_user = (
            read_secret("PAYWATCH_SMTP_USER")
            or str(user_delivery.get("smtp_username") or "").strip()
            or str(delivery.get("smtp_username") or "").strip()
        )
        smtp_password = (
            read_secret("PAYWATCH_SMTP_PASSWORD")
            or str(user_delivery.get("smtp_password") or "")
            or str(delivery.get("smtp_password") or "")
        )
        configured_port = user_delivery.get("smtp_port") or delivery.get("smtp_port")
        default_port = "1025" if not configured_host else str(configured_port or "587")
        try:
            smtp_port = int(read_secret("PAYWATCH_SMTP_PORT", default_port) or default_port)
        except Exception:
            smtp_port = 1025 if not configured_host else 587
        starttls_value = user_delivery.get("starttls")
        if starttls_value is None:
            starttls_value = delivery.get("starttls", True)
        require_auth_value = user_delivery.get("require_auth")
        if require_auth_value is None:
            require_auth_value = delivery.get("require_auth", True)
        starttls_default = "false" if smtp_port == 1025 else str(starttls_value).lower()
        require_auth_default = "false" if smtp_port == 1025 else str(require_auth_value).lower()
        starttls_enabled = str(read_secret("PAYWATCH_SMTP_STARTTLS", starttls_default) or starttls_default).lower() in {"1", "true", "yes"}
        auth_required = str(read_secret("PAYWATCH_SMTP_REQUIRE_AUTH", require_auth_default) or require_auth_default).lower() in {"1", "true", "yes"}

        if not recipient:
            return {"status": "skipped", "detail": "No alert recipient email is configured.", "target": ""}

        host_candidates = []
        for candidate in [configured_host, "127.0.0.1", "localhost", "mailpit"]:
            candidate = str(candidate or "").strip()
            if candidate and candidate not in host_candidates:
                host_candidates.append(candidate)

        if not host_candidates:
            return {"status": "skipped", "detail": "No SMTP host is configured.", "target": recipient}

        if auth_required and (not smtp_user or not smtp_password):
            return {
                "status": "skipped",
                "detail": "SMTP authentication is required but credentials are missing.",
                "target": recipient,
            }

        message = EmailMessage()
        message["Subject"] = f"[PayWatch] High-risk transaction for {alert['client_id']}"
        message["From"] = sender
        message["To"] = recipient
        message.set_content(
            f"High-risk transaction detected.\n\n"
            f"Client: {alert['client_id']}\n"
            f"Type: {alert['type']}\n"
            f"Amount: {alert['amount']}\n"
            f"Risk: {alert['risk_level']}\n"
            f"Fraud Probability: {alert['fraud_probability']}\n"
        )

        errors = []
        for smtp_host in host_candidates:
            try:
                with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as smtp:
                    smtp.ehlo()
                    if starttls_enabled:
                        smtp.starttls(context=ssl.create_default_context())
                        smtp.ehlo()
                    if auth_required:
                        smtp.login(smtp_user, smtp_password)
                    smtp.send_message(message)
                return {
                    "status": "sent",
                    "detail": f"Email sent to {recipient} via {smtp_host}:{smtp_port}.",
                    "target": recipient,
                }
            except Exception as exc:
                errors.append(f"{smtp_host}:{smtp_port} {exc.__class__.__name__}")
        return {
            "status": "failed",
            "detail": "Unable to deliver email via " + ", ".join(errors[:3]),
            "target": recipient,
        }

    def _send_sms(self, alert: Dict[str, Any]) -> str:
        if not get_settings().get("sms_alerts_enabled", False):
            return "disabled"

        account_sid = read_secret("PAYWATCH_TWILIO_ACCOUNT_SID")
        auth_token = read_secret("PAYWATCH_TWILIO_AUTH_TOKEN")
        from_number = read_secret("PAYWATCH_TWILIO_FROM")
        to_number = read_secret("PAYWATCH_ALERT_SMS_TO")
        api_base = str(read_secret("PAYWATCH_TWILIO_API_BASE_URL", "https://api.twilio.com") or "https://api.twilio.com").rstrip("/")
        if all([account_sid, auth_token, from_number, to_number]):
            try:
                response = requests.post(
                    f"{api_base}/2010-04-01/Accounts/{account_sid}/Messages.json",
                    auth=(account_sid, auth_token),
                    data={
                        "From": from_number,
                        "To": to_number,
                        "Body": (
                            f"High-risk transaction detected for {alert['client_id']}: "
                            f"{alert['type']} amount={alert['amount']} risk={alert['risk_level']}"
                        ),
                    },
                    timeout=10,
                )
                return "sent" if response.ok else "failed"
            except Exception:
                return "failed"

        webhook = read_secret("PAYWATCH_ALERT_SMS_WEBHOOK")
        if not webhook:
            return "skipped"

        try:
            response = requests.post(
                webhook,
                json={
                    "message": (
                        f"High-risk transaction: {alert['client_id']} "
                        f"{alert['type']} {alert['amount']} risk={alert['risk_level']}"
                    )
                },
                timeout=5,
            )
            return "sent" if response.ok else "failed"
        except Exception:
            return "failed"

    def _send_webhook(self, alert: Dict[str, Any]) -> str:
        webhook = read_secret("PAYWATCH_ALERT_WEBHOOK_URL")
        if not webhook:
            return "skipped"

        headers = {}
        webhook_token = read_secret("PAYWATCH_ALERT_WEBHOOK_TOKEN")
        if webhook_token:
            headers["Authorization"] = f"Bearer {webhook_token}"

        try:
            response = requests.post(webhook, json={"alert": alert}, headers=headers, timeout=5)
            return "sent" if response.ok else "failed"
        except Exception:
            return "failed"

    def dispatch(self, alert: Dict[str, Any]) -> Dict[str, Any]:
        payload = dict(alert)
        email_result = self._send_email(payload)
        payload["email_status"] = email_result["status"]
        payload["email_detail"] = email_result.get("detail", "")
        payload["email_target"] = email_result.get("target", "")
        payload["sms_status"] = self._send_sms(payload)
        payload["webhook_status"] = self._send_webhook(payload)
        payload["channel_history"] = [
            {
                "timestamp": datetime.now().isoformat(),
                "channel": "email",
                "status": payload["email_status"],
                "detail": payload.get("email_detail", ""),
                "target": payload.get("email_target", ""),
            },
            {"timestamp": datetime.now().isoformat(), "channel": "sms", "status": payload["sms_status"]},
            {"timestamp": datetime.now().isoformat(), "channel": "webhook", "status": payload["webhook_status"]},
        ]
        payload.setdefault("audit_trail", []).append(
            {
                "timestamp": datetime.now().isoformat(),
                "action": "dispatched",
                "title": "Alert dispatched",
                "description": "Alert notifications were dispatched across enabled channels.",
                "severity": "info",
                "category": "notification",
                "actor": "system",
            }
        )
        payload.setdefault("incident_timeline", []).extend(
            [
                {
                    "timestamp": datetime.now().isoformat(),
                    "action": "channel_update",
                    "title": f"{entry['channel'].upper()} {entry['status']}",
                    "description": entry.get("detail") or f"{entry['channel']} delivery status changed to {entry['status']}.",
                    "severity": "info" if entry["status"] == "sent" else "warning",
                    "category": "notification",
                    "actor": "system",
                }
                for entry in payload["channel_history"]
            ]
        )
        realtime_store.push_alert(payload)
        realtime_store.push_notification(
            {
                "alert_timestamp": payload["timestamp"],
                "title": "New alert",
                "message": f"{payload.get('type', 'Transaction')} alert opened for {payload.get('client_id', 'client')}.",
                "channel": "alert",
                "severity": payload.get("severity", "high"),
            }
        )
        for channel in payload["channel_history"]:
            realtime_store.push_notification(
                {
                    "alert_timestamp": payload["timestamp"],
                    "title": f"{channel['channel'].upper()} {channel['status']}",
                    "message": channel.get("detail") or f"{channel['channel']} delivery finished with status {channel['status']}.",
                    "channel": channel["channel"],
                    "severity": payload.get("severity", "info"),
                }
            )
        return payload

    def send_test_email(self, client_id: str) -> Dict[str, Any]:
        timestamp = datetime.now().isoformat()
        test_alert = {
            "timestamp": timestamp,
            "client_id": client_id,
            "type": "TEST_ALERT",
            "amount": 0,
            "risk_level": "HIGH",
            "fraud_probability": 0.99,
            "severity": "info",
        }
        result = self._send_email(test_alert)
        realtime_store.push_notification(
            {
                "alert_timestamp": timestamp,
                "title": f"EMAIL {result.get('status', 'unknown').upper()}",
                "message": result.get("detail") or "Test email attempted.",
                "channel": "email",
                "severity": "info",
            }
        )
        return {
            "status": "ok",
            "delivery": result,
            "timestamp": timestamp,
        }


alert_manager = AlertManager()
