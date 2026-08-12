#!/usr/bin/env bash
set -euo pipefail

# 可通过环境变量覆盖，示例：ALIYUN_SSH_TARGET=root@1.2.3.4 ./deploy-aliyun.sh
ALIYUN_SSH_TARGET="${ALIYUN_SSH_TARGET:-root@8.162.11.60}"
REMOTE_PROJECT_DIR="${REMOTE_PROJECT_DIR:-/root/wewatch_web/mex-cloud-service-prod-admin}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_PROJECT_DIR="$SCRIPT_DIR/mex-cloud-service-prod-admin"

if [[ ! -f "$LOCAL_PROJECT_DIR/docker-compose.yml" ]]; then
  echo "找不到应用目录：$LOCAL_PROJECT_DIR" >&2
  exit 1
fi

echo ">>> 同步应用代码至 $ALIYUN_SSH_TARGET:$REMOTE_PROJECT_DIR"
rsync -az \
  --exclude='node_modules/' \
  --exclude='.env' \
  --exclude='.DS_Store' \
  "$LOCAL_PROJECT_DIR/" "$ALIYUN_SSH_TARGET:$REMOTE_PROJECT_DIR/"

echo ">>> 在阿里云执行迁移、构建和健康检查"
ssh "$ALIYUN_SSH_TARGET" "bash '$REMOTE_PROJECT_DIR/deploy.sh'"

echo "===== 阿里云发布完成 ====="
