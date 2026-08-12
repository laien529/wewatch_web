#!/usr/bin/env bash
set -euo pipefail

echo "===== Mex Cloud 部署脚本 ====="
cd "$(dirname "$0")"

echo ">>> 确保私有环境文件存在"
umask 077
touch .env
chmod 600 .env

echo ">>> 启动数据库"
docker compose up -d db

echo ">>> 等待数据库就绪"
for attempt in {1..30}; do
  if docker compose exec -T db mysqladmin ping -uroot -proot --silent >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "30" ]]; then
    echo "数据库未在预期时间内就绪" >&2
    exit 1
  fi
  sleep 2
done

echo ">>> 执行增量迁移"
for migration in migrate_filter_groups.sql migrate_compensation_analysis.sql; do
  if [[ -f "$migration" ]]; then
    docker compose exec -T db mysql -uroot -proot mex_cloud < "$migration"
  fi
done

echo ">>> 重新构建并切换应用"
docker compose up -d --build --force-recreate app

echo ">>> 检查状态"
docker compose ps app

echo ">>> 健康检查"
for attempt in {1..15}; do
  if curl --silent --show-error --fail --output /dev/null http://127.0.0.1:3000/health; then
    break
  fi
  if [[ "$attempt" == "15" ]]; then
    echo "应用健康检查失败" >&2
    exit 1
  fi
  sleep 2
done

echo ">>> LLM 启动状态"
curl --silent --show-error --fail http://127.0.0.1:3000/api/llm-status
echo

echo "===== 部署完成 ====="
