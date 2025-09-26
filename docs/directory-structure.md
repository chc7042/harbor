# 프로젝트 디렉토리 구조

## 전체 구조 개요

```
harbor/
├── README.md                          # 프로젝트 메인 문서
├── package.json                       # 루트 프로젝트 설정 (워크스페이스)
├── docker-compose.yml                 # 개발 환경 컨테이너 설정
├── .env.example                       # 환경변수 템플릿
├── .gitignore                         # Git 무시 파일 목록
├── .eslintrc.js                       # ESLint 설정
├── .prettierrc                        # Prettier 설정
│
├── docs/                              # 문서 디렉토리
│   ├── architecture.md                # 시스템 아키텍처 문서
│   ├── directory-structure.md         # 디렉토리 구조 설명
│   ├── api-specification.md           # API 명세서
│   └── deployment-guide.md            # 배포 가이드
│
├── backend/                           # 백엔드 애플리케이션
│   ├── package.json                   # 백엔드 의존성 설정
│   ├── Dockerfile                     # 백엔드 도커 이미지
│   ├── .env.example                   # 백엔드 환경변수 템플릿
│   ├── src/                           # 소스 코드
│   │   ├── app.js                     # Express 서버 엔트리포인트
│   │   ├── server.js                  # 서버 시작 스크립트
│   │   ├── routes/                    # API 라우트
│   │   │   ├── index.js               # 라우트 통합
│   │   │   ├── deployments.js         # 배포 관련 API
│   │   │   └── webhooks.js            # Webhook 처리 API
│   │   ├── services/                  # 비즈니스 로직 서비스
│   │   │   ├── jenkinsWebhook.js      # Jenkins Webhook 처리
│   │   │   ├── nasScanner.js          # NAS 파일 스캔
│   │   │   ├── websocketService.js    # 실시간 통신
│   │   │   └── deploymentService.js   # 배포 정보 처리
│   │   ├── models/                    # 데이터 모델
│   │   │   ├── index.js               # Sequelize 모델 통합
│   │   │   └── deployment.js          # 배포 정보 모델
│   │   ├── config/                    # 설정 파일
│   │   │   ├── database.js            # 데이터베이스 설정
│   │   │   ├── cors.js                # CORS 설정
│   │   │   └── websocket.js           # WebSocket 설정
│   │   ├── middleware/                # Express 미들웨어
│   │   │   ├── auth.js                # 인증 미들웨어
│   │   │   ├── errorHandler.js        # 에러 처리
│   │   │   └── logger.js              # 로깅 미들웨어
│   │   └── utils/                     # 유틸리티 함수
│   │       ├── logger.js              # 로거 설정
│   │       ├── validator.js           # 데이터 검증
│   │       └── fileHelper.js          # 파일 처리 도우미
│   └── tests/                         # 백엔드 테스트
│       ├── unit/                      # 단위 테스트
│       ├── integration/               # 통합 테스트
│       └── fixtures/                  # 테스트 데이터
│
├── frontend/                          # 프론트엔드 애플리케이션
│   ├── package.json                   # 프론트엔드 의존성 설정
│   ├── Dockerfile                     # 프론트엔드 도커 이미지
│   ├── vite.config.js                 # Vite 빌드 설정
│   ├── index.html                     # HTML 엔트리포인트
│   ├── public/                        # 정적 파일
│   │   ├── favicon.ico                # 파비콘
│   │   └── manifest.json              # PWA 매니페스트
│   ├── src/                           # 소스 코드
│   │   ├── main.jsx                   # React 애플리케이션 엔트리포인트
│   │   ├── App.jsx                    # 메인 앱 컴포넌트
│   │   ├── components/                # UI 컴포넌트
│   │   │   ├── common/                # 공통 컴포넌트
│   │   │   │   ├── Header.jsx         # 헤더 컴포넌트
│   │   │   │   ├── Layout.jsx         # 레이아웃 컴포넌트
│   │   │   │   └── LoadingSpinner.jsx # 로딩 스피너
│   │   │   ├── dashboard/             # 대시보드 관련
│   │   │   │   ├── Dashboard.jsx      # 메인 대시보드
│   │   │   │   ├── StatsCard.jsx      # 통계 카드
│   │   │   │   └── ActivityChart.jsx  # 활동 차트
│   │   │   ├── deployments/           # 배포 관련
│   │   │   │   ├── DeploymentHistory.jsx # 배포 이력
│   │   │   │   ├── DeploymentCard.jsx # 배포 카드
│   │   │   │   └── DeploymentDetails.jsx # 배포 상세
│   │   │   └── search/                # 검색 관련
│   │   │       ├── SearchFilter.jsx   # 검색 필터
│   │   │       └── FilterPanel.jsx    # 필터 패널
│   │   ├── services/                  # 외부 서비스 연동
│   │   │   ├── api.js                 # REST API 클라이언트
│   │   │   └── websocket.js           # WebSocket 클라이언트
│   │   ├── hooks/                     # 커스텀 React 훅
│   │   │   ├── useApi.js              # API 호출 훅
│   │   │   ├── useWebSocket.js        # WebSocket 훅
│   │   │   └── useLocalStorage.js     # 로컬 스토리지 훅
│   │   ├── context/                   # React Context
│   │   │   └── AppContext.js          # 글로벌 상태 관리
│   │   ├── utils/                     # 유틸리티 함수
│   │   │   ├── constants.js           # 상수 정의
│   │   │   ├── formatters.js          # 데이터 포맷팅
│   │   │   └── helpers.js             # 도우미 함수
│   │   └── styles/                    # 스타일 파일
│   │       ├── index.css              # 글로벌 스타일
│   │       ├── variables.css          # CSS 변수
│   │       └── components/            # 컴포넌트별 스타일
│   └── tests/                         # 프론트엔드 테스트
│       ├── components/                # 컴포넌트 테스트
│       ├── services/                  # 서비스 테스트
│       └── __mocks__/                 # 모킹 파일
│
├── database/                          # 데이터베이스 관련
│   ├── migrations/                    # 마이그레이션 파일
│   ├── seeds/                         # 시드 데이터
│   └── init.sql                       # 초기 스키마
│
├── scripts/                           # 유틸리티 스크립트
│   ├── setup.sh                       # 초기 설정 스크립트
│   ├── build.sh                       # 빌드 스크립트
│   └── deploy.sh                      # 배포 스크립트
│
└── prompt/                            # AI 개발 관련 (기존)
    ├── ai-dev-tasks/                  # AI 개발 태스크 템플릿
    ├── rules/                         # 개발 규칙
    └── tasks/                         # 프로젝트 태스크 목록
```

## 디렉토리별 상세 설명

### 1. 루트 디렉토리
- **README.md**: 프로젝트 개요, 설치 및 실행 방법
- **package.json**: 워크스페이스 설정으로 백엔드/프론트엔드 통합 관리
- **docker-compose.yml**: PostgreSQL, 백엔드, 프론트엔드 서비스 정의

### 2. docs/ - 문서
모든 프로젝트 관련 문서를 중앙화하여 관리
- 아키텍처, API 명세, 배포 가이드 등 포함

### 3. backend/ - 백엔드 서버
Node.js + Express 기반 REST API 서버
- **src/routes/**: API 엔드포인트별로 파일 분리
- **src/services/**: 비즈니스 로직을 서비스 계층으로 분리
- **src/models/**: Sequelize ORM 모델 정의
- **src/config/**: 데이터베이스, CORS 등 설정
- **src/middleware/**: 인증, 에러 처리, 로깅 미들웨어

### 4. frontend/ - 프론트엔드 SPA
React + Vite 기반 싱글 페이지 애플리케이션
- **src/components/**: 기능별로 디렉토리 구분 (dashboard, deployments, search)
- **src/services/**: 백엔드 API 및 WebSocket 통신
- **src/hooks/**: 재사용 가능한 커스텀 훅
- **src/context/**: 전역 상태 관리

### 5. database/ - 데이터베이스
PostgreSQL 스키마 및 마이그레이션 관리
- **migrations/**: 데이터베이스 스키마 변경 이력
- **seeds/**: 개발/테스트용 초기 데이터

### 6. scripts/ - 자동화 스크립트
프로젝트 설정, 빌드, 배포를 위한 셸 스크립트

## 파일 명명 규칙

### JavaScript/React 파일
- **컴포넌트**: PascalCase (예: `Dashboard.jsx`, `DeploymentCard.jsx`)
- **서비스/유틸**: camelCase (예: `apiService.js`, `formatHelpers.js`)
- **설정 파일**: camelCase (예: `database.js`, `webpack.config.js`)

### 디렉토리
- **kebab-case 사용**: 소문자와 하이픈 (예: `deployment-history`, `search-filter`)
- **기능별 그룹핑**: 관련 기능끼리 하위 디렉토리로 구성

### 테스트 파일
- **같은 디렉토리 배치**: `Component.jsx` → `Component.test.jsx`
- **__tests__/ 디렉토리**: 복잡한 테스트 구조가 필요한 경우

## 확장 고려사항

1. **모노레포 구조**: Lerna 또는 Nx 도입 시 확장 가능
2. **마이크로서비스**: 서비스별 독립적인 디렉토리 구조로 분리 가능
3. **다국어 지원**: `frontend/src/locales/` 디렉토리 추가
4. **테마 지원**: `frontend/src/themes/` 디렉토리 추가