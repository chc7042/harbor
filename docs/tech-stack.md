# Jenkins NAS 배포 이력 관리 - 기술 스택 정의

## 백엔드 기술 스택

### 런타임 & 프레임워크
- **Node.js**: v18+ (LTS 버전)
  - 이유: 빠른 개발, 풍부한 생태계, Jenkins Webhook 처리에 적합
- **Express.js**: v4.18+
  - 이유: 경량화된 웹 프레임워크, REST API 구축에 최적화

### 데이터베이스
- **PostgreSQL**: v14+
  - 이유: 트랜잭션 지원, 복잡한 쿼리 지원, 대용량 데이터 처리
  - 용도: 배포 이력, 사용자 세션 저장

### 인증 시스템
- **LDAP**: Active Directory 연동
  - 라이브러리: `ldapjs` v2.3+
  - JWT 토큰: `jsonwebtoken` v9+
  - 세션 관리: `express-session` v1.17+

### 실시간 통신
- **WebSocket**: `ws` v8.13+ 또는 `socket.io` v4.7+
  - 이유: 실시간 배포 상태 업데이트

### 파일 시스템 모니터링
- **Chokidar**: v3.5+ (파일 변경 감지)
- **node-cron**: v3.0+ (주기적 스캔)

### 추가 백엔드 라이브러리
- **cors**: v2.8+ (CORS 처리)
- **helmet**: v7+ (보안 헤더)
- **dotenv**: v16+ (환경변수 관리)
- **winston**: v3+ (로깅)
- **joi**: v17+ (데이터 유효성 검증)
- **bcrypt**: v5+ (패스워드 해싱, 필요시)

## 프론트엔드 기술 스택

### 프레임워크 & 라이브러리
- **React**: v18+
  - 이유: 컴포넌트 기반 개발, 풍부한 생태계
- **React Router**: v6+ (클라이언트 사이드 라우팅)
- **React Context API**: 전역 상태 관리 (인증, 테마)

### 스타일링
- **Tailwind CSS**: v3.3+
  - 이유: 뉴욕 스타일 미니멀 디자인에 최적화
  - 커스텀 설정: 뉴욕 스타일 색상 팔레트, 폰트 설정
- **HeadlessUI**: v1.7+ (Tailwind와 호환되는 컴포넌트)

### 차트 & 시각화
- **Chart.js**: v4+ + **react-chartjs-2**: v5+
  - 이유: 배포 성공률 차트, 타임라인 시각화
  - 뉴욕 스타일에 맞는 미니멀한 차트 커스터마이징

### HTTP 클라이언트
- **Axios**: v1.5+ (API 호출, 인터셉터 지원)

### 추가 프론트엔드 라이브러리
- **date-fns**: v2.30+ (날짜 처리)
- **react-hot-toast**: v2.4+ (뉴욕 스타일 알림)
- **clsx**: v2+ (조건부 클래스명 관리)

## 개발 환경 & 도구

### 개발 도구
- **ESLint**: v8+ (코드 품질)
- **Prettier**: v3+ (코드 포매팅)
- **Husky**: v8+ (Git hooks)
- **lint-staged**: v13+ (커밋 시 린트 실행)

### 번들러 & 빌드 도구
- **Vite**: v4+ (프론트엔드 빌드 도구)
  - 이유: 빠른 개발 서버, React 지원 우수
- **Nodemon**: v3+ (백엔드 개발 서버)

### 컨테이너화
- **Docker**: v20.10+
- **Docker Compose**: v2.0+ (개발 환경 구성)

### 테스트 프레임워크
- **Jest**: v29+ (유닛 테스트)
- **React Testing Library**: v13+ (프론트엔드 테스트)
- **Supertest**: v6+ (API 테스트)

## 인프라 & 배포

### 환경 설정
- **환경변수 관리**: `.env` 파일, Docker secrets
- **설정 검증**: `joi` 라이브러리로 환경변수 유효성 검사

### 모니터링 & 로깅
- **Winston**: 구조화된 로그 (JSON 형태)
- **Morgan**: HTTP 요청 로깅
- **PM2**: 프로덕션 프로세스 관리 (옵션)

## 보안 고려사항

### 인증 보안
- JWT 토큰 만료 시간 설정 (1시간)
- Refresh 토큰 메커니즘 (8시간)
- LDAP 연결 TLS 암호화

### API 보안
- Rate Limiting: `express-rate-limit`
- Request 크기 제한: Express body-parser 설정
- SQL Injection 방지: 파라미터화된 쿼리 사용

## 성능 최적화

### 백엔드
- 데이터베이스 인덱스 최적화
- 연결 풀 설정 (PostgreSQL)
- 캐싱: `node-cache` (메모리 캐시)

### 프론트엔드
- React.memo, useMemo, useCallback 활용
- 코드 스플리팅: React.lazy
- 이미지 최적화 및 압축

## 버전 호환성

### Node.js 버전
- 최소: Node.js v16
- 권장: Node.js v18 LTS
- 테스트: Node.js v20

### 브라우저 지원
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## 개발 환경 포트 설정

```
Backend API: http://localhost:3001
Frontend Dev: http://localhost:5173
PostgreSQL: localhost:5432
WebSocket: ws://localhost:3001
```

## 라이선스 고려사항

모든 선택된 라이브러리는 상업적 사용이 가능한 라이선스를 가지고 있습니다:
- MIT License: React, Express, Tailwind CSS 등
- BSD License: PostgreSQL
- Apache 2.0: Chart.js

이 기술 스택은 PRD의 요구사항을 충족하며, 뉴욕 스타일 디자인 구현과 LDAP 인증 시스템을 완벽하게 지원합니다.