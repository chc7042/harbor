-- Rollback: 004_create_deployment_paths.sql
-- deployment_paths 테이블 및 관련 인덱스 삭제

-- 인덱스 삭제 (테이블 삭제 시 자동 삭제되지만 명시적으로 삭제)
DROP INDEX IF EXISTS idx_deployment_paths_files_gin;
DROP INDEX IF EXISTS idx_deployment_paths_project_recent;
DROP INDEX IF EXISTS idx_deployment_paths_verified_at;
DROP INDEX IF EXISTS idx_deployment_paths_build_date;
DROP INDEX IF EXISTS idx_deployment_paths_lookup;

-- 고유 제약조건 삭제 (테이블 삭제 시 자동 삭제됨)
-- ALTER TABLE deployment_paths DROP CONSTRAINT IF EXISTS unique_deployment_path;

-- 테이블 삭제
DROP TABLE IF EXISTS deployment_paths CASCADE;

-- 확인용 메시지
SELECT 'deployment_paths table and related indexes have been dropped' AS rollback_status;