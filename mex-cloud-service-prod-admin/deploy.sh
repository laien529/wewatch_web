#!/bin/bash
set -e

echo "===== Mex Cloud 部署脚本 ====="

echo ">>> 停止旧容器"
docker compose down

echo ">>> 重新构建并启动"
docker compose up -d --build

echo ">>> 检查状态"
docker compose ps

echo ">>> 健康检查"
sleep 3
curl -s http://127.0.0.1:3000/health || echo "⚠️ 健康检查失败"

echo "===== 部署完成 ====="
