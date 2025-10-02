# Harbor 프로덕션 배포 가이드

## 개요
Harbor는 Jenkins NAS 배포 이력 관리 시스템으로, React 프론트엔드와 Node.js 백엔드로 구성되어 있습니다.

## 배포 요구사항

### 시스템 요구사항
- Docker & Docker Compose
- Linux/WSL 환경
- 포트 8080 사용 가능

### 네트워크 설정
- LDAP 서버 (172.30.1.97:389) 접근 가능
- Harbor 서버 도메인: harbor.roboetech.com

## 배포 단계

### 1. 프로젝트 클론
```bash
git clone <repository-url>
cd harbor
```

### 2. 환경 설정 확인
`.env.prod` 파일의 LDAP 설정이 올바른지 확인:

```bash
# LDAP Configuration - 실제 작동 확인된 설정
LDAP_URL=ldap://172.30.1.97:389
LDAP_BIND_DN=cn=admin,dc=roboetech,dc=com
LDAP_BIND_CREDENTIALS=admin
LDAP_SEARCH_BASE=ou=users,dc=roboetech,dc=com
LDAP_SEARCH_FILTER=(|(uid={{username}})(cn={{username}}))
LDAP_TIMEOUT=60000
LDAP_CONNECT_TIMEOUT=30000
LDAP_RECONNECT=true
LDAP_IDLE_TIMEOUT=1000
```

### 3. 자동 배포 실행
```bash
./deploy-prod.sh
```

### 4. 수동 배포 (필요시)
```bash
# 환경변수 설정
cp .env.prod .env

# 서비스 빌드 및 시작
docker compose -f docker-compose.prod.yml up --build -d

# 상태 확인
docker compose -f docker-compose.prod.yml ps
```

## 서비스 확인

### 헬스체크
```bash
curl http://harbor.roboetech.com:8080/health
```

### 인증 테스트
```bash
curl -X POST http://harbor.roboetech.com:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"nicolas.choi","password":"jetset77!!"}'
```

## 트러블슈팅

### LDAP 연결 오류
1. LDAP 서버(172.30.1.97:389) 연결 확인:
   ```bash
   telnet 172.30.1.97 389
   ```

2. 컨테이너에서 LDAP 연결 테스트:
   ```bash
   docker exec harbor-backend-prod ldapsearch -H ldap://172.30.1.97:389 -D "cn=admin,dc=roboetech,dc=com" -w admin -b "ou=users,dc=roboetech,dc=com" "(uid=nicolas.choi)"
   ```

### 서비스 로그 확인
```bash
# 전체 로그
docker compose -f docker-compose.prod.yml logs

# 백엔드 로그만
docker compose -f docker-compose.prod.yml logs backend

# 실시간 로그 확인
docker compose -f docker-compose.prod.yml logs -f backend
```

### 환경 변수 확인
```bash
# 컨테이너 내부 환경변수 확인
docker exec harbor-backend-prod env | grep LDAP
```

## 서비스 관리

### 서비스 중지
```bash
docker compose -f docker-compose.prod.yml down
```

### 서비스 재시작
```bash
docker compose -f docker-compose.prod.yml restart
```

### 데이터 초기화 (주의!)
```bash
docker compose -f docker-compose.prod.yml down -v
```

## 접속 정보

- **애플리케이션 URL**: http://harbor.roboetech.com:8080
- **테스트 계정**: nicolas.choi / jetset77!!
- **LDAP 서버**: 172.30.1.97:389

## 설정 파일

### 주요 설정 파일들
- `.env.prod` - 프로덕션 환경 변수
- `docker-compose.prod.yml` - Docker Compose 설정
- `nginx/nginx.conf` - Nginx 리버스 프록시 설정

### 환경별 특이사항
- Rate Limiting이 비활성화되어 있음 (`DISABLE_RATE_LIMITING=true`)
- Trust Proxy 설정이 활성화되어 있음 (리버스 프록시 환경)
- CORS가 harbor.roboetech.com:8080 도메인으로 설정됨

## 보안 고려사항

### 프로덕션 환경에서 변경 필요한 항목들
1. JWT 시크릿 키 변경
2. 데이터베이스 비밀번호 변경
3. Redis 비밀번호 변경
4. LDAP 비밀번호 검토

### 권장 설정
- HTTPS 설정 (현재는 HTTP)
- 방화벽 설정
- 로그 모니터링 설정