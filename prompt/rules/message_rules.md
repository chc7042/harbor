# Git 커밋 메시지 및 워크플로우 규칙

## 목적

이 문서는 ADAM 시스템 개발 시 모든 개발자가 준수해야 하는 Git 커밋 메시지 작성 및 개발 워크플로우 규칙을 정의합니다.

## 🚨 최우선 필수 규칙 (CRITICAL)

### 1️⃣ 빌드 검증 필수
```bash
npm run build  # 또는 pnpm build
# ⚠️ 빌드 실패 시 절대 다음 단계로 진행 금지
```

### 2️⃣ 커밋 메시지 포맷 준수
```bash
[TYPE] 한글 제목

[수정내용]
 - 수정사항 1 (빈 줄 없이 연속 작성)
 - 수정사항 2
 - 수정사항 3

[JIRA] N/A
```

### 3️⃣ Pre-commit 실행 필수 (절대 빼먹지 말 것!)
```bash
# 수정된 파일만 검증 (필수 방법)
pre-commit run --files $(git diff --name-only HEAD~1)

# 또는 특정 파일들 지정
pre-commit run --files src/path/to/file1.ts src/path/to/file2.ts

# ⚠️ pre-commit으로 파일이 수정된 경우 반드시 amend
git add .
git commit --amend --no-edit
```

**⚠️ 이 3가지 규칙은 절대 예외 없이 준수해야 합니다.**

## 개발 워크플로우 (MANDATORY PROCESS)

**완전한 개발 프로세스 순서:**

```bash
# 1단계: 코드 수정
# (개발 작업 수행)

# 2단계: 빌드 검증 (필수)
npm run build
# 또는
pnpm build
# ⚠️ 빌드 실패 시 절대 다음 단계로 진행 금지

# 3단계: pre-commit 실행 (필수) - 절대 빼먹지 말 것!
# 수정된 파일에 대해서만 실행 (필수):
pre-commit run --files $(git diff --name-only HEAD~1)
# 또는 특정 파일들 지정:
pre-commit run --files src/path/to/file1.ts src/path/to/file2.ts

# 4단계: 변경사항 스테이징
git add .

# 5단계: 포맷 준수 커밋 (필수) - HEREDOC 방식 사용
git commit -m "$(cat <<'EOF'
[TYPE] 한글 제목

[수정내용]
 - 수정사항 1
 - 수정사항 2
 - 수정사항 3

[JIRA] N/A
EOF
)"
```

## Pre-commit 실행 상세 가이드

### Pre-commit 실행 방법들

```bash
# ✅ 수정된 파일에 대해서만 pre-commit 실행 (필수)
# 방법 1: git diff로 수정된 파일 자동 확인 후 실행 (권장)
pre-commit run --files $(git diff --name-only HEAD~1)

# 방법 2: 특정 수정된 파일들 직접 지정
pre-commit run --files src/path/to/modified/file.ts

# 방법 3: 수정된 파일 목록 먼저 확인 후 실행
git diff --name-only HEAD~1  # 수정된 파일 목록 확인
pre-commit run --files $(git diff --name-only HEAD~1)

# 방법 4: 자동 실행 (Git hook 설정된 경우)
git commit  # pre-commit이 자동 실행됨

# ⚠️ 중요: pre-commit으로 파일이 수정된 경우 반드시 amend
git add .
git commit --amend --no-edit
```

### Pre-commit 실행을 잊지 않기 위한 체크리스트

- [ ] 코드 수정 완료
- [ ] 빌드 성공 확인 (`npm run build` 또는 `pnpm build`)
- [ ] **pre-commit 실행** (`pre-commit run --files $(git diff --name-only HEAD~1)`)
- [ ] pre-commit 결과 파일 변경시 git add 및 amend
- [ ] 커밋 메시지 포맷 준수
- [ ] 커밋 실행

## 📋 서브태스크 개발 워크플로우 (SUB-TASK WORKFLOW)

**각 서브태스크 완료 시 필수 절차:**

1. **서브태스크 구현 완료**
2. **빌드 검증 필수** ⭐
   ```bash
   npm run build
   # 또는
   pnpm build
   # ⚠️ 빌드 실패 시 즉시 수정 후 재검증
   ```
3. **타스크 파일 업데이트**
   - `[ ]`를 `[x]`로 변경하여 완료 표시
4. **다음 서브태스크 진행 전 사용자 승인 대기**

**⚠️ 중요: 각 서브태스크마다 반드시 빌드 검증을 수행해야 합니다.**

### 🔴 절대 금지 사항
```bash
❌ 코드 작성 → 바로 [x] 표시 (잘못된 순서)
❌ 빌드 검증 없이 완료 표시하는 것 절대 금지
❌ "빌드는 나중에" 하는 것 절대 금지

✅ 코드 작성 → pnpm build → 빌드 성공 → [x] 표시 (올바른 순서)
✅ 반드시 빌드 검증 후에만 완료 표시
✅ 빌드 실패 시 즉시 수정 후 재검증
```

**강제 규칙: 빌드 검증 없이 `[ ]`를 `[x]`로 변경하는 것은 절대 금지**

## 커밋 메시지 포맷 상세 규칙

### ADAM 프로젝트 표준 형식

⚠️ **HEREDOC 방식 필수 사용**: 수정내용 사이에 개행이 들어가지 않도록 반드시 HEREDOC을 사용하세요

```bash
git commit -m "$(cat <<'EOF'
[TYPE] 한글 제목 (간단명료한 요약)

[수정내용]
 - 첫 번째 변경사항 설명
 - 두 번째 변경사항 설명
 - 세 번째 변경사항 설명

[JIRA] TICKET-NUMBER 또는 N/A
EOF
)"
```

**❌ 잘못된 방식 (개행 발생):**
```bash
# 이 방식은 각 -m 옵션마다 개행이 자동 삽입되어 규칙 위반
git commit -m "[TYPE] 제목" -m "[수정내용]" -m " - 항목1" -m " - 항목2"
```

### 커밋 타입 (TYPE) 분류

```bash
[FEAT]     # 새로운 기능 추가
[FIX]      # 버그 수정
[REFACTOR] # 코드 리팩토링 (기능 변경 없음)
[DOCS]     # 문서 수정
[TEST]     # 테스트 코드 추가/수정
[STYLE]    # 코드 포맷팅, 세미콜론 누락 등
[CHORE]    # 빌드 업무 수정, 패키지 매니저 설정 등
[PERF]     # 성능 개선
[HOTFIX]   # 긴급 수정
```

### 커밋 메시지 작성 예시

#### ✅ 올바른 예시들

**예시 1: 기능 추가**
```bash
git commit -m "$(cat <<'EOF'
[FEAT] 산업용 프로토콜을 위한 IoDeviceConnectorBase 인터페이스 개선

[수정내용]
 - BasicDeviceInfo 인터페이스를 통해 네트워크 스캐닝 기능 추가
 - BasicDeviceConfiguration 인터페이스를 통해 구성 파일 파싱 기능 추가
 - BasicDeviceAlarm 인터페이스를 통해 알람 처리 기능 추가
 - ConnectionStatistics 인터페이스를 통해 연결 통계 기능 추가
 - 진단 메서드 및 기능 확인 기능 추가
 - 향상된 인터페이스 내보내기 기능을 통해 IoDeviceConnectorModule 업데이트

[JIRA] N/A
EOF
)"
```

**예시 2: 버그 수정**
```bash
git commit -m "$(cat <<'EOF'
[FIX] Modbus TCP 연결 타임아웃 문제 해결

[수정내용]
 - 연결 타임아웃 시간을 5초에서 10초로 증가
 - 재연결 로직에서 백오프 알고리즘 적용
 - 연결 실패 시 적절한 에러 메시지 출력

[JIRA] ADAM-123
EOF
)"
```

**예시 3: 리팩토링**
```bash
git commit -m "$(cat <<'EOF'
[REFACTOR] 로봇 상태 관리 서비스 코드 리팩토링

[수정내용]
 - RobotStatusService 클래스를 여러 개의 작은 서비스로 분리
 - 순환 의존성 제거 및 이벤트 기반 통신으로 전환
 - 단위 테스트 커버리지 95%로 향상

[JIRA] ADAM-456
EOF
)"
```

### ❌ 잘못된 예시들

**잘못된 포맷**
```bash
# ❌ 절대 금지: 수정내용 사이에 빈 줄 삽입
[FEAT] 새로운 기능 추가

[수정내용]
 - 첫 번째 수정사항

 - 두 번째 수정사항  ← 이런 빈 줄 금지!

 - 세 번째 수정사항

[JIRA] N/A

# ❌ 절대 금지: 다른 포맷 사용
feat: add new feature  # 구 포맷 사용 금지
fix something         # 부적절한 메시지
```

### 기존 Conventional Commits 사용 (선택사항)

```bash
# ✅ 기존 형식도 허용 (하위 호환성)
feat(robot): add emergency stop functionality
fix(modbus): resolve connection timeout issue
docs(api): update robot controller documentation
test(service): add unit tests for robot service
refactor(cache): optimize memory usage in cache layer
```

## 커밋 단위 규칙

```bash
# ✅ 작은 단위로 자주 커밋
git commit -m "[FEAT] 로봇 상태 검증 기능 추가"
git commit -m "[TEST] 로봇 상태 검증 테스트 추가"
git commit -m "[DOCS] 로봇 API 문서 업데이트"

# ❌ 큰 단위 커밋 지양
git commit -m "[FEAT] 전체 로봇 관리 시스템 구현"
```

## 파일 수정 시 자동 처리 규칙

### 필수 전처리 작업

모든 파일 수정 시 다음 작업이 자동으로 적용되어야 합니다:

```bash
# 수정된 각 파일에 대해 trailing whitespace 제거
sed -i 's/[[:space:]]*$//' filename.ext
```

### 자동화 방법

**1. Git pre-commit hook 사용 (권장):**
```bash
#!/bin/sh
# .git/hooks/pre-commit
for file in $(git diff --cached --name-only); do
    if [ -f "$file" ]; then
        sed -i 's/[[:space:]]*$//' "$file"
        git add "$file"
    fi
done
```

**2. 에디터 설정:**
- VS Code: `"files.trimTrailingWhitespace": true`
- Vim: `autocmd BufWritePre * :%s/\s\+$//e`
- 기타 에디터에서 자동 trailing whitespace 제거 활성화

**3. 수동 실행:**
```bash
# 전체 프로젝트 대상
find . -type f \( -name "*.ts" -o -name "*.js" -o -name "*.md" \) -exec sed -i 's/[[:space:]]*$//' {} +
```

### 커밋 메시지에 반영

파일 수정 시 trailing whitespace 제거가 포함된 경우:

```text
[STYLE] 코드 포맷팅 및 trailing whitespace 제거

[수정내용]
 - 주요 기능 수정
 - trailing whitespace 자동 제거 적용

[JIRA] N/A
```

## 규칙 위반 시 처리 방안

- **빌드 실패 상태 커밋**: 즉시 리버트 필수
- **잘못된 커밋 메시지**: 즉시 amend로 수정 필수
- **pre-commit 미실행**: 재실행 후 amend 필수

## 브랜치 전략

### Git Flow 브랜치 전략 사용

```bash
main           # 프로덕션 브랜치
develop        # 개발 통합 브랜치
feature/*      # 기능 개발 브랜치
release/*      # 릴리즈 준비 브랜치
hotfix/*       # 긴급 수정 브랜치
```

### Pull Request 필수

- 모든 코드 변경사항은 PR을 통해서만 merge
- 최소 1명 이상의 리뷰어 승인 필요
- CI 테스트 통과 필수

## 결론

이 규칙들은 ADAM 시스템의 코드 품질과 일관성을 보장하기 위한 최소한의 기준입니다. 특히 위의 3가지 핵심 규칙(빌드 검증, 커밋 메시지 포맷, pre-commit 실행)은 모든 개발자가 예외 없이 준수해야 합니다.