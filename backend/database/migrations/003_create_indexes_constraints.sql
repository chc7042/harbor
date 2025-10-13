-- Migration: 003_create_indexes_constraints.sql
-- 성능 최적화를 위한 인덱스 및 제약조건 추가

-- 전체 텍스트 검색을 위한 확장 기능 활성화 (이미 init.sql에서 처리)
-- CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 고급 검색 인덱스
-- 배포 이력 전체 텍스트 검색 (프로젝트명, 커밋 메시지, 브랜치명)
CREATE INDEX IF NOT EXISTS idx_deployments_search ON deployments USING gin(
    (project_name || ' ' || COALESCE(git_commit_message, '') || ' ' || COALESCE(git_branch, '') || ' ' || COALESCE(triggered_by, '')) gin_trgm_ops
);

-- 아티팩트 파일명 검색
CREATE INDEX IF NOT EXISTS idx_artifacts_filename_search ON artifacts USING gin(filename gin_trgm_ops);

-- 사용자 전체 텍스트 검색 (이름, 이메일, 부서)
CREATE INDEX IF NOT EXISTS idx_users_search ON users USING gin(
    (COALESCE(full_name, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(department, '')) gin_trgm_ops
);

-- 복합 인덱스 (자주 사용되는 쿼리 패턴 최적화)
-- 프로젝트별 최신 배포 조회
CREATE INDEX IF NOT EXISTS idx_deployments_project_latest ON deployments(project_id, deployed_at DESC, status);

-- 날짜 범위 검색 최적화
CREATE INDEX IF NOT EXISTS idx_deployments_date_range ON deployments(deployed_at, status) WHERE status IN ('success', 'failed');

-- 빌드 실패 분석용
CREATE INDEX IF NOT EXISTS idx_deployments_failed_analysis ON deployments(project_name, deployed_at DESC)
WHERE status = 'failed';

-- 아티팩트 크기별 분석
CREATE INDEX IF NOT EXISTS idx_artifacts_size_analysis ON artifacts(file_size DESC, created_at DESC)
WHERE is_available = true;

-- 부분 인덱스 (성능 최적화)
-- 활성 프로젝트만 인덱싱
CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(name, display_name) WHERE is_active = true;

-- 활성 사용자만 인덱싱
CREATE INDEX IF NOT EXISTS idx_users_active ON users(username, full_name) WHERE is_active = true;

-- 사용 가능한 아티팩트만 인덱싱
CREATE INDEX IF NOT EXISTS idx_artifacts_available ON artifacts(deployment_id, filename) WHERE is_available = true;

-- 최근 감사 로그 (30일) 최적화
-- CREATE INDEX IF NOT EXISTS idx_audit_logs_recent ON audit_logs(user_id, action, created_at DESC)
-- WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days';

-- 함수 기반 인덱스
-- 월별 배포 통계용
-- CREATE INDEX IF NOT EXISTS idx_deployments_monthly ON deployments(
--     date_trunc('month', deployed_at),
--     status
-- );

-- 주별 배포 통계용
-- CREATE INDEX IF NOT EXISTS idx_deployments_weekly ON deployments(
--     date_trunc('week', deployed_at),
--     project_name
-- );

-- 고유 제약조건 추가
-- 프로젝트 이름의 대소문자 구분 없는 유니크 제약
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name_unique ON projects(lower(name));

-- 사용자명의 대소문자 구분 없는 유니크 제약
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(lower(username));

-- 체크 제약조건 추가
-- 빌드 번호는 양수여야 함
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_build_number_positive') THEN
        ALTER TABLE deployments ADD CONSTRAINT check_build_number_positive CHECK (build_number > 0);
    END IF;
END $$;

-- 파일 크기는 0 이상이어야 함
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_file_size_non_negative') THEN
        ALTER TABLE artifacts ADD CONSTRAINT check_file_size_non_negative CHECK (file_size >= 0);
    END IF;
END $$;

-- 빌드 지속시간은 0 이상이어야 함 (NULL 허용)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_build_duration_non_negative') THEN
        ALTER TABLE deployments ADD CONSTRAINT check_build_duration_non_negative CHECK (build_duration IS NULL OR build_duration >= 0);
    END IF;
END $$;

-- Git 커밋 해시 형식 검증 (40자 16진수)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_git_commit_format') THEN
        ALTER TABLE deployments ADD CONSTRAINT check_git_commit_format CHECK (git_commit IS NULL OR git_commit ~ '^[a-f0-9]{40}$');
    END IF;
END $$;

-- 이메일 형식 간단 검증
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_email_format') THEN
        ALTER TABLE users ADD CONSTRAINT check_email_format CHECK (email IS NULL OR email ~ '^[^@]+@[^@]+\.[^@]+$');
    END IF;
END $$;

-- 외래키 제약조건 개선 (더 구체적인 이름)
-- 이미 생성된 제약조건들을 더 명확한 이름으로 변경
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_deployments_project') THEN
        ALTER TABLE deployments DROP CONSTRAINT IF EXISTS deployments_project_id_fkey;
        ALTER TABLE deployments ADD CONSTRAINT fk_deployments_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_artifacts_deployment') THEN
        ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_deployment_id_fkey;
        ALTER TABLE artifacts ADD CONSTRAINT fk_artifacts_deployment FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_deployment_parameters_deployment') THEN
        ALTER TABLE deployment_parameters DROP CONSTRAINT IF EXISTS deployment_parameters_deployment_id_fkey;
        ALTER TABLE deployment_parameters ADD CONSTRAINT fk_deployment_parameters_deployment FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_sessions_user') THEN
        ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS user_sessions_user_id_fkey;
        ALTER TABLE user_sessions ADD CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_audit_logs_user') THEN
        ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
        ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 시스템 성능 최적화를 위한 통계 수집 강화
-- 중요한 테이블들에 대한 통계 수집 주기 설정
ALTER TABLE deployments SET (autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE artifacts SET (autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE users SET (autovacuum_analyze_scale_factor = 0.1);
ALTER TABLE user_sessions SET (autovacuum_analyze_scale_factor = 0.1);

-- 테이블별 통계 목표 설정 (더 정확한 쿼리 플랜을 위해)
ALTER TABLE deployments ALTER COLUMN project_name SET STATISTICS 1000;
ALTER TABLE deployments ALTER COLUMN status SET STATISTICS 1000;
ALTER TABLE deployments ALTER COLUMN deployed_at SET STATISTICS 1000;

ALTER TABLE artifacts ALTER COLUMN filename SET STATISTICS 500;
ALTER TABLE artifacts ALTER COLUMN nas_path SET STATISTICS 500;

ALTER TABLE users ALTER COLUMN username SET STATISTICS 500;
ALTER TABLE users ALTER COLUMN department SET STATISTICS 200;

-- 조건부 인덱스 (특정 조건에서만 사용)
-- 실패한 배포에 대한 빠른 분석
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deployments_failures_detailed
-- ON deployments(project_name, deployed_at DESC, build_duration, triggered_by)
-- WHERE status = 'failed' AND deployed_at >= CURRENT_TIMESTAMP - INTERVAL '90 days';

-- 대용량 아티팩트 분석 (100MB 이상)
CREATE INDEX IF NOT EXISTS idx_artifacts_large_files
ON artifacts(deployment_id, file_size DESC, created_at DESC)
WHERE file_size >= 104857600; -- 100MB

-- 최근 활성 사용자 (30일 내 로그인)
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_recent_active
-- ON users(last_login DESC, department, full_name)
-- WHERE last_login >= CURRENT_TIMESTAMP - INTERVAL '30 days';

-- 성능 모니터링을 위한 뷰 생성
-- CREATE OR REPLACE VIEW database_performance_stats AS
-- SELECT
--     schemaname,
--     tablename,
--     attname as column_name,
--     n_distinct,
--     most_common_vals,
--     most_common_freqs,
--     histogram_bounds
-- FROM pg_stats
-- WHERE schemaname = 'public'
-- AND tablename IN ('deployments', 'artifacts', 'users', 'projects')
-- ORDER BY schemaname, tablename, attname;

-- 인덱스 사용률 모니터링 뷰
-- CREATE OR REPLACE VIEW index_usage_stats AS
-- SELECT
--     schemaname,
--     tablename,
--     indexname,
--     idx_tup_read,
--     idx_tup_fetch,
--     idx_scan,
--     CASE
--         WHEN idx_scan = 0 THEN 'Unused'
--         WHEN idx_scan < 100 THEN 'Low Usage'
--         WHEN idx_scan < 1000 THEN 'Medium Usage'
--         ELSE 'High Usage'
--     END as usage_level
-- FROM pg_stat_user_indexes
-- WHERE schemaname = 'public'
-- ORDER BY idx_scan DESC;

-- 테이블 크기 및 성장 추이 모니터링
-- CREATE OR REPLACE VIEW table_size_stats AS
-- SELECT
--     schemaname,
--     tablename,
--     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
--     pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
--     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size,
--     (SELECT reltuples::bigint FROM pg_class WHERE relname = tablename) as estimated_rows
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 완료 메시지
SELECT 'Advanced indexes and constraints created successfully' as status;