-- Migration: 005_create_nas_artifacts.sql
-- NAS 스캔 결과 저장용 테이블 생성

-- NAS 스캔 아티팩트 테이블
CREATE TABLE IF NOT EXISTS nas_artifacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 파일 기본 정보
    filename VARCHAR(255) NOT NULL,
    full_path VARCHAR(1000) NOT NULL UNIQUE,
    nas_path VARCHAR(1000) NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    file_hash VARCHAR(64), -- SHA256 해시 (향후 사용)
    
    -- 버전 정보
    version VARCHAR(50) NOT NULL,
    version_folder VARCHAR(100) NOT NULL,
    build_date VARCHAR(10) NOT NULL, -- YYMMDD 형식
    build_number VARCHAR(20) NOT NULL,
    
    -- 파일 분류
    file_type VARCHAR(20) NOT NULL CHECK (file_type IN ('main', 'morrow', 'fullstack', 'frontend', 'backend', 'other')),
    
    -- NAS 정보
    modified_time TIMESTAMP WITH TIME ZONE,
    is_available BOOLEAN DEFAULT true,
    
    -- 스캔 정보
    scanned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_verified_at TIMESTAMP WITH TIME ZONE,
    scan_type VARCHAR(20) DEFAULT 'full' CHECK (scan_type IN ('full', 'incremental', 'verification')),
    
    -- 메타데이터
    search_path VARCHAR(1000),
    verified BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- NAS 스캔 로그 테이블
CREATE TABLE IF NOT EXISTS nas_scan_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 스캔 기본 정보
    scan_type VARCHAR(20) NOT NULL CHECK (scan_type IN ('full', 'incremental', 'verification')),
    scan_status VARCHAR(20) NOT NULL CHECK (scan_status IN ('running', 'completed', 'failed', 'cancelled')),
    
    -- 스캔 결과
    total_count INTEGER DEFAULT 0,
    new_files_count INTEGER DEFAULT 0,
    updated_files_count INTEGER DEFAULT 0,
    deleted_files_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    
    -- 성능 정보
    scan_duration INTEGER, -- 밀리초
    scanned_versions INTEGER DEFAULT 0,
    
    -- 오류 정보
    errors JSONB,
    
    -- 스캔 범위
    target_versions TEXT[], -- 특정 버전만 스캔하는 경우
    scan_options JSONB, -- 스캔 옵션
    
    -- 시간 정보
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_nas_artifacts_version ON nas_artifacts(version);
CREATE INDEX IF NOT EXISTS idx_nas_artifacts_file_type ON nas_artifacts(file_type);
CREATE INDEX IF NOT EXISTS idx_nas_artifacts_build_date ON nas_artifacts(build_date DESC);
CREATE INDEX IF NOT EXISTS idx_nas_artifacts_scanned_at ON nas_artifacts(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_nas_artifacts_version_build ON nas_artifacts(version, build_date DESC, build_number DESC);
CREATE INDEX IF NOT EXISTS idx_nas_artifacts_full_path ON nas_artifacts(full_path);
CREATE INDEX IF NOT EXISTS idx_nas_artifacts_filename ON nas_artifacts(filename);
CREATE INDEX IF NOT EXISTS idx_nas_artifacts_is_available ON nas_artifacts(is_available);
CREATE INDEX IF NOT EXISTS idx_nas_artifacts_modified_time ON nas_artifacts(modified_time DESC);

-- 복합 인덱스 (자주 사용되는 쿼리 최적화)
CREATE INDEX IF NOT EXISTS idx_nas_artifacts_version_type ON nas_artifacts(version, file_type);
CREATE INDEX IF NOT EXISTS idx_nas_artifacts_latest_builds ON nas_artifacts(version, build_date DESC, build_number DESC, file_type);

-- 스캔 로그 인덱스
CREATE INDEX IF NOT EXISTS idx_nas_scan_logs_started_at ON nas_scan_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_nas_scan_logs_scan_type ON nas_scan_logs(scan_type);
CREATE INDEX IF NOT EXISTS idx_nas_scan_logs_scan_status ON nas_scan_logs(scan_status);
CREATE INDEX IF NOT EXISTS idx_nas_scan_logs_type_status ON nas_scan_logs(scan_type, scan_status);

-- 업데이트 트리거
CREATE TRIGGER update_nas_artifacts_updated_at BEFORE UPDATE ON nas_artifacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 파티션 준비 (향후 확장 - 댓글로 남김)
-- CREATE TABLE nas_artifacts_2024 PARTITION OF nas_artifacts FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
-- CREATE TABLE nas_artifacts_2025 PARTITION OF nas_artifacts FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

-- 뷰 생성: 최신 빌드 아티팩트
CREATE OR REPLACE VIEW latest_nas_artifacts AS
SELECT DISTINCT ON (version, file_type)
    id, filename, full_path, version, file_type, build_date, build_number,
    file_size, modified_time, scanned_at
FROM nas_artifacts
WHERE is_available = true
ORDER BY version, file_type, build_date DESC, build_number DESC, scanned_at DESC;

-- 뷰 생성: 버전별 통계
CREATE OR REPLACE VIEW nas_artifacts_stats AS
SELECT 
    version,
    COUNT(*) as total_files,
    COUNT(DISTINCT file_type) as file_types_count,
    SUM(file_size) as total_size,
    MAX(scanned_at) as last_scanned,
    COUNT(DISTINCT build_date) as build_dates_count,
    MAX(build_date) as latest_build_date
FROM nas_artifacts
WHERE is_available = true
GROUP BY version
ORDER BY version;

-- 코멘트 추가
COMMENT ON TABLE nas_artifacts IS 'NAS 서버에서 스캔된 아티팩트 파일 정보';
COMMENT ON TABLE nas_scan_logs IS 'NAS 스캔 실행 로그 및 통계';
COMMENT ON VIEW latest_nas_artifacts IS '각 버전/타입별 최신 아티팩트';
COMMENT ON VIEW nas_artifacts_stats IS '버전별 아티팩트 통계';