import json
import os
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List

import requests


API_BASE_URL = os.getenv("PAYWATCH_LOAD_API_BASE_URL", "http://127.0.0.1:8020")
API_KEY = os.getenv("PAYWATCH_API_KEY", "paywatch-secure-key")
CONCURRENCY = int(os.getenv("PAYWATCH_LOAD_CONCURRENCY", "8"))
DURATION_SECONDS = int(os.getenv("PAYWATCH_LOAD_DURATION_SECONDS", "20"))

HEADERS = {"x-api-key": API_KEY, "Content-Type": "application/json"}
LATENCIES: List[float] = []
LOCK = threading.Lock()
COUNTERS = {"success": 0, "errors": 0}


def build_payload(seed: int) -> Dict[str, Any]:
    return {
        "step": (seed % 24) + 1,
        "type": "TRANSFER" if seed % 2 else "PAYMENT",
        "amount": 250.0 + seed,
        "oldbalanceOrg": 10000.0,
        "newbalanceOrig": 9750.0,
        "oldbalanceDest": 5000.0,
        "newbalanceDest": 5250.0,
        "source_account": f"load-user-{seed % 25}",
        "destination_account": f"load-merchant-{seed % 10}",
    }


def worker(index: int, deadline: float) -> None:
    iteration = 0
    while time.time() < deadline:
        payload = build_payload(index * 1000 + iteration)
        started = time.perf_counter()
        try:
            response = requests.post(f"{API_BASE_URL}/predict", headers=HEADERS, data=json.dumps(payload), timeout=10)
            elapsed = time.perf_counter() - started
            with LOCK:
                LATENCIES.append(elapsed)
                if response.ok:
                    COUNTERS["success"] += 1
                else:
                    COUNTERS["errors"] += 1
        except Exception:
            with LOCK:
                COUNTERS["errors"] += 1
        iteration += 1


def main() -> None:
    deadline = time.time() + DURATION_SECONDS
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        for index in range(CONCURRENCY):
            executor.submit(worker, index, deadline)

    total = COUNTERS["success"] + COUNTERS["errors"]
    duration = max(DURATION_SECONDS, 1)
    percentile_index = max(int(len(LATENCIES) * 0.95) - 1, 0) if LATENCIES else 0
    summary = {
        "status": "ok",
        "requests": total,
        "success": COUNTERS["success"],
        "errors": COUNTERS["errors"],
        "rps": round(total / duration, 2),
        "avg_latency_ms": round(statistics.mean(LATENCIES) * 1000, 2) if LATENCIES else None,
        "p95_latency_ms": round(sorted(LATENCIES)[percentile_index] * 1000, 2) if LATENCIES else None,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
