from api.services.fraud_engine import reload_models
from api.services.model_lifecycle import train_and_promote_models


if __name__ == "__main__":
    result = train_and_promote_models(force=True)
    if result.get("status") == "ok":
        reload_models()
    print(result)
