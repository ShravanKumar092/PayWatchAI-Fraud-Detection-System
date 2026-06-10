# 💳 PayWatch AI – Real-Time Fraud Detection System

PayWatch AI is an AI-powered real-time fraud detection platform designed to monitor financial transactions, identify suspicious behavior, and generate explainable fraud alerts using advanced machine learning and behavioral analytics.

---

## 🚀 Key Features

- Real-time fraud detection using live transaction streams  
- Machine Learning models: LightGBM + Isolation Forest  
- Behavioral rules: velocity & spending drift detection  
- Explainable AI using SHAP values  
- FastAPI backend with SSE (Server-Sent Events)  
- Interactive Streamlit dashboard  
- Redis-based live system statistics  
- JWT authentication  
- Auto-retraining ready architecture  

---

## 🧠 How Fraud Is Detected

1. Incoming transactions are streamed in real time  
2. Feature engineering extracts behavioral signals  
3. Velocity & drift rules catch abnormal behavior  
4. LightGBM predicts fraud probability  
5. Isolation Forest detects anomalies  
6. Risk score is generated  
7. SHAP explains why the transaction was flagged  

---



## 🏗️ System Architecture

Transaction Stream
↓
Feature Engineering
↓
Behavior Rules (Velocity + Drift)
↓
ML Models (LightGBM + Isolation Forest)
↓
Risk Scoring
↓
Explainability (SHAP)
↓
FastAPI (SSE / REST)
↓
Streamlit Dashboard


---

## 🛠️ Tech Stack

| Layer | Technology |
|------|-----------|
| Frontend | Streamlit |
| Backend | FastAPI |
| Streaming | SSE |
| ML Models | LightGBM, Isolation Forest |
| Explainability | SHAP |
| Cache | Redis |
| Auth | JWT |
| Deployment | Docker-ready |

---

## 📂 Project Structure
PayWatch-AI-Fraud-Detection/
├── api/
├── src/
├── simulator/
├── training/
├── data/
├── app.py
├── Requirements.txt
└── README.md

---

## ▶️ How to Run the Project

### 1️⃣ Activate Virtual Environment
```bash
.venv\Scripts\activate
Start Redis
redis-server

3️⃣ Start FastAPI Backend
python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload

4️⃣ Start Streamlit UI
streamlit run app.py

🌍 UN Sustainable Development Goals

SDG 8 – Secure financial systems

SDG 9 – Digital infrastructure

SDG 16 – Reduction of financial fraud

🔮 Future Enhancements

Kafka-based bank API integration

Online model retraining

Graph-based fraud detection

Cloud deployment

👨‍💻 Author

Shravankumar
Project: PayWatch AI – Fraud Detection System
