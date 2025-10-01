# NAS 경로 자동 탐지 시스템 문제 해결 가이드

## 개요

이 문서는 NAS 경로 자동 탐지 시스템에서 발생할 수 있는 일반적인 문제들과 해결 방법을 제공합니다. 시스템은 4단계 폴백 체인을 통해 배포 경로를 탐지하며, 각 단계별로 다른 문제가 발생할 수 있습니다.

## 폴백 체인 순서

1. **DB 캐시 조회** - 이전에 검증된 경로 확인
2. **Jenkins 로그 직접 추출** - Jenkins 빌드 로그에서 경로 파싱
3. **Jenkins 빌드 날짜 기반 + NAS 검증** - 빌드 타임스탬프로 경로 생성 후 NAS에서 검증
4. **NAS 디렉토리 스캔** - 전체 NAS 디렉토리 탐색 (레거시 방식)

## 1. 일반적인 문제 및 해결 방법

### 1.1 "NAS 확인 필요" 메시지가 지속적으로 표시됨

**증상:**
- 프론트엔드에서 배포 상세 정보 조회 시 "NAS 확인 필요" 메시지 표시
- 응답 시간이 30초 이상 소요되고 결국 실패

**원인 분석:**
```bash
# 건강 상태 확인
curl http://localhost:3002/health

# 알림 상태 확인  
curl http://localhost:3002/health/alerts

# 최근 로그 확인
tail -f backend/logs/app.log | grep "deployment.*extraction"
```

**해결 방법:**

1. **데이터베이스 연결 확인**
   ```bash
   # DB 연결 테스트
   psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT 1;"
   
   # deployment_paths 테이블 존재 확인
   psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "\dt deployment_paths"
   ```

2. **Jenkins 서비스 설정 확인**
   ```bash
   # 환경 변수 확인
   echo $JENKINS_URL
   echo $JENKINS_USERNAME
   # JENKINS_PASSWORD는 보안상 직접 출력하지 않음
   
   # Jenkins API 연결 테스트
   curl -u "$JENKINS_USERNAME:$JENKINS_PASSWORD" "$JENKINS_URL/api/json"
   ```

3. **NAS 서비스 연결 확인**
   ```bash
   # NAS 마운트 상태 확인 (Linux 환경)
   mount | grep nas
   
   # 특정 경로 접근 테스트
   ls -la /path/to/nas/mount/point
   ```

### 1.2 Jenkins API 호출 실패

**증상:**
- 로그에 "Jenkins API failed - falling back to build log extraction" 메시지
- Jenkins 빌드 정보를 가져올 수 없음

**원인:**
- Jenkins 서버 접근 불가
- 잘못된 인증 정보
- Jenkins 서버 과부하

**해결 방법:**

1. **Jenkins 서버 상태 확인**
   ```bash
   # Jenkins 서버 ping 테스트
   ping jenkins-server.company.com
   
   # Jenkins 웹 인터페이스 접근 테스트
   curl -I $JENKINS_URL
   ```

2. **인증 정보 검증**
   ```bash
   # Jenkins 사용자 정보 확인
   curl -u "$JENKINS_USERNAME:$JENKINS_PASSWORD" "$JENKINS_URL/me/api/json"
   ```

3. **Jenkins 잡 존재 확인**
   ```bash
   # 특정 잡의 빌드 정보 확인
   curl -u "$JENKINS_USERNAME:$JENKINS_PASSWORD" \
     "$JENKINS_URL/job/PROJECT_NAME/job/VERSION/BUILD_NUMBER/api/json"
   ```

4. **네트워크 및 방화벽 설정 확인**
   ```bash
   # 포트 연결 테스트
   telnet jenkins-server.company.com 8080
   ```

### 1.3 NAS 경로 검증 실패

**증상:**
- 로그에 "NAS verification failed" 메시지
- 생성된 경로 후보들이 모두 유효하지 않음

**원인:**
- NAS 서버 연결 문제
- 경로 생성 로직 오류
- 파일 권한 문제

**해결 방법:**

1. **NAS 연결 상태 확인**
   ```bash
   # SMB/CIFS 연결 테스트
   smbclient -L //nas.company.com -U username
   
   # 특정 공유 폴더 접근
   smbclient //nas.company.com/release_version -U username
   ```

2. **경로 후보 생성 로직 확인**
   ```javascript
   // 개발자 도구에서 경로 생성 테스트
   const { generatePathCandidates, formatDateForNAS } = require('./src/utils/pathDetection');
   
   const buildDate = new Date('2024-03-10T08:43:00Z');
   const pathCandidates = generatePathCandidates('mr3.0.0', buildDate);
   console.log('Generated paths:', pathCandidates);
   ```

3. **파일 권한 확인**
   ```bash
   # NAS 마운트 포인트 권한 확인
   ls -la /mnt/nas/release_version/
   
   # 특정 경로 읽기 권한 테스트
   ls -la "/mnt/nas/release_version/release/product/mr3.0.0/250310/"
   ```

### 1.4 데이터베이스 성능 문제

**증상:**
- DB 조회가 1초 이상 소요
- 건강 상태 체크에서 DB 응답 시간 경고

**원인:**
- 인덱스 누락
- 테이블 통계 정보 오래됨
- 동시 연결 수 초과

**해결 방법:**

1. **인덱스 상태 확인**
   ```sql
   -- 인덱스 사용 통계 확인
   SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
   FROM pg_stat_user_indexes 
   WHERE tablename = 'deployment_paths';
   
   -- 누락된 인덱스 생성
   CREATE INDEX CONCURRENTLY idx_deployment_paths_build_date 
   ON deployment_paths(build_date) WHERE build_date > NOW() - INTERVAL '90 days';
   ```

2. **쿼리 성능 분석**
   ```sql
   -- 느린 쿼리 분석
   EXPLAIN ANALYZE 
   SELECT * FROM deployment_paths 
   WHERE project_name = 'mr3.0.0' AND version = '3.0.0' AND build_number = 26;
   ```

3. **연결 풀 설정 확인**
   ```javascript
   // database.js 설정 확인
   const poolConfig = {
     max: 20,           // 최대 연결 수
     min: 5,            // 최소 연결 수  
     idle: 10000,       // 유휴 연결 타임아웃
     acquire: 60000,    // 연결 획득 타임아웃
   };
   ```

### 1.5 높은 실패율 및 연속 실패

**증상:**
- 알림 시스템에서 연속 실패 또는 높은 실패율 경고
- 시스템 전반적인 성능 저하

**원인:**
- 외부 시스템 (Jenkins, NAS) 불안정
- 네트워크 연결 문제
- 시스템 리소스 부족

**해결 방법:**

1. **시스템 리소스 확인**
   ```bash
   # CPU 사용률
   top
   
   # 메모리 사용률
   free -h
   
   # 디스크 I/O
   iostat -x 1
   
   # 네트워크 연결 상태
   netstat -tulpn | grep :3002
   ```

2. **로그 분석**
   ```bash
   # 최근 1시간 에러 로그
   tail -n 1000 /var/log/app.log | grep ERROR | grep -E "$(date -d '1 hour ago' '+%Y-%m-%d %H')"
   
   # 실패 패턴 분석
   grep "deployment.*extraction.*failed" /var/log/app.log | tail -20
   ```

3. **알림 임계값 조정**
   ```bash
   # 환경 변수로 임계값 조정
   export ALERT_CONSECUTIVE_FAILURES=10
   export ALERT_FAILURE_RATE_THRESHOLD=0.9
   export ALERT_TIME_WINDOW_MINUTES=60
   export ALERT_COOLDOWN_MINUTES=30
   ```

## 2. 성능 최적화

### 2.1 캐시 효율성 향상

```sql
-- 캐시 히트율 확인
SELECT 
  COUNT(*) as total_requests,
  COUNT(*) FILTER (WHERE verified_at IS NOT NULL) as cache_hits,
  ROUND(COUNT(*) FILTER (WHERE verified_at IS NOT NULL) * 100.0 / COUNT(*), 2) as hit_rate
FROM deployment_paths 
WHERE created_at > NOW() - INTERVAL '24 hours';

-- 자주 조회되는 프로젝트 확인
SELECT project_name, COUNT(*) as request_count
FROM deployment_paths 
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY project_name 
ORDER BY request_count DESC LIMIT 10;
```

### 2.2 배치 정리 작업

```javascript
// 오래된 캐시 데이터 정리 (cron job으로 실행)
const { getDeploymentPathService } = require('./src/services/deploymentPathService');

async function cleanupOldCache() {
  const deploymentPathService = getDeploymentPathService();
  const deletedCount = await deploymentPathService.cleanupOldPaths(90); // 90일 이상된 데이터 삭제
  console.log(`Cleaned up ${deletedCount} old cache entries`);
}
```

## 3. 모니터링 및 알림

### 3.1 주요 메트릭 모니터링

```bash
# 건강 상태 모니터링 (5분마다 실행)
*/5 * * * * curl -s http://localhost:3002/health | jq '.data.checks.deploymentPathDetection.status'

# 알림 상태 확인
curl -s http://localhost:3002/health/alerts | jq '.data.alerting.state'
```

### 3.2 Grafana 대시보드 메트릭

```promql
# 성공률
rate(deployment_extraction_total{status="success"}[5m]) / rate(deployment_extraction_total[5m]) * 100

# 평균 응답 시간
histogram_quantile(0.95, rate(deployment_extraction_duration_bucket[5m]))

# 폴백 체인 사용률
rate(deployment_extraction_fallback_total[5m]) by (fallback_type)
```

### 3.3 Slack 알림 설정

```javascript
// Slack Webhook 알림 핸들러 등록
const { getAlertingService } = require('./src/services/alertingService');

const alertingService = getAlertingService();
const slackHandler = alertingService.createWebhookAlertHandler(
  'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'
);
alertingService.registerAlertHandler(slackHandler);
```

## 4. 디버깅 도구

### 4.1 수동 경로 탐지 테스트

```javascript
// 개발 환경에서 특정 빌드의 경로 탐지 테스트
const { getJenkinsService } = require('./src/services/jenkinsService');

async function testPathDetection(jobName, buildNumber) {
  const jenkinsService = getJenkinsService();
  const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
  console.log('Detection result:', JSON.stringify(result, null, 2));
}

// 사용 예시
testPathDetection('mr3.0.0', 26);
```

### 4.2 NAS 연결 테스트

```javascript
// NAS 서비스 연결 테스트
const { getNASService } = require('./src/services/nasService');

async function testNASConnection() {
  const nasService = getNASService();
  const testPath = '\\\\nas.company.com\\release_version\\release\\product\\mr3.0.0\\250310\\26';
  
  try {
    const files = await nasService.listFiles(testPath);
    console.log('NAS connection successful, files:', files);
  } catch (error) {
    console.error('NAS connection failed:', error.message);
  }
}
```

### 4.3 로그 레벨 조정

```javascript
// 운영 중 동적 로그 레벨 변경
const logger = require('./src/config/logger');

// 디버그 로그 활성화
logger.level = 'debug';

// 특정 모듈만 상세 로깅
process.env.DEBUG = 'jenkins:*,nas:*';
```

## 5. 비상 시나리오

### 5.1 전체 시스템 실패 시

```bash
# 긴급 복구 절차
# 1. 서비스 재시작
pm2 restart harbor-backend

# 2. 캐시 초기화
redis-cli FLUSHDB

# 3. 데이터베이스 연결 복구
sudo systemctl restart postgresql

# 4. NAS 마운트 재연결
sudo umount /mnt/nas
sudo mount -t cifs //nas.company.com/release_version /mnt/nas -o credentials=/etc/nas-credentials
```

### 5.2 Jenkins 서버 다운 시

```javascript
// Jenkins 서버 다운 시 우회 방법
// 1. 다른 Jenkins 서버 URL로 임시 변경
process.env.JENKINS_URL = 'https://backup-jenkins.company.com';

// 2. 또는 NAS 직접 스캔 모드로 강제 전환
process.env.FORCE_NAS_SCAN_MODE = 'true';
```

### 5.3 데이터베이스 장애 시

```javascript
// DB 장애 시 읽기 전용 모드 전환
process.env.DB_READ_ONLY_MODE = 'true';

// 메모리 캐시만 사용하여 임시 운영
const inMemoryCache = new Map();
// 기존 DB 캐시 조회 로직을 메모리 캐시로 대체
```

## 6. 예방 조치

### 6.1 정기 점검 항목

- **매일**: 건강 상태 체크, 알림 확인
- **매주**: 캐시 히트율 분석, 성능 메트릭 리뷰
- **매월**: 데이터베이스 정리, 로그 아카이빙
- **분기별**: 폴백 로직 테스트, 재해 복구 훈련

### 6.2 용량 계획

```sql
-- 데이터 증가율 분석
SELECT 
  DATE_TRUNC('month', created_at) as month,
  COUNT(*) as new_entries,
  pg_size_pretty(pg_total_relation_size('deployment_paths')) as table_size
FROM deployment_paths 
GROUP BY month 
ORDER BY month DESC LIMIT 12;
```

### 6.3 자동화된 테스트

```javascript
// 주기적 end-to-end 테스트
const testCases = [
  { jobName: 'mr3.0.0', buildNumber: 26 },
  { jobName: 'fs3.0.0', buildNumber: 15 },
  // ... 더 많은 테스트 케이스
];

async function runHealthTests() {
  for (const testCase of testCases) {
    try {
      const result = await testPathDetection(testCase.jobName, testCase.buildNumber);
      console.log(`✅ ${testCase.jobName}#${testCase.buildNumber}: Success`);
    } catch (error) {
      console.error(`❌ ${testCase.jobName}#${testCase.buildNumber}: ${error.message}`);
    }
  }
}
```

## 연락처 및 에스컬레이션

- **1차 지원**: DevOps 팀 (Slack: #devops-support)
- **2차 지원**: 백엔드 개발팀 (이메일: backend-team@company.com)
- **긴급 상황**: On-call 엔지니어 (전화: xxx-xxxx-xxxx)

---

**마지막 업데이트**: 2024년 10월
**문서 버전**: 1.0
**담당자**: Harbor 개발팀