@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  橙曦澎湃 / Prax 门户网站 —— Windows 一键启动
REM ============================================================

cd /d "%~dp0"

echo.
echo   橙曦澎湃  Project Rootpi ^& Xiaocheng  (Prax)
echo   ------------------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没有检测到 Node.js。
  echo   请先安装 Node.js 22.13 或更高版本（推荐 24 LTS）：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEV=%%v
echo   Node 版本：%NODEV%

if not exist "node_modules" (
  echo.
  echo   首次运行，正在安装依赖...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo   [错误] 依赖安装失败，请检查网络。
    pause
    exit /b 1
  )
)

if not exist "public\uploads" mkdir "public\uploads"

echo.
echo   正在启动服务...
echo   门户主页   http://localhost:3000/
echo   工坊子页   http://localhost:3000/atelier
echo   协同后台   http://localhost:3000/admin
echo.
echo   按 Ctrl+C 停止服务
echo.

node server\seed.js
node server\index.js

pause
