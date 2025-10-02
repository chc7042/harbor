-- Migration: 004_create_deployment_paths.sql
-- NAS 경로 자동 탐지 및 캐싱을 위한 테이블 생성

-- 배포 경로 캐시 테이블
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

-- 코멘트 추가
COMMENT ON TABLE deployment_paths IS 'NAS 경로 캐시 테이블 - Jenkins 빌드별 검증된 NAS 경로 저장';
COMMENT ON COLUMN deployment_paths.project_name IS '프로젝트명 (예: 3.0.0/mr3.0.0_release)';
COMMENT ON COLUMN deployment_paths.version IS '버전 (예: 3.0.0)';
COMMENT ON COLUMN deployment_paths.build_number IS 'Jenkins 빌드 번호';
COMMENT ON COLUMN deployment_paths.build_date IS '실제 빌드 날짜';
COMMENT ON COLUMN deployment_paths.nas_path IS '검증된 NAS 경로 (예: \\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26)';
COMMENT ON COLUMN deployment_paths.download_file IS '메인 다운로드 파일명 (예: V3.0.0_250310_0843.tar.gz)';
COMMENT ON COLUMN deployment_paths.all_files IS '모든 배포 파일 목록 JSON 배열';
COMMENT ON COLUMN deployment_paths.verified_at IS '경로 검증 완료 시점';

-- 성능 최적화를 위한 인덱스 생성
-- 가장 중요한 조회 패턴: 프로젝트명, 버전, 빌드번호로 조회
CREATE INDEX IF NOT EXISTS idx_deployment_paths_lookup 
ON deployment_paths(project_name, version, build_number);

-- 빌드 날짜별 조회 (날짜 범위 검색)
CREATE INDEX IF NOT EXISTS idx_deployment_paths_build_date 
ON deployment_paths(build_date);

-- 검증 시점별 조회 (최근 검증된 항목 조회)
CREATE INDEX IF NOT EXISTS idx_deployment_paths_verified_at 
ON deployment_paths(verified_at DESC);

-- 프로젝트별 최근 빌드 조회 (프로젝트명 + 빌드 날짜 내림차순)
CREATE INDEX IF NOT EXISTS idx_deployment_paths_project_recent 
ON deployment_paths(project_name, build_date DESC);

-- 파일명 검색을 위한 GIN 인덱스 (JSONB 배열 검색)
CREATE INDEX IF NOT EXISTS idx_deployment_paths_files_gin 
ON deployment_paths USING gin(all_files);