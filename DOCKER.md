# Harbor Docker 통합 가이드

## 📋 개요

Harbor 프로젝트는 단일 통합 Dockerfile을 사용하여 프론트엔드와 백엔드를 관리합니다. 멀티 스테이지 빌드를 활용하여 개발환경과 프로덕션환경을 효율적으로 지원합니다.

## 🏗️ 통합 Dockerfile 구조

### Build Targets (빌드 타겟)

#### Frontend Targets
- `frontend-development`: 개발용 프론트엔드 (Vite dev server)
- `frontend-build`: 프론트엔드 빌드 스테이지
- `frontend-production`: 프로덕션용 프론트엔드 (정적 파일 서빙)

#### Backend Targets
- `backend-development`: 개발용 백엔드 (nodemon)
- `backend-base`: 백엔드 프로덕션 베이스
- `backend-production`: 프로덕션용 백엔드

#### Full Stack Target
- `fullstack-development`: 풀스택 개발환경 (선택사항)

## 🚀 사용법

### 1. 개별 이미지 빌드

#### 백엔드 빌드
```bash
# 개발용
docker build -f Dockerfile --target backend-development -t harbor-backend-dev .

# 프로덕션용
docker build -f Dockerfile --target backend-production -t harbor-backend-prod .
```

#### 프론트엔드 빌드
```bash
# 개발용
docker build -f Dockerfile --target frontend-development -t harbor-frontend-dev .

# 프로덕션용
docker build -f Dockerfile --target frontend-production -t harbor-frontend-prod .
```

### 2. Docker Compose로 전체 시스템 구동

#### 프로덕션 환경
```bash
docker compose -f docker-compose.prod.yml up -d
```

#### 개발 환경
```bash
docker compose -f docker-compose.dev.yml up -d
```

## 📁 파일 구조

```
harbor/
├── Dockerfile                    # 통합 멀티스테이지 Dockerfile
├── docker-compose.prod.yml       # 프로덕션 Docker Compose
├── docker-compose.dev.yml        # 개발 Docker Compose
├── Dockerfile.backend.old        # 기존 백엔드 Dockerfile (백업)
├── Dockerfile.frontend.old       # 기존 프론트엔드 Dockerfile (백업)
└── DOCKER.md                     # 이 문서
```

## 🔧 환경 변수

### 프로덕션 환경 (.env.prod)
```bash
# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=harbor_prod
DB_USER=harbor_user
DB_PASSWORD=your_secure_password

# JWT
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret

# LDAP
LDAP_URL=ldap://your.ldap.server:389
LDAP_BIND_DN=cn=admin,dc=example,dc=com
LDAP_BIND_CREDENTIALS=your_ldap_password

# Frontend URLs
VITE_API_URL=/api
```

### 개발 환경 (.env.dev)
```bash
# Database
DB_NAME=harbor_dev
DB_USER=harbor_user
DB_PASSWORD=harbor_dev_password

# JWT
JWT_SECRET=dev-jwt-secret
JWT_REFRESH_SECRET=dev-refresh-secret

# Frontend URLs
VITE_API_URL=http://localhost:3001/api
```

## 🐳 컨테이너 정보

### 포트 매핑
- **Backend**: 3001 (프로덕션/개발)
- **Frontend**: 8080 (프로덕션), 5173 (개발)
- **PostgreSQL**: 5432

### 헬스체크
- **Backend**: `GET /api/health`
- **Frontend**: `GET /`
- **Database**: `pg_isready`

## 🔍 트러블슈팅

### 1. 빌드 실패 시
```bash
# 캐시 클리어 후 재빌드
docker system prune -f
docker build --no-cache -f Dockerfile --target backend-production -t harbor-backend .
```

### 2. 의존성 업데이트 시
```bash
# 기존 이미지 제거 후 재빌드
docker rmi harbor-backend harbor-frontend
docker compose -f docker-compose.prod.yml build --no-cache
```

### 3. 로그 확인
```bash
# 전체 서비스 로그
docker compose -f docker-compose.prod.yml logs -f

# 특정 서비스 로그
docker logs harbor-backend-prod --tail 50
docker logs harbor-frontend-prod --tail 50
```

## 📊 성능 최적화

### 멀티스테이지 빌드 장점
1. **이미지 크기 최적화**: 프로덕션에 불필요한 빌드 도구 제외
2. **캐시 효율성**: package.json 변경 시에만 의존성 재설치
3. **보안 강화**: non-root 사용자로 실행
4. **유지보수성**: 단일 파일로 모든 빌드 타겟 관리

### 빌드 캐시 활용
- Docker는 각 스테이지를 개별적으로 캐시
- package.json 변경 시에만 npm install 재실행
- 소스 코드 변경 시 빠른 리빌드 가능

## 🚨 주의사항

1. **환경변수**: 프로덕션 환경에서는 반드시 실제 값으로 설정
2. **볼륨 마운트**: 개발환경에서만 소스 코드 볼륨 마운트 사용
3. **포트 충돌**: 로컬 개발 시 포트 충돌 주의
4. **보안**: 프로덕션에서는 반드시 non-root 사용자로 실행

## 📈 업그레이드 이점

### 기존 방식 대비 개선사항
- ✅ **통합 관리**: 하나의 Dockerfile로 프론트엔드/백엔드 관리
- ✅ **중복 제거**: 공통 베이스 이미지 활용으로 빌드 시간 단축
- ✅ **일관성**: 동일한 Node.js 버전과 Alpine 베이스 사용
- ✅ **유지보수성**: 버전 업데이트와 설정 변경 용이성
- ✅ **캐시 최적화**: 더 효율적인 Docker 레이어 캐싱