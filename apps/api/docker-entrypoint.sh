#!/bin/sh
# Khởi động API trong container: đồng bộ schema DB trước, seed (tùy chọn), rồi chạy server.
set -e

cd /repo/apps/api

PRISMA="./node_modules/.bin/prisma"

echo "[api] Áp dụng migration vào cơ sở dữ liệu..."
"$PRISMA" migrate deploy

if [ "${SEED_ON_START}" = "true" ]; then
  echo "[api] SEED_ON_START=true — tạo dữ liệu mẫu (idempotent)..."
  node dist-seed/seed.js
fi

echo "[api] Khởi động máy chủ..."
exec "$@"
