-- Jenkins NAS 배포 이력 관리 시스템 데이터베이스 초기화 스크립트
-- PostgreSQL 14+ 호환

-- 데이터베이스 생성 (Docker compose에서 처리)
-- CREATE DATABASE jenkins_nas_deployment;

-- 확장 기능 활성화
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255),
    full_name VARCHAR(255),
    department VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 사용자 세션 테이블 (JWT 토큰 관리)
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip_address INET
);

-- 프로젝트 테이블
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    repository_url VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 배포 이력 테이블
CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    project_name VARCHAR(255) NOT NULL, -- 비정규화 (성능)
    build_number INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed', 'in_progress', 'cancelled')),
    deployed_at TIMESTAMP WITH TIME ZONE NOT NULL,

    -- Jenkins 정보
    jenkins_job_name VARCHAR(255),
    jenkins_job_url VARCHAR(500),
    jenkins_build_url VARCHAR(500),
    jenkins_console_url VARCHAR(500),

    -- Git 정보
    git_commit VARCHAR(40),
    git_branch VARCHAR(255),
    git_commit_message TEXT,
    git_author VARCHAR(255),

    -- 배포 메타데이터
    build_duration INTEGER, -- 초 단위
    triggered_by VARCHAR(100),
    environment VARCHAR(50),
    version VARCHAR(100),

    -- 로그 정보
    build_log TEXT,
    deploy_log TEXT,
    error_message TEXT,

    -- 시스템 정보
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 유니크 제약 조건 (중복 배포 방지)
    UNIQUE(project_name, build_number)
);

-- 아티팩트 테이블
CREATE TABLE IF NOT EXISTS artifacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(1000) NOT NULL,
    file_size BIGINT NOT NULL,
    file_checksum VARCHAR(64), -- SHA256 해시
    mime_type VARCHAR(100),

    -- NAS 정보
    nas_path VARCHAR(1000) NOT NULL,
    is_available BOOLEAN DEFAULT true,

    -- 메타데이터
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 배포 매개변수 테이블 (JSON 형태의 빌드/배포 파라미터)
CREATE TABLE IF NOT EXISTS deployment_parameters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    parameter_name VARCHAR(100) NOT NULL,
    parameter_value TEXT,
    parameter_type VARCHAR(20) DEFAULT 'string' CHECK (parameter_type IN ('string', 'number', 'boolean', 'json')),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 복합 유니크 키
    UNIQUE(deployment_id, parameter_name)
);

-- 시스템 설정 테이블
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    is_encrypted BOOLEAN DEFAULT false,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100)
);

-- NAS 배포 경로 캐시 테이블
CREATE TABLE IF NOT EXISTS deployment_paths (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_name VARCHAR(100) NOT NULL,
    version VARCHAR(20) NOT NULL,
    build_number INTEGER NOT NULL,
    build_date DATE NOT NULL,
    nas_path TEXT NOT NULL,
    download_file VARCHAR(255),
    all_files JSONB,
    verified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- 고유 제약 조건: 동일한 프로젝트/버전/빌드번호 조합은 하나만 존재
    CONSTRAINT unique_deployment_path UNIQUE (project_name, version, build_number)
);

-- NAS 파일 메타데이터 테이블
CREATE TABLE IF NOT EXISTS nas_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_path TEXT NOT NULL UNIQUE,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    file_hash VARCHAR(64), -- SHA256
    mime_type VARCHAR(100),
    project_name VARCHAR(100),
    version VARCHAR(50),
    build_number INTEGER,
    scan_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 감사 로그 테이블
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    username VARCHAR(100),
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 생성
-- 사용자 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- 세션 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token_hash ON user_sessions(refresh_token_hash);

-- 프로젝트 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
CREATE INDEX IF NOT EXISTS idx_projects_is_active ON projects(is_active);

-- 배포 관련 인덱스 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_deployments_project_name ON deployments(project_name);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_deployed_at ON deployments(deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_build_number ON deployments(build_number);
CREATE INDEX IF NOT EXISTS idx_deployments_git_commit ON deployments(git_commit);

-- 복합 인덱스 (자주 사용되는 쿼리 최적화)
CREATE INDEX IF NOT EXISTS idx_deployments_project_status ON deployments(project_name, status);
CREATE INDEX IF NOT EXISTS idx_deployments_project_date ON deployments(project_name, deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_status_date ON deployments(status, deployed_at DESC);

-- 아티팩트 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_artifacts_deployment_id ON artifacts(deployment_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_filename ON artifacts(filename);
CREATE INDEX IF NOT EXISTS idx_artifacts_nas_path ON artifacts(nas_path);
CREATE INDEX IF NOT EXISTS idx_artifacts_is_available ON artifacts(is_available);

-- 배포 매개변수 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_deployment_parameters_deployment_id ON deployment_parameters(deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_parameters_name ON deployment_parameters(parameter_name);

-- 배포 경로 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_deployment_paths_lookup ON deployment_paths(project_name, version, build_number);
CREATE INDEX IF NOT EXISTS idx_deployment_paths_build_date ON deployment_paths(build_date);
CREATE INDEX IF NOT EXISTS idx_deployment_paths_verified_at ON deployment_paths(verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployment_paths_project_recent ON deployment_paths(project_name, build_date DESC);
CREATE INDEX IF NOT EXISTS idx_deployment_paths_files_gin ON deployment_paths USING gin(all_files);

-- NAS 파일 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_nas_files_file_path ON nas_files(file_path);
CREATE INDEX IF NOT EXISTS idx_nas_files_project_name ON nas_files(project_name);
CREATE INDEX IF NOT EXISTS idx_nas_files_version ON nas_files(version);
CREATE INDEX IF NOT EXISTS idx_nas_files_build_number ON nas_files(build_number);
CREATE INDEX IF NOT EXISTS idx_nas_files_scan_date ON nas_files(scan_date DESC);
CREATE INDEX IF NOT EXISTS idx_nas_files_is_active ON nas_files(is_active);

-- 감사 로그 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- 전체 텍스트 검색 인덱스 (pg_trgm 확장 사용)
CREATE INDEX IF NOT EXISTS idx_deployments_search ON deployments USING gin(
    (project_name || ' ' || COALESCE(git_commit_message, '') || ' ' || COALESCE(git_branch, '')) gin_trgm_ops
);

-- 트리거 함수: updated_at 자동 업데이트
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 트리거 생성
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deployments_updated_at BEFORE UPDATE ON deployments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_artifacts_updated_at BEFORE UPDATE ON artifacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deployment_paths_updated_at BEFORE UPDATE ON deployment_paths
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nas_files_updated_at BEFORE UPDATE ON nas_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 뷰 생성: 배포 통계 요약
CREATE OR REPLACE VIEW deployment_stats AS
SELECT
    project_name,
    COUNT(*) as total_deployments,
    COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_deployments,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_deployments,
    ROUND(
        (COUNT(CASE WHEN status = 'success' THEN 1 END)::numeric / COUNT(*) * 100), 2
    ) as success_rate,
    MAX(deployed_at) as last_deployment,
    AVG(build_duration) as avg_build_duration
FROM deployments
GROUP BY project_name;

-- 뷰 생성: 최근 배포 활동
CREATE OR REPLACE VIEW recent_deployments AS
SELECT
    d.id,
    d.project_name,
    d.build_number,
    d.status,
    d.deployed_at,
    d.git_commit,
    d.git_branch,
    d.triggered_by,
    d.build_duration,
    p.display_name as project_display_name,
    COUNT(a.id) as artifact_count
FROM deployments d
LEFT JOIN projects p ON d.project_id = p.id
LEFT JOIN artifacts a ON d.id = a.deployment_id
WHERE d.deployed_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
GROUP BY d.id, d.project_name, d.build_number, d.status, d.deployed_at,
         d.git_commit, d.git_branch, d.triggered_by, d.build_duration, p.display_name
ORDER BY d.deployed_at DESC;

-- 초기 시스템 설정 데이터
INSERT INTO system_settings (key, value, description) VALUES
('nas_mount_path', '/mnt/nas', 'NAS 마운트 경로'),
('scan_interval', '300', 'NAS 스캔 주기 (초)'),
('max_log_retention_days', '90', '로그 보관 기간 (일)'),
('webhook_secret', 'change-this-in-production', 'Jenkins Webhook 비밀키'),
('jwt_expires_in', '3600', 'JWT 토큰 만료 시간 (초)'),
('refresh_token_expires_in', '28800', 'Refresh 토큰 만료 시간 (초)')
ON CONFLICT (key) DO NOTHING;

-- 샘플 프로젝트 데이터 (개발용)
INSERT INTO projects (name, display_name, description) VALUES
('web-frontend', 'Web Frontend', 'React 기반 웹 프론트엔드'),
('api-backend', 'API Backend', 'Node.js Express API 서버'),
('mobile-app', 'Mobile App', 'React Native 모바일 앱'),
('data-pipeline', 'Data Pipeline', '데이터 처리 파이프라인')
ON CONFLICT (name) DO NOTHING;

-- 권한 설정
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jenkins_nas_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jenkins_nas_user;

-- 데이터베이스 설정 최적화
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;

-- 연결 풀 설정
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';

COMMENT ON DATABASE jenkins_nas_deployment IS 'Jenkins NAS 배포 이력 관리 시스템';

-- 테이블 코멘트
COMMENT ON TABLE users IS '사용자 정보 (LDAP 연동)';
COMMENT ON TABLE user_sessions IS '사용자 세션 및 Refresh 토큰 관리';
COMMENT ON TABLE projects IS '프로젝트 정보';
COMMENT ON TABLE deployments IS '배포 이력 메인 테이블';
COMMENT ON TABLE artifacts IS '배포된 아티팩트 파일 정보';
COMMENT ON TABLE deployment_parameters IS '배포 매개변수 (빌드 파라미터 등)';
COMMENT ON TABLE system_settings IS '시스템 설정';
COMMENT ON TABLE deployment_paths IS 'NAS 경로 캐시 테이블 - Jenkins 빌드별 검증된 NAS 경로 저장';
COMMENT ON TABLE nas_files IS 'NAS 파일 시스템 메타데이터 및 스캔 결과';
COMMENT ON TABLE audit_logs IS '사용자 활동 감사 로그';

-- 컬럼 코멘트 (주요 컬럼만)
COMMENT ON COLUMN deployments.status IS '배포 상태: success, failed, in_progress, cancelled';
COMMENT ON COLUMN deployments.build_duration IS '빌드 소요 시간 (초 단위)';
COMMENT ON COLUMN artifacts.file_checksum IS 'SHA256 파일 체크섬';
COMMENT ON COLUMN artifacts.is_available IS 'NAS에서 파일 존재 여부';

-- 완료 메시지
SELECT 'Jenkins NAS 배포 이력 관리 데이터베이스 초기화 완료' as status;