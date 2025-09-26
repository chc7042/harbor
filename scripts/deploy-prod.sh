#!/bin/bash

# Jenkins NAS 배포 이력 관리 - 프로덕션 배포 스크립트

set -e  # 오류 시 스크립트 중단

echo "🚀 Jenkins NAS 배포 이력 관리 프로덕션 배포 시작..."

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

# 배포 전 확인사항
print_status "프로덕션 배포 전 확인사항..."

# 1. Git 상태 확인
if [ -d ".git" ]; then
    GIT_STATUS=$(git status --porcelain)
    if [ -n "$GIT_STATUS" ]; then
        print_warning "커밋되지 않은 변경사항이 있습니다:"
        echo "$GIT_STATUS"
        read -p "계속 진행하시겠습니까? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_error "배포가 취소되었습니다."
            exit 1
        fi
    else
        print_success "Git 상태 확인 완료"
    fi
fi

# 2. 환경변수 파일 확인
if [ ! -f .env.prod ]; then
    print_error ".env.prod 파일이 없습니다."
    print_status ".env.prod.example을 복사하여 생성하세요:"
    echo "cp .env.prod.example .env.prod"
    exit 1
fi

print_success ".env.prod 파일 확인 완료"

# 3. 프로덕션 환경변수 보안 체크
print_status "프로덕션 환경변수 보안 체크..."

# 기본값이 변경되었는지 확인
if grep -q "CHANGE_THIS" .env.prod; then
    print_error "⚠️  .env.prod 파일에 기본값이 남아있습니다!"
    print_error "모든 'CHANGE_THIS' 값을 실제 값으로 변경하세요."
    exit 1
fi

print_success "환경변수 보안 체크 완료"

# 4. Docker 및 Docker Compose 확인
if ! command -v docker &> /dev/null; then
    print_error "Docker가 설치되어 있지 않습니다."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose가 설치되어 있지 않습니다."
    exit 1
fi

print_success "Docker 도구 확인 완료"

# 5. 백업 생성 (기존 데이터가 있는 경우)
print_status "기존 데이터 백업 중..."

BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

if docker-compose -f docker-compose.prod.yml ps | grep -q postgres; then
    print_status "데이터베이스 백업 중..."
    docker-compose -f docker-compose.prod.yml exec -T postgres pg_dump -U postgres jenkins_nas_deployment_prod > "$BACKUP_DIR/database_backup.sql" || print_warning "데이터베이스 백업 실패"
fi

print_success "백업 완료: $BACKUP_DIR"

# 6. 이전 컨테이너 중지
print_status "이전 컨테이너 중지 중..."
docker-compose -f docker-compose.prod.yml down || print_warning "기존 컨테이너가 없거나 중지에 실패했습니다."

# 7. 프로덕션 이미지 빌드
print_status "프로덕션 이미지 빌드 중..."
if docker-compose -f docker-compose.prod.yml build --no-cache; then
    print_success "이미지 빌드 완료"
else
    print_error "이미지 빌드 실패"
    exit 1
fi

# 8. 프로덕션 서비스 시작
print_status "프로덕션 서비스 시작 중..."
if docker-compose -f docker-compose.prod.yml up -d; then
    print_success "프로덕션 서비스 시작 완료"
else
    print_error "프로덕션 서비스 시작 실패"
    exit 1
fi

# 9. 헬스체크 대기
print_status "서비스 헬스체크 대기 중..."
sleep 30

# 백엔드 헬스체크
if curl -f http://localhost:3001/health >/dev/null 2>&1; then
    print_success "백엔드 서비스 정상"
else
    print_warning "백엔드 서비스 헬스체크 실패 - 로그를 확인하세요"
fi

# 프론트엔드 헬스체크
if curl -f http://localhost:80 >/dev/null 2>&1; then
    print_success "프론트엔드 서비스 정상"
else
    print_warning "프론트엔드 서비스 헬스체크 실패 - 로그를 확인하세요"
fi

# 10. 배포 후 정리
print_status "배포 후 정리 작업 중..."

# 사용하지 않는 이미지 정리
docker image prune -f >/dev/null 2>&1 || true

print_success "정리 작업 완료"

# 11. 배포 결과 요약
echo ""
echo "🎉 프로덕션 배포 완료!"
echo ""
echo "📋 배포 정보:"
echo "  • 배포 시간: $(date)"
echo "  • 백업 위치: $BACKUP_DIR"
echo "  • 서비스 상태:"
docker-compose -f docker-compose.prod.yml ps

echo ""
echo "🌐 서비스 접근 정보:"
echo "  • 웹 애플리케이션: http://your-domain.com"
echo "  • API 엔드포인트: http://your-domain.com/api"
echo ""

echo "📊 유용한 명령어:"
echo "  • 로그 확인: docker-compose -f docker-compose.prod.yml logs -f [service_name]"
echo "  • 컨테이너 상태: docker-compose -f docker-compose.prod.yml ps"
echo "  • 서비스 재시작: docker-compose -f docker-compose.prod.yml restart [service_name]"
echo "  • 컨테이너 중지: docker-compose -f docker-compose.prod.yml down"

print_warning "📝 배포 후 할 일:"
echo "  1. 로그 파일 모니터링"
echo "  2. 서비스 메트릭 확인"
echo "  3. SSL 인증서 설정 (필요시)"
echo "  4. 방화벽 설정 확인"
echo "  5. LDAP 연동 테스트"