#!/bin/bash

# Harbor 프로덕션 배포 스크립트
# 사용법: ./deploy-prod.sh

echo "Harbor 프로덕션 환경 배포 시작..."

# 현재 디렉토리 확인
if [ ! -f "docker-compose.prod.yml" ]; then
    echo "❌ docker-compose.prod.yml 파일을 찾을 수 없습니다. 프로젝트 루트에서 실행해주세요."
    exit 1
fi

# .env.prod 파일 확인
if [ ! -f ".env.prod" ]; then
    echo "❌ .env.prod 파일을 찾을 수 없습니다."
    exit 1
fi

echo "✅ 환경 설정 파일 확인 완료"

# .env.prod 파일을 .env로 복사하여 Docker Compose가 읽을 수 있도록 함
echo "📋 환경 변수 설정 중..."
cp .env.prod .env

# Docker Compose로 서비스 시작
echo "🚀 Docker 서비스 빌드 및 시작..."
docker compose -f docker-compose.prod.yml up --build -d

# 서비스 상태 확인
echo "🔍 서비스 상태 확인 중..."
sleep 10

# 헬스체크
echo "🏥 헬스체크 수행 중..."
if curl -f http://harbor.roboetech.com:8080/health > /dev/null 2>&1; then
    echo "✅ Harbor 애플리케이션이 정상적으로 실행 중입니다!"
    echo "🌐 접속 URL: http://harbor.roboetech.com:8080"
else
    echo "⚠️  헬스체크 실패 - 서비스 로그를 확인해주세요:"
    echo "   docker compose -f docker-compose.prod.yml logs backend"
fi

# 임시 .env 파일 정리
rm -f .env

echo "✨ 배포 완료!"