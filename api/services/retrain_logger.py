import csv
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
FILE = os.path.join(PROJECT_ROOT, "data", "retrain_data.csv")

def log_for_retraining(tx, label):
    os.makedirs(os.path.dirname(FILE), exist_ok=True)
    exists = os.path.exists(FILE)

    with open(FILE, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(tx.keys()) + ["isFraud"])
        if not exists:
            writer.writeheader()
        writer.writerow({**tx, "isFraud": label})
