import json
import os
import time

import requests


API_BASE_URL = os.getenv("PAYWATCH_LOAD_API_BASE_URL", "http://127.0.0.1:8020")
API_KEY = os.getenv("PAYWATCH_API_KEY", "paywatch-secure-key")
DURATION_SECONDS = int(os.getenv("PAYWATCH_SSE_SOAK_DURATION_SECONDS", "20"))


def main() -> None:
    url = f"{API_BASE_URL}/stream"
    counts = {"transaction": 0, "warning": 0, "waiting": 0, "disconnects": 0}
    current_event = "message"
    deadline = time.time() + DURATION_SECONDS

    with requests.get(url, params={"api_key": API_KEY}, stream=True, timeout=30) as response:
        response.raise_for_status()
        for raw_line in response.iter_lines(decode_unicode=True):
            if time.time() > deadline:
                break
            if raw_line is None:
                continue
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("event:"):
                current_event = line.split(":", 1)[1].strip()
                counts.setdefault(current_event, 0)
            elif line.startswith("data:"):
                counts[current_event] = counts.get(current_event, 0) + 1
                try:
                    json.loads(line.split(":", 1)[1].strip())
                except Exception:
                    counts["warning"] = counts.get("warning", 0) + 1

    print(json.dumps({"status": "ok", "duration_seconds": DURATION_SECONDS, "counts": counts}, indent=2))


if __name__ == "__main__":
    main()
