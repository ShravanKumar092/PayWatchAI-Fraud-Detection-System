import random
import time
from datetime import datetime
from typing import Any, Dict, Iterator


TRANSACTION_TYPES = ["PAYMENT", "TRANSFER", "CASH_OUT", "CASH_IN", "DEBIT"]


def generate_transaction() -> Dict[str, Any]:
    account_seed = random.randint(1000, 9999)
    amount = round(random.uniform(10, 10000), 2)
    old_origin = round(random.uniform(amount, amount + 20000), 2)
    old_destination = round(random.uniform(0, 20000), 2)

    return {
        "step": random.randint(1, 24),
        "type": random.choice(TRANSACTION_TYPES),
        "amount": amount,
        "oldbalanceOrg": old_origin,
        "newbalanceOrig": round(max(old_origin - amount, 0.0), 2),
        "oldbalanceDest": old_destination,
        "newbalanceDest": round(old_destination + amount, 2),
        "source_account": f"user-{account_seed}",
        "destination_account": f"merchant-{random.randint(100, 999)}",
        "timestamp": datetime.utcnow().isoformat(),
    }


def generate_stream(interval_seconds: float = 2.0) -> Iterator[Dict[str, Any]]:
    while True:
        yield generate_transaction()
        time.sleep(interval_seconds)
