import json
import os
import time

import requests


API_BASE_URL = os.getenv("PAYWATCH_LOAD_API_BASE_URL", "http://127.0.0.1:8020")
API_KEY = os.getenv("PAYWATCH_API_KEY", "paywatch-secure-key")
DURATION_SECONDS = int(os.getenv("PAYWATCH_KAFKA_SOAK_DURATION_SECONDS", "20"))
HEADERS = {"x-api-key": API_KEY}


def fetch_stats() -> dict:
    response = requests.get(f"{API_BASE_URL}/stats", headers=HEADERS, timeout=10)
    response.raise_for_status()
    return response.json()


def main() -> None:
    started_stats = fetch_stats()
    seen_timestamps = set()
    waiting_count = 0
    deadline = time.time() + DURATION_SECONDS

    while time.time() < deadline:
        response = requests.get(f"{API_BASE_URL}/transactions", headers=HEADERS, timeout=10)
        response.raise_for_status()
        payload = response.json()
        if payload.get("status") == "waiting":
            waiting_count += 1
        transaction = payload.get("transaction")
        if isinstance(transaction, dict) and transaction.get("timestamp"):
            seen_timestamps.add(transaction["timestamp"])
        time.sleep(0.5)

    ended_stats = fetch_stats()
    summary = {
        "status": "ok",
        "duration_seconds": DURATION_SECONDS,
        "unique_transactions_seen": len(seen_timestamps),
        "waiting_responses": waiting_count,
        "stats_delta": {
            "total_transactions": int(ended_stats.get("total_transactions", 0)) - int(started_stats.get("total_transactions", 0)),
            "high_risk_count": int(ended_stats.get("high_risk_count", 0)) - int(started_stats.get("high_risk_count", 0)),
        },
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
