@echo off
chcp 65001 >nul
setlocal

set "SITE_DIR=%~dp0"
set "API_DIR=%SITE_DIR%..\web-phase4-api-lihaoze"

if not exist "%API_DIR%\app.py" (
  echo [ERROR] 找不到 API 目录：
  echo   %API_DIR%
  echo 请把 web-phase4-api-lihaoze 和 web-phase4-lihaoze 放在同一个目录下。
  pause
  exit /b 1
)

if not exist "%API_DIR%\.venv\Scripts\python.exe" (
  echo [ERROR] 找不到 API 虚拟环境：
  echo   %API_DIR%\.venv\Scripts\python.exe
  echo 请先按 README 创建 .venv 并安装依赖。
  pause
  exit /b 1
)

echo 正在启动 Flask API...
start "Task API" /D "%API_DIR%" cmd /k ".venv\Scripts\python.exe app.py"

echo 正在启动前端...
start "Task Web" /D "%SITE_DIR%" cmd /k "python serve.py --port 8000"

timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8000/app.html"

echo.
echo 已启动：
echo   API:  http://127.0.0.1:5000/api/tasks
echo   Web:  http://127.0.0.1:8000/app.html
echo.
echo 关闭两个命令行窗口即可停止服务。
endlocal
