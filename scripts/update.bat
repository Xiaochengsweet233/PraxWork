@echo off
REM ============================================================
REM  Prax 门户 —— 一键自动更新（Docker 部署 / Windows）
REM
REM  数据安全：数据库与上传文件在 Docker 命名卷 prax-data 里，
REM  git pull 与重建容器都不会覆盖它们。
REM ============================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0\.."

echo.
echo   Prax 门户 —— 自动更新
echo   ------------------------------------------------
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo   [错误] 未检测到 git。
  pause
  exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
  echo   [错误] 未检测到 docker。
  pause
  exit /b 1
)

echo   [1/3] 拉取最新代码...
git pull --ff-only
if errorlevel 1 (
  echo   拉取失败：存在本地改动或网络问题。
  pause
  exit /b 1
)

echo   [2/3] 重新构建镜像...
docker compose build
if errorlevel 1 (
  echo   镜像构建失败。
  pause
  exit /b 1
)

echo   [3/3] 平滑重启容器...
docker compose up -d

echo.
echo   更新完成。数据卷 prax-data 未受影响。
echo   健康检查：curl http://127.0.0.1:3000/healthz
echo.
pause
