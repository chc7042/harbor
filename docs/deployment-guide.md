# Jenkins NAS 배포 이력 관리 - 배포 가이드

## 환경별 배포 전략

### 개발 환경 (Development)
- Docker Compose 기반 로컬 개발 환경
- 볼륨 마운트를 통한 핫 리로드 지원
- 개발용 환경변수 및 설정

### 프로덕션 환경 (Production)
- 멀티스테이지 Docker 빌드
- 최적화된 이미지 및 리소스 제한
- SSL, 보안 강화, 모니터링 설정

## 개발 환경 설정

### 사전 요구사항
- Docker 20.10+
- Docker Compose 2.0+
- Git

### 1단계: 저장소 클론
```bash
git clone <repository-url>
cd jenkins-nas-deployment-history
```

### 2단계: 환경변수 설정
```bash
cp .env.example .env
# .env 파일을 편집하여 로컬 환경에 맞게 수정
```

### 3단계: 개발 환경 시작
```bash
# 자동 설정 스크립트 실행
./scripts/setup-dev.sh

# 또는 수동 실행
docker-compose up -d --build
```

### 4단계: 서비스 확인
```bash
# 컨테이너 상태 확인
docker-compose ps

# 로그 확인
docker-compose logs -f backend
docker-compose logs -f frontend
```

## 프로덕션 환경 배포

### 사전 요구사항
- Linux 서버 (Ubuntu 20.04+ 권장)
- Docker 20.10+
- Docker Compose 2.0+
- 충분한 디스크 공간 (최소 10GB)
- SSL 인증서 (HTTPS 사용 시)

### 1단계: 서버 준비
```bash
# Docker 설치
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Docker Compose 설치
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2단계: 애플리케이션 배포
```bash
# 저장소 클론
git clone <repository-url>
cd jenkins-nas-deployment-history

# 프로덕션 환경변수 설정
cp .env.prod.example .env.prod
# .env.prod 파일 편집 (모든 CHANGE_THIS 값 변경)

# 프로덕션 배포 스크립트 실행
./scripts/deploy-prod.sh
```

### 3단계: NAS 마운트 설정
```bash
# NAS 마운트 포인트 생성
sudo mkdir -p /mnt/production-nas

# NFS 마운트 (예시)
sudo mount -t nfs nas-server:/path/to/jenkins/artifacts /mnt/production-nas

# 영구 마운트 설정 (/etc/fstab)
echo "nas-server:/path/to/jenkins/artifacts /mnt/production-nas nfs defaults 0 0" | sudo tee -a /etc/fstab
```

### 4단계: 방화벽 설정
```bash
# 필요한 포트 열기
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3001/tcp  # API 포트 (내부 네트워크만)
```

## 환경변수 상세 설정

### 개발 환경 (.env)
```bash
# 데이터베이스
DB_HOST=localhost
DB_PORT=5432
DB_NAME=jenkins_nas_deployment
DB_USER=postgres
DB_PASSWORD=password

# JWT
JWT_SECRET=dev-secret-key
JWT_EXPIRES_IN=1h

# LDAP (테스트용)
LDAP_URL=ldap://test-ldap-server:389
LDAP_BIND_DN=cn=admin,dc=test,dc=com
LDAP_BIND_CREDENTIALS=test-password

# NAS
NAS_MOUNT_PATH=/mnt/test-nas
```

### 프로덕션 환경 (.env.prod)
```bash
# 데이터베이스 (강력한 패스워드 설정)
DB_HOST=postgres
DB_PASSWORD=<32자 이상 랜덤 문자열>

# JWT (32자 이상 랜덤 비밀키)
JWT_SECRET=<암호학적으로 안전한 32자 이상 키>
REFRESH_TOKEN_SECRET=<암호학적으로 안전한 32자 이상 키>

# LDAP (실제 서버 정보)
LDAP_URL=ldaps://prod-ldap-server:636
LDAP_BIND_DN=cn=jenkins-nas-service,ou=services,dc=company,dc=com
LDAP_BIND_CREDENTIALS=<실제 서비스 계정 패스워드>

# 도메인
CORS_ORIGIN=https://your-domain.com
```

## SSL 인증서 설정

### Let's Encrypt 사용 (권장)
```bash
# Certbot 설치
sudo apt install certbot python3-certbot-nginx

# 인증서 발급
sudo certbot --nginx -d your-domain.com

# 자동 갱신 설정
sudo crontab -e
# 다음 라인 추가:
0 12 * * * /usr/bin/certbot renew --quiet
```

### 인증서 파일 배치
```bash
# SSL 디렉토리 생성
mkdir -p ssl

# 인증서 복사
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ssl/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem ssl/key.pem
sudo chown $USER:$USER ssl/*.pem
```

## 모니터링 설정

### 로그 모니터링
```bash
# 로그 디렉토리 생성
mkdir -p logs

# 로그 로테이션 설정 (/etc/logrotate.d/jenkins-nas)
/path/to/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 $USER $USER
    postrotate
        docker-compose -f docker-compose.prod.yml restart backend
    endscript
}
```

### 헬스체크 모니터링
```bash
# 헬스체크 스크립트 생성
cat > /usr/local/bin/jenkins-nas-healthcheck.sh << 'EOF'
#!/bin/bash
if ! curl -f http://localhost:3001/health >/dev/null 2>&1; then
    echo "Backend health check failed"
    # 알림 또는 재시작 로직 추가
    docker-compose -f /path/to/jenkins-nas/docker-compose.prod.yml restart backend
fi
EOF

chmod +x /usr/local/bin/jenkins-nas-healthcheck.sh

# Cron 작업 추가
echo "*/5 * * * * /usr/local/bin/jenkins-nas-healthcheck.sh" | crontab -
```

## Jenkins Webhook 설정

### Jenkins 서버에서 Webhook 설정
1. Jenkins 관리 > 플러그인 관리 > Generic Webhook Trigger 설치
2. 빌드 후 조치에서 Post Build Action 추가:
   ```
   URL: http://your-domain.com/webhook/jenkins
   Content-Type: application/json
   HTTP Method: POST
   ```

### Webhook 페이로드 예시
```json
{
  "project": "${JOB_NAME}",
  "buildNumber": "${BUILD_NUMBER}",
  "status": "${BUILD_STATUS}",
  "timestamp": "${BUILD_TIMESTAMP}",
  "gitCommit": "${GIT_COMMIT}",
  "artifacts": [
    {
      "filename": "app.war",
      "path": "/nas/artifacts/${JOB_NAME}/${BUILD_NUMBER}/app.war",
      "size": 12345678
    }
  ]
}
```

## 백업 및 복구

### 자동 백업 스크립트
```bash
#!/bin/bash
# /usr/local/bin/jenkins-nas-backup.sh

BACKUP_DIR="/backups/jenkins-nas/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 데이터베이스 백업
docker-compose -f /path/to/jenkins-nas/docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres jenkins_nas_deployment_prod > "$BACKUP_DIR/database.sql"

# 환경설정 백업
cp /path/to/jenkins-nas/.env.prod "$BACKUP_DIR/"

# 로그 백업 (최근 7일)
find /path/to/jenkins-nas/logs -name "*.log" -mtime -7 -exec cp {} "$BACKUP_DIR/" \;

# 오래된 백업 정리 (30일 이상)
find /backups/jenkins-nas -type d -mtime +30 -exec rm -rf {} \;
```

### 복구 절차
```bash
# 서비스 중지
docker-compose -f docker-compose.prod.yml down

# 데이터베이스 복구
docker-compose -f docker-compose.prod.yml up -d postgres
sleep 10
cat backup/database.sql | docker-compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d jenkins_nas_deployment_prod

# 전체 서비스 재시작
docker-compose -f docker-compose.prod.yml up -d
```

## 트러블슈팅

### 일반적인 문제 해결

#### 1. 데이터베이스 연결 실패
```bash
# 데이터베이스 상태 확인
docker-compose logs postgres

# 연결 테스트
docker-compose exec backend node -e "
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});
pool.query('SELECT NOW()').then(res => console.log('DB OK:', res.rows[0])).catch(err => console.error('DB Error:', err));
"
```

#### 2. LDAP 인증 실패
```bash
# LDAP 연결 테스트
docker-compose exec backend node -e "
const ldap = require('ldapjs');
const client = ldap.createClient({url: process.env.LDAP_URL});
client.bind(process.env.LDAP_BIND_DN, process.env.LDAP_BIND_CREDENTIALS, (err) => {
  if (err) console.error('LDAP Error:', err);
  else console.log('LDAP OK');
  client.unbind();
});
"
```

#### 3. NAS 마운트 문제
```bash
# 마운트 상태 확인
mount | grep nas

# 권한 확인
ls -la /mnt/production-nas

# 마운트 재시도
sudo umount /mnt/production-nas
sudo mount -t nfs nas-server:/path/to/jenkins/artifacts /mnt/production-nas
```

### 성능 최적화

#### 메모리 사용량 최적화
```yaml
# docker-compose.prod.yml에 메모리 제한 추가
deploy:
  resources:
    limits:
      memory: 512M
    reservations:
      memory: 256M
```

#### PostgreSQL 튜닝
```sql
-- PostgreSQL 성능 설정
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
SELECT pg_reload_conf();
```

이 배포 가이드를 따라하면 안전하고 확장 가능한 Jenkins NAS 배포 이력 관리 시스템을 구축할 수 있습니다.