@echo off
setlocal
cd /d "%~dp0"
echo.
echo ===== AASRA - local run =====
echo.

rem ---------- backend: Python virtual environment ----------
if exist "backend\.venv\Scripts\python.exe" goto venv_ready
echo Creating the Python environment...
py -3.13 -m venv backend\.venv >nul 2>&1
if exist "backend\.venv\Scripts\python.exe" goto venv_ready
py -3.12 -m venv backend\.venv >nul 2>&1
if exist "backend\.venv\Scripts\python.exe" goto venv_ready
python -m venv backend\.venv >nul 2>&1
if exist "backend\.venv\Scripts\python.exe" goto venv_ready
echo ERROR: Python was not found. Install Python 3.13 from python.org, then run this again.
pause
exit /b 1

:venv_ready
backend\.venv\Scripts\python.exe --version
echo Installing backend packages - the first run takes a few minutes...
backend\.venv\Scripts\python.exe -m pip install --disable-pip-version-check -q -r backend\requirements.txt
if errorlevel 1 (
  echo ERROR: backend install failed. Scroll up for the pip message.
  pause
  exit /b 1
)

rem ---------- frontend: Node packages ----------
where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install Node 20 or newer from nodejs.org, then run this again.
  pause
  exit /b 1
)
if not exist "frontend\.env.local" copy "frontend\.env.example" "frontend\.env.local" >nul
if exist "frontend\node_modules" goto start_servers
echo Installing frontend packages - the first run takes a few minutes...
pushd frontend
call npm install --no-audit --no-fund
popd
if not exist "frontend\node_modules" (
  echo ERROR: npm install failed. Scroll up for the npm message.
  pause
  exit /b 1
)

:start_servers
echo.
echo Starting backend on http://localhost:8000 and frontend on http://localhost:3000
start "AASRA backend :8000" /D "%~dp0backend" cmd /k .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
start "AASRA frontend :3000" /D "%~dp0frontend" cmd /k npm run dev
echo Waiting for both servers...
timeout /t 15 /nobreak >nul
start "" http://localhost:3000
echo.
echo Opened http://localhost:3000 in your browser.
echo To stop: close the two windows named "AASRA backend" and "AASRA frontend".
echo.
pause
