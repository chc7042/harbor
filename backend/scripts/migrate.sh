#!/bin/sh
set -e

echo "Starting database migration..."

# PostgreSQL 연결 대기
echo "Waiting for PostgreSQL to be ready..."
until pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}"; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 2
done

echo "PostgreSQL is ready!"

# 데이터베이스 존재 확인 및 생성
echo "Checking if database exists..."
PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 || PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -c "CREATE DATABASE ${DB_NAME};"

# 마이그레이션 실행
echo "Running database migrations..."
for migration in /app/database/migrations/*.sql; do
  if [ -f "$migration" ]; then
    echo "Executing migration: $(basename $migration)"
    PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -f "$migration"
  fi
done

echo "Database migration completed!"