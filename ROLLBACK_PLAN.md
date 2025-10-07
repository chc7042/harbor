# Harbor 시놀로지 API 복구 계획 (PRD)

## 개요
Harbor 시스템을 SMB2/smbclient에서 원래의 Synology API 방식으로 복구하는 작업 계획입니다.

## 문제 상황
- 현재 시스템은 SMB2 (@marsaud/smb2) 라이브러리를 사용하여 NAS 접근
- 이로 인해 NAS 스캔 실패, 다운로드 오류 등 다수의 문제 발생
- 원래는 Synology API를 통한 안정적인 NAS 연동이 구현되어 있었음

## 롤백 대상 식별

### 기준 커밋
- **복구 대상**: `c3accb2` (2025-09-30 22:10) - "fix: resolve Synology API file metadata issue"
- **문제 시작**: `a5004fc` (2025-09-29 01:14) - "update" (SMB2 도입)

### 영향받은 파일들
```
backend/package.json                              # @marsaud/smb2 의존성 제거 필요
backend/src/services/nasService.js                # 완전히 새로 작성된 SMB2 기반 파일
backend/src/routes/files.js                       # SMB2 기반으로 수정됨
backend/src/routes/nas.js                         # 새로 추가된 파일
docker-compose.prod.yml                          # CIFS 마운트로 변경됨
.env                                              # NAS 설정 변경됨
```

## 복구 계획

### 1단계: 의존성 복구
```bash
# SMB2 의존성 제거
cd backend
npm uninstall @marsaud/smb2

# package.json에서 @marsaud/smb2 제거 확인
```

### 2단계: 핵심 서비스 파일 복구
```bash
# nasService.js를 c3accb2 시점으로 복구
git show c3accb2:backend/src/services/nasService.js > backend/src/services/nasService.js

# Synology API 서비스 파일 복구 (c3accb2 시점의 것)
git show c3accb2:backend/src/services/synologyApiService.js > backend/src/services/synologyApiService.js
```

### 3단계: 라우트 파일 복구
```bash
# files.js를 c3accb2 시점으로 복구
git show c3accb2:backend/src/routes/files.js > backend/src/routes/files.js

# SMB2 전용으로 추가된 nas.js 라우트 제거
rm backend/src/routes/nas.js
```

### 4단계: Docker 설정 복구
```bash
# docker-compose.prod.yml의 CIFS 마운트를 바인드 마운트로 변경
# nas_data 볼륨 설정을 원래대로 복구

# .env 파일의 NAS 설정을 Synology API용으로 변경
```

### 5단계: 환경 변수 설정
```bash
# .env 파일에서 Synology API 관련 설정 복구
SYNOLOGY_BASE_URL=http://nas.roboetech.com:5000
SYNOLOGY_USERNAME=admin
SYNOLOGY_PASSWORD=admin_password
NAS_HOST_PATH=\\nas.roboetech.com\release_version
```

## 복구 후 테스트 계획

### 1. NAS 연결 테스트
- Synology API 인증 테스트
- 파일 목록 조회 테스트
- 파일 다운로드 테스트

### 2. 웹 인터페이스 테스트
- 3.0.0/mr3.0.0_release/26 배포 "배포 버전" 탭 테스트
- 파일 목록 표시 확인
- 다운로드 기능 확인

### 3. 시스템 안정성 테스트
- NAS 스캔 서비스 정상 동작 확인
- 에러 로그 모니터링
- 성능 확인

## 예상 소요 시간
- 복구 작업: 1-2시간
- 테스트 및 검증: 1시간
- 총 예상 시간: 3시간

## 롤백 위험도
- **낮음**: 원래 작동하던 방식으로 되돌리는 것이므로 안전
- 이미 Synology API 서비스 파일이 존재하므로 빠른 복구 가능

## 실행 커맨드 요약
```bash
# 1. 현재 상태 백업
git add -A && git commit -m "backup: before synology api rollback"

# 2. 의존성 복구
cd backend && npm uninstall @marsaud/smb2

# 3. 파일 복구
git show c3accb2:backend/src/services/nasService.js > backend/src/services/nasService.js
git show c3accb2:backend/src/services/synologyApiService.js > backend/src/services/synologyApiService.js
git show c3accb2:backend/src/routes/files.js > backend/src/routes/files.js
rm backend/src/routes/nas.js

# 4. Docker 및 환경설정 복구
# (수동으로 docker-compose.prod.yml과 .env 수정)

# 5. 시스템 재시작
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d --build

# 6. 테스트 실행
```

## 승인 및 실행 준비
이 계획이 승인되면 즉시 실행 가능한 상태입니다.