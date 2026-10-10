#!/usr/bin/env bash
# ============================================================
#  Prax 门户 —— 一键自动更新（Docker 部署）
#
#  做什么：
#   1. 拉取最新代码（git pull）
#   2. 重新构建镜像（docker compose build）
#   3. 平滑重启容器（docker compose up -d）
#
#  为什么数据不会丢：
#   数据库与上传文件都在 Docker 命名卷 prax-data 里（见 docker-compose.yml），
#   重建容器只会替换「代码」层，不会碰数据卷；
#   同时 data/ 与 public/uploads/ 已在 .gitignore 中排除，git pull 也不会覆盖它们。
#
#  用法：
#   chmod +x scripts/update.sh && ./scripts/update.sh
# ============================================================
set -e
cd "$(dirname "$0")/.."

echo
echo "  Prax 门户 —— 自动更新"
echo "  ------------------------------------------------"
echo

if ! command -v git >/dev/null 2>&1; then
  echo "  [错误] 未检测到 git，无法拉取更新。"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "  [错误] 未检测到 docker，无法重建镜像。"
  exit 1
fi

echo "  [1/3] 拉取最新代码…"
git pull --ff-only || { echo "  拉取失败：存在本地改动或网络问题，请先处理 git status。"; exit 1; }

echo "  [2/3] 重新构建镜像…"
docker compose build

echo "  [3/3] 平滑重启容器…"
docker compose up -d

echo
echo "  更新完成。数据卷 prax-data 未受影响。"
echo "  健康检查：curl http://127.0.0.1:3000/healthz"
echo
