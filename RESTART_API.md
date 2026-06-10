# Commands to Restart and Run the API Server

## Stop the API Server

### Option 1: Press Ctrl+C
If the server is running in a terminal, simply press `Ctrl+C` to stop it.

### Option 2: Find and Kill Process (PowerShell)
```powershell
# Find the process using port 8020
Get-NetTCPConnection -LocalPort 8020 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
```

### Option 3: Find and Kill Process (Command Prompt)
```cmd
netstat -ano | findstr :8020
taskkill /PID <PID_NUMBER> /F
```

---

## Start the API Server

### From Project Root (PowerShell)
```powershell
python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload
```

### From Project Root (One Line - PowerShell)
```powershell
python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload
```

### From Project Root (Command Prompt)
```cmd
python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload
```

---

## Restart the API Server (Stop + Start)

### PowerShell Script
```powershell
# Stop any existing server on port 8020
Get-NetTCPConnection -LocalPort 8020 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }

# Wait a moment
Start-Sleep -Seconds 2

# Start the server
python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload
```

---

## Run React Frontend

### From Frontend Folder (PowerShell)
```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 3000
```

### From Frontend Folder (Command Prompt)
```cmd
npm install
npm run dev -- --host 127.0.0.1 --port 3000
```

---

## Quick Reference

**API Server:**
- URL: http://127.0.0.1:8020
- Docs: http://127.0.0.1:8020/docs
- Health: http://127.0.0.1:8020/health

**React App:**
- Usually runs on: http://127.0.0.1:3000

**Legacy Streamlit App:**
- Still available for fallback in `app.py`

---

## Troubleshooting

**Port already in use:**
```powershell
# Kill process on port 8020
Get-NetTCPConnection -LocalPort 8020 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
```

**Check if server is running:**
```powershell
Invoke-WebRequest -Uri http://127.0.0.1:8020/health
```

