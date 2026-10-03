#!/usr/bin/env bash
# ============================================================
#  橙曦澎湃 / Prax 门户网站 —— Linux / macOS 一键启动
# ============================================================
set -e
cd "$(dirname "$0")"

echo
echo "  橙曦澎湃  Project Rootpi & Xiaocheng  (Prax)"
echo "  ------------------------------------------------"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  [错误] 没有检测到 Node.js。"
  echo "  请先安装 Node.js 22.13 或更高版本（推荐 24 LTS）：https://nodejs.org/"
  exit 1
fi

echo "  Node 版本：$(node -v)"

if [ ! -d node_modules ]; then
  echo
  echo "  首次运行，正在安装依赖..."
  npm install --no-fund --no-audit
fi

mkdir -p public/uploads

echo
echo "  正在启动服务..."
echo "  门户主页   http://localhost:3000/"
echo "  工坊子页   http://localhost:3000/atelier"
echo "  协同后台   http://localhost:3000/admin"
echo
echo "  按 Ctrl+C 停止服务"
echo

node server/seed.js
exec node server/index.js
