# Commands to Run the Fraud Detection API

## Quick Start Commands

### Option 1: Run from Project Root (PowerShell)
```powershell
python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload
```

### Option 2: Run from Project Root (One Line - PowerShell)
```powershell
python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload
```

### Option 3: Run from Project Root (Command Prompt)
```cmd
python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload
```

### Option 4: Use the Existing Batch File (Port 8020)
```cmd
start_api.bat
```

## Install Dependencies (if needed)
```powershell
pip install -r Requirements.txt
```

## Check if Server is Running
Open your browser and visit:
- API Docs: http://127.0.0.1:8020/docs
- Health Check: http://127.0.0.1:8020/health

## Run the React Frontend
```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 3015
```

Open:
- React App: http://127.0.0.1:3015

## Stop the Server
Press `Ctrl+C` in the terminal where the server is running.

## Test the API
```powershell
# Health check
curl http://127.0.0.1:8020/health

# Or use PowerShell's Invoke-WebRequest
Invoke-WebRequest -Uri http://127.0.0.1:8020/health
```
