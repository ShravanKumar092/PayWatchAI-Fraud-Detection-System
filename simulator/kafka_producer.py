import json
import os
import time
from pathlib import Path
from typing import Any

from simulator.transaction_simulator import generate_transaction

kafka: Any = None

try:
    import kafka as _kafka  # type: ignore

    kafka = _kafka
except Exception as exc:  # pragma: no cover - startup-time dependency guard
    raise SystemExit(f"kafka-python is required for the Kafka producer: {exc}")


def main() -> None:
    bootstrap_servers = os.getenv("PAYWATCH_KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    topic = os.getenv("PAYWATCH_KAFKA_TOPIC", "paywatch-transactions")
    interval_seconds = float(os.getenv("PAYWATCH_KAFKA_PRODUCER_INTERVAL", "2"))
    reconnect_delay = float(os.getenv("PAYWATCH_KAFKA_PRODUCER_RECONNECT_DELAY", "5"))
    heartbeat_file = Path(os.getenv("PAYWATCH_KAFKA_HEARTBEAT_FILE", "/tmp/paywatch-kafka-producer-heartbeat.json"))
    producer: Any = None

    def write_heartbeat(status: str, error: str = "", payload: dict | None = None) -> None:
        heartbeat_file.parent.mkdir(parents=True, exist_ok=True)
        heartbeat_file.write_text(
            json.dumps(
                {
                    "timestamp": time.time(),
                    "status": status,
                    "error": error,
                    "topic": topic,
                    "bootstrap_servers": bootstrap_servers,
                    "last_payload_timestamp": payload.get("timestamp") if payload else None,
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    print(f"Starting Kafka transaction producer on {bootstrap_servers}, topic={topic}")
    write_heartbeat("starting")
    while True:
        try:
            if producer is None:
                write_heartbeat("connecting")
                producer = kafka.KafkaProducer(
                    bootstrap_servers=bootstrap_servers,
                    value_serializer=lambda payload: json.dumps(payload).encode("utf-8"),
                    retries=5,
                    linger_ms=50,
                )
                write_heartbeat("connected")

            payload = generate_transaction()
            future = producer.send(topic, payload)
            future.get(timeout=10)
            producer.flush()
            write_heartbeat("healthy", payload=payload)
            print(f"Produced transaction {payload['timestamp']} amount={payload['amount']}")
            time.sleep(interval_seconds)
        except Exception as exc:
            write_heartbeat("error", error=str(exc))
            print(f"Kafka producer error: {exc}")
            try:
                if producer is not None:
                    producer.close()
            except Exception:
                pass
            producer = None
            time.sleep(reconnect_delay)


if __name__ == "__main__":
    main()
