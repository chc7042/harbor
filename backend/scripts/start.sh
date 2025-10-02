#!/bin/sh
set -e

echo "Starting Harbor backend..."

# 마이그레이션 실행
/app/scripts/migrate.sh

echo "Starting Node.js application..."
exec node src/app.js