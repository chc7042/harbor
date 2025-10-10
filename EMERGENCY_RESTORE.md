# 긴급 복구 계획 - 현재 SMB2 시스템으로 복원

## 개요
시놀로지 API 롤백 진행 중 문제 발생 시 현재 작동하는 SMB2/CIFS 시스템으로 즉시 복원하는 방법

## 현재 상태 백업 정보
- **백업 커밋**: `987438b` - "backup: current SMB2/CIFS system before Synology API rollback"
- **백업 시점**: 2025-10-07 (시놀로지 롤백 직전)
- **시스템 상태**: SMB2 기반, CIFS 마운트, 배포 모달 정상 작동

## 🚨 긴급 복원 명령어 (1분 내 실행)

### 1단계: Git 강제 복원 (30초)
```bash
# 현재 작업 중단하고 즉시 백업 커밋으로 복원
git reset --hard 987438b
git clean -fd

# 현재 상태 확인
git log --oneline -1
```

### 2단계: Docker 재시작 (30초)
```bash
# 기존 컨테이너 중지 및 재시작
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d --build
```

## 📋 복원 후 확인사항

### 시스템 상태 체크
```bash
# 컨테이너 상태 확인
docker ps

# 백엔드 로그 확인 (NAS 연결 확인)
docker logs harbor-backend-prod --tail 20

# 프론트엔드 접근 확인
curl -s http://localhost:8080 | head -1
```

### 기능 테스트
1. **웹 접속**: http://harbor.roboetech.com
2. **로그인**: admin/admin
3. **배포 모달**: 3.0.0/mr3.0.0_release/26 "배포 버전" 탭 확인
4. **다운로드**: 파일 다운로드 테스트

## 🔧 복원 실패 시 추가 조치

### package.json 의존성 복원
```bash
cd backend
npm install @marsaud/smb2@^0.18.0
npm install
```

### 환경변수 복원
```bash
# .env 파일 확인 및 복원
cat > .env << 'EOF'
NAS_USERNAME=roboe
NAS_PASSWORD=roboe^^210901
NAS_HOST_PATH=//nas.roboetech.com/release_version
BACKEND_PORT=3001
EOF
```

### Docker 설정 복원
docker-compose.prod.yml의 CIFS 마운트 설정 확인:
```yaml
nas_data:
  driver: local
  driver_opts:
    type: cifs
    o: "username=${NAS_USERNAME},password=${NAS_PASSWORD},uid=1000,gid=1000,file_mode=0644,dir_mode=0755,vers=3.0"
    device: "//${NAS_HOST}/${NAS_SHARE}"
```

## ⚡ 초고속 복원 (15초)
```bash
# 한 번에 실행하는 복원 명령어
git reset --hard 987438b && \
docker-compose -f docker-compose.prod.yml down && \
docker-compose -f docker-compose.prod.yml up -d --build && \
echo "✅ 긴급 복원 완료!"
```

## 📞 복원 상태 확인 스크립트
```bash
#!/bin/bash
echo "=== 시스템 복원 상태 확인 ==="
echo "1. Git 커밋: $(git log --oneline -1)"
echo "2. Docker 컨테이너:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep harbor
echo "3. 백엔드 응답:"
curl -s http://localhost:3001/api/health | head -20
echo "4. 프론트엔드 응답:"
curl -s http://localhost:8080 | head -1
echo "=== 확인 완료 ==="
```

## 🛡️ 안전장치
- 현재 시스템은 이미 검증된 상태입니다
- 배포 모달, 다운로드, NAS 접근 모두 정상 작동 확인됨
- 백업 커밋 `987438b`는 완전한 작동 상태를 보장합니다

## 주의사항
- **절대 추가 수정하지 말고** 백업 커밋으로만 복원하세요
- 복원 후 즉시 기능 테스트를 진행하세요
- 복원이 성공하면 시놀로지 롤백을 중단하세요