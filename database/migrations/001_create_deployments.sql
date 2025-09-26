-- Migration: 001_create_deployments.sql
-- 배포 이력 관련 테이블 생성

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

-- 배포 매개변수 테이블
CREATE TABLE IF NOT EXISTS deployment_parameters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    parameter_name VARCHAR(100) NOT NULL,
    parameter_value TEXT,
    parameter_type VARCHAR(20) DEFAULT 'string' CHECK (parameter_type IN ('string', 'number', 'boolean', 'json')),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(deployment_id, parameter_name)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
CREATE INDEX IF NOT EXISTS idx_projects_is_active ON projects(is_active);

CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_deployments_project_name ON deployments(project_name);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_deployed_at ON deployments(deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_build_number ON deployments(build_number);
CREATE INDEX IF NOT EXISTS idx_deployments_project_status ON deployments(project_name, status);
CREATE INDEX IF NOT EXISTS idx_deployments_project_date ON deployments(project_name, deployed_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifacts_deployment_id ON artifacts(deployment_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_filename ON artifacts(filename);
CREATE INDEX IF NOT EXISTS idx_artifacts_nas_path ON artifacts(nas_path);

CREATE INDEX IF NOT EXISTS idx_deployment_parameters_deployment_id ON deployment_parameters(deployment_id);

-- 트리거 설정
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deployments_updated_at BEFORE UPDATE ON deployments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_artifacts_updated_at BEFORE UPDATE ON artifacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 샘플 프로젝트 데이터
INSERT INTO projects (name, display_name, description) VALUES
('web-frontend', 'Web Frontend', 'React 기반 웹 프론트엔드'),
('api-backend', 'API Backend', 'Node.js Express API 서버'),
('mobile-app', 'Mobile App', 'React Native 모바일 앱'),
('data-pipeline', 'Data Pipeline', '데이터 처리 파이프라인')
ON CONFLICT (name) DO NOTHING;