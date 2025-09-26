# Jenkins NAS 배포 이력 관리 시스템 아키텍처

## 시스템 개요

Jenkins를 통해 빌드된 아티팩트가 NAS에 배포될 때, 배포 이력을 실시간으로 수집하고 웹 인터페이스를 통해 모니터링할 수 있는 시스템입니다.

## 전체 시스템 아키텍처

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     Jenkins     │    │   NAS Storage   │    │   LDAP Server   │    │   Web Browser   │
│                 │    │                 │    │                 │    │                 │
│  - Build Jobs   │    │  - Artifacts    │    │  - User Auth    │    │  - Login Page   │
│  - Webhooks     │    │  - File System  │    │  - User Info    │    │  - Dashboard    │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘    │  - Search UI    │
          │                      │                      │             └─────────┬───────┘
          │ Webhook              │ File Scan            │ Auth                  │
          │ (POST)               │ (Periodic)           │ (LDAP)                │ HTTP/WS + Auth
          ▼                      ▼                      ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Harbor Application                           │
│  ┌───────────────────────┐    ┌───────────────────────────────┐ │
│  │      Backend API      │    │        Frontend SPA           │ │
│  │                       │    │                               │ │
│  │  - Express Server     │    │  - React Components          │ │
│  │  - REST APIs          │◄──►│  - Real-time Updates         │ │
│  │  - WebSocket Server   │    │  - Charts & Visualizations   │ │
│  │  - LDAP Authentication│    │  - Search & Filtering        │ │
│  │  - JWT Token Manager  │    │  - Login/Auth Components     │ │
│  │  - Jenkins Webhook    │    │  - Protected Routes          │ │
│  │  - NAS File Scanner   │    │                               │ │
│  └───────────┬───────────┘    └───────────────────────────────┘ │
│              │                                                  │
│              ▼                                                  │
│  ┌───────────────────────┐                                     │
│  │     PostgreSQL        │                                     │
│  │                       │                                     │
│  │  - Deployments Table  │                                     │
│  │  - Users Table        │                                     │
│  │  - Sessions Table     │                                     │
│  │  - Indexes & Views    │                                     │
│  │  - Data Persistence   │                                     │
│  └───────────────────────┘                                     │
└─────────────────────────────────────────────────────────────────┘
```

## 핵심 컴포넌트

### 1. Backend API Server (Node.js + Express)

**역할**:
- REST API 제공
- 데이터 수집 및 저장
- 실시간 통신 관리

**주요 모듈**:
```
backend/
├── src/
│   ├── app.js                 # Express 서버 엔트리포인트
│   ├── routes/                # API 라우트
│   │   └── deployments.js     # 배포 관련 API
│   ├── services/              # 비즈니스 로직
│   │   ├── jenkinsWebhook.js  # Jenkins 연동
│   │   ├── nasScanner.js      # NAS 스캔
│   │   ├── ldapService.js     # LDAP 인증
│   │   └── websocketService.js# 실시간 통신
│   ├── models/                # 데이터 모델
│   │   ├── deployment.js      # 배포 정보 모델
│   │   └── user.js            # 사용자 정보 모델
│   ├── config/                # 설정
│   │   ├── database.js        # DB 연결 설정
│   │   └── ldap.js            # LDAP 서버 설정
│   ├── middleware/            # 미들웨어
│   │   ├── cors.js            # CORS 설정
│   │   └── auth.js            # JWT 인증 미들웨어
│   └── routes/                # API 라우트 추가
│       └── auth.js            # 인증 관련 API
├── tests/                     # 테스트 코드
└── package.json
```

### 2. Frontend SPA (React)

**역할**:
- 사용자 인터페이스 제공
- 실시간 데이터 표시
- 검색 및 필터링 기능

**주요 컴포넌트**:
```
frontend/
├── src/
│   ├── App.jsx                # 메인 앱 컴포넌트
│   ├── components/            # UI 컴포넌트
│   │   ├── auth/              # 인증 관련 컴포넌트
│   │   │   ├── Login.jsx      # 로그인 페이지
│   │   │   ├── ProtectedRoute.jsx # 보호된 라우트
│   │   │   └── Header.jsx     # 사용자 정보 헤더
│   │   ├── Dashboard.jsx      # 대시보드
│   │   ├── DeploymentHistory.jsx # 배포 이력 목록
│   │   └── SearchFilter.jsx   # 검색 필터
│   ├── services/              # 외부 서비스 연동
│   │   ├── api.js             # REST API 호출
│   │   ├── auth.js            # 인증 API 호출
│   │   └── websocket.js       # WebSocket 클라이언트
│   ├── hooks/                 # 커스텀 React 훅
│   │   ├── useAuth.js         # 인증 상태 관리 훅
│   ├── utils/                 # 유틸리티 함수
│   └── styles/                # CSS/SCSS 파일
├── public/                    # 정적 파일
├── tests/                     # 테스트 코드
└── package.json
```

### 3. PostgreSQL 데이터베이스

**역할**:
- 배포 정보 영구 저장
- 검색 및 필터링 지원
- 데이터 무결성 보장

**스키마 구조**:
```sql
-- 배포 정보 테이블
CREATE TABLE deployments (
    id SERIAL PRIMARY KEY,
    project_name VARCHAR(100) NOT NULL,
    build_number INTEGER NOT NULL,
    artifact_name VARCHAR(255),
    nas_path VARCHAR(500),
    file_size BIGINT,
    file_hash VARCHAR(64),
    status VARCHAR(20) NOT NULL, -- success, failed, in_progress
    deployed_by VARCHAR(50),
    commit_hash VARCHAR(40),
    commit_message TEXT,
    jenkins_job_url VARCHAR(500),
    deployed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 사용자 정보 테이블 (LDAP 연동)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(200),
    email VARCHAR(200),
    department VARCHAR(100),
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 사용자 세션 테이블
CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(500) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_deployments_project_time ON deployments(project_name, deployed_at DESC);
CREATE INDEX idx_deployments_status ON deployments(status);
CREATE INDEX idx_deployments_build_number ON deployments(build_number);
CREATE UNIQUE INDEX idx_deployments_unique ON deployments(project_name, build_number, artifact_name);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);
```

## 데이터 흐름

### 1. 사용자 인증 흐름
```
User Login Request
    ↓ Username/Password
Backend LDAP Authentication (/api/auth/login)
    ↓ LDAP Bind & Verify
LDAP Server Authentication
    ↓ User Info Response
JWT Token Generation & User DB Update
    ↓ JWT Token
Frontend Token Storage & Redirect
```

### 2. Jenkins Webhook 흐름
```
Jenkins Build Complete
    ↓ HTTP POST (with auth)
Backend Webhook Endpoint (/api/webhooks/jenkins)
    ↓ Parse & Validate & Auth Check
Database Insert/Update
    ↓ WebSocket Broadcast (to authenticated users)
Frontend Real-time Update
```

### 3. NAS 스캔 흐름
```
Cron Scheduler (5분마다)
    ↓ File System Scan
NAS Directory Reading
    ↓ File Info Collection
Database Sync (신규/변경 파일)
    ↓ WebSocket Broadcast (to authenticated users)
Frontend Real-time Update
```

### 4. 사용자 조회 흐름
```
Frontend Search Request (with JWT token)
    ↓ HTTP GET + Authorization Header
Backend API (/api/deployments)
    ↓ JWT Token Validation & Database Query
PostgreSQL Query Execution
    ↓ JSON Response
Frontend Data Display
```

## 기술 스택

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js 4.x
- **Authentication**: JWT (jsonwebtoken), LDAP (ldapjs)
- **Database**: PostgreSQL 14+
- **ORM**: Sequelize 6.x
- **Real-time**: Socket.IO 4.x
- **File System**: fs-extra, chokidar
- **Scheduling**: node-cron
- **Security**: helmet, cors, bcrypt
- **Testing**: Jest, Supertest

### Frontend
- **Framework**: React 18.x
- **Build Tool**: Vite 4.x
- **Routing**: React Router 6.x
- **State Management**: Context API + useReducer
- **Authentication**: JWT token management, Protected Routes
- **HTTP Client**: Axios (with interceptors)
- **Real-time**: Socket.IO Client
- **UI Framework**: Tailwind CSS 3.x (뉴욕 스타일 구현)
- **UI Components**: Headless UI + 커스텀 컴포넌트
- **Icons**: Heroicons (미니멀한 아이콘)
- **Charts**: Chart.js 4.x (뉴욕 스타일 커스터마이징)
- **Fonts**: Inter, SF Pro Display
- **Testing**: Jest, React Testing Library

### DevOps
- **Container**: Docker + Docker Compose
- **Database**: PostgreSQL Official Image
- **Reverse Proxy**: Nginx (프로덕션)
- **Process Manager**: PM2 (프로덕션)

## 보안 고려사항

1. **인증 및 인가 보안**
   - LDAP을 통한 중앙화된 사용자 인증
   - JWT 토큰 기반 세션 관리 (만료 시간 설정)
   - 모든 API 엔드포인트에 인증 미들웨어 적용
   - HTTPS 강제 사용 (프로덕션 환경)

2. **API 보안**
   - CORS 설정으로 허용된 도메인만 접근
   - Rate limiting으로 API 남용 방지
   - Jenkins Webhook 검증 (토큰 기반)
   - Helmet.js로 HTTP 헤더 보안 강화

3. **파일 시스템 보안**
   - NAS 접근 권한 최소화 (읽기 전용)
   - 파일 경로 검증 (Path Traversal 방지)
   - 파일 다운로드 시 권한 검증

4. **데이터 보안**
   - 민감한 정보 마스킹 (파일 경로 일부 숨김)
   - SQL Injection 방지 (ORM 사용)
   - 사용자 세션 정보 암호화 저장
   - 로그에서 민감 정보 제외

## 성능 최적화

1. **데이터베이스**
   - 적절한 인덱스 설정
   - 페이지네이션으로 대량 데이터 처리
   - 연결 풀링으로 DB 연결 최적화

2. **캐싱**
   - Redis를 통한 자주 조회되는 데이터 캐싱
   - 브라우저 캐싱 활용 (정적 리소스)

3. **실시간 통신**
   - WebSocket 연결 수 모니터링
   - 불필요한 브로드캐스트 최소화

## 모니터링 & 로깅

1. **애플리케이션 로깅**
   - Winston을 통한 구조화된 로깅
   - 로그 레벨별 관리 (error, warn, info, debug)

2. **시스템 모니터링**
   - CPU, 메모리 사용량 추적
   - API 응답 시간 모니터링
   - 데이터베이스 쿼리 성능 추적

3. **알림 시스템**
   - 시스템 장애 시 알림
   - 배포 실패 시 알림 (향후 구현)

## 확장 계획

1. **단계별 확장**
   - Phase 1: 기본 기능 (현재 PRD 범위)
   - Phase 2: 사용자 인증 및 권한 관리
   - Phase 3: 외부 알림 연동 (Slack, Email)
   - Phase 4: 다중 CI/CD 도구 지원

2. **성능 확장**
   - 마이크로서비스 아키텍처 전환
   - 데이터베이스 샤딩
   - CDN 활용