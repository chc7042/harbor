#!/bin/bash

# Jenkins NAS 배포 이력 관리 - 개발 환경 설정 스크립트

set -e  # 오류 시 스크립트 중단

echo "🚀 Jenkins NAS 배포 이력 관리 개발 환경 설정 시작..."

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 함수 정의
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 1. 필수 도구 확인
print_status "필수 도구 확인 중..."

if ! command -v docker &> /dev/null; then
    print_error "Docker가 설치되어 있지 않습니다."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose가 설치되어 있지 않습니다."
    exit 1
fi

if ! command -v node &> /dev/null; then
    print_warning "Node.js가 설치되어 있지 않습니다. Docker를 사용하여 개발 환경을 구성합니다."
else
    NODE_VERSION=$(node --version | cut -c2-)
    print_success "Node.js $NODE_VERSION 발견"
fi

# 2. 환경변수 파일 설정
print_status "환경변수 파일 설정 중..."

if [ ! -f .env ]; then
    print_status ".env 파일이 없습니다. .env.example에서 복사 중..."
    cp .env.example .env
    print_warning "⚠️  .env 파일을 확인하고 필요한 값들을 수정하세요!"
else
    print_success ".env 파일이 이미 존재합니다."
fi

# 3. 로그 디렉토리 생성
print_status "로그 디렉토리 생성 중..."
mkdir -p logs
mkdir -p backend/logs
print_success "로그 디렉토리 생성 완료"

# 4. Docker 네트워크 및 볼륨 확인
print_status "Docker 리소스 확인 중..."

# 기존 컨테이너 정리 (옵션)
if [ "$1" = "--clean" ]; then
    print_status "기존 컨테이너 정리 중..."
    docker-compose down -v 2>/dev/null || true
    docker system prune -f 2>/dev/null || true
    print_success "컨테이너 정리 완료"
fi

# 5. 백엔드 설정
print_status "백엔드 환경 설정 중..."
if [ -f "backend/package.json" ]; then
    print_success "백엔드 package.json 발견"
else
    print_warning "백엔드 package.json이 없습니다. 나중에 생성해야 합니다."
fi

# 6. 프론트엔드 설정
print_status "프론트엔드 환경 설정 중..."
if [ -f "frontend/package.json" ]; then
    print_success "프론트엔드 package.json 발견"
else
    print_warning "프론트엔드 package.json이 없습니다. 나중에 생성해야 합니다."
fi

# 7. 데이터베이스 초기화 스크립트 확인
print_status "데이터베이스 스크립트 확인 중..."
if [ -f "database/init.sql" ]; then
    print_success "데이터베이스 초기화 스크립트 발견"
else
    print_warning "database/init.sql이 없습니다. 나중에 생성해야 합니다."
fi

# 8. NAS 마운트 포인트 체크
print_status "NAS 마운트 설정 확인 중..."
if [ -d "/mnt/nas" ]; then
    print_success "NAS 마운트 포인트 /mnt/nas 발견"
else
    print_warning "NAS 마운트 포인트가 없습니다. docker-compose.yml에서 경로를 수정하세요."
fi

# 9. Docker Compose 빌드 및 시작
print_status "Docker 컨테이너 빌드 및 시작 중..."

if docker-compose up -d --build; then
    print_success "Docker 컨테이너가 성공적으로 시작되었습니다!"

    # 컨테이너 상태 확인
    echo ""
    print_status "컨테이너 상태 확인 중..."
    docker-compose ps

    # 서비스 접근 정보 출력
    echo ""
    echo "🌟 서비스 접근 정보:"
    echo "  • 프론트엔드: http://localhost:5173"
    echo "  • 백엔드 API: http://localhost:3001"
    echo "  • PostgreSQL: localhost:5432"
    echo "  • Redis: localhost:6379"
    echo ""

    # 로그 확인 명령어 안내
    print_status "유용한 명령어:"
    echo "  • 로그 확인: docker-compose logs -f [service_name]"
    echo "  • 컨테이너 중지: docker-compose down"
    echo "  • 컨테이너 재시작: docker-compose restart"
    echo "  • DB 접속: docker-compose exec postgres psql -U postgres -d jenkins_nas_deployment"

else
    print_error "Docker 컨테이너 시작에 실패했습니다."
    exit 1
fi

print_success "🎉 개발 환경 설정이 완료되었습니다!"
print_warning "📝 .env 파일에서 LDAP 및 NAS 설정을 확인하세요."