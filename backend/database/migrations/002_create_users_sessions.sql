-- Migration: 002_create_users_sessions.sql
-- 사용자 인증 및 세션 관련 테이블 생성

-- 사용자 테이블 (LDAP 연동)
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

-- 사용자 세션 테이블 (JWT Refresh 토큰 관리)
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

-- 감사 로그 테이블 (사용자 활동 추적)
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
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login DESC);

-- 세션 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token_hash ON user_sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_accessed ON user_sessions(last_accessed DESC);

-- 감사 로그 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_expires ON user_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action ON audit_logs(user_id, action);

-- 트리거 설정
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 만료된 세션 자동 정리 함수
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 사용자 마지막 로그인 시간 업데이트 함수
CREATE OR REPLACE FUNCTION update_user_last_login(user_uuid UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE users
    SET last_login = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = user_uuid;
END;
$$ LANGUAGE plpgsql;

-- 감사 로그 생성 함수
CREATE OR REPLACE FUNCTION create_audit_log(
    p_user_id UUID,
    p_username VARCHAR(100),
    p_action VARCHAR(50),
    p_resource_type VARCHAR(50) DEFAULT NULL,
    p_resource_id VARCHAR(255) DEFAULT NULL,
    p_old_values JSONB DEFAULT NULL,
    p_new_values JSONB DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    log_id UUID;
BEGIN
    INSERT INTO audit_logs (
        user_id, username, action, resource_type, resource_id,
        old_values, new_values, ip_address, user_agent
    ) VALUES (
        p_user_id, p_username, p_action, p_resource_type, p_resource_id,
        p_old_values, p_new_values, p_ip_address, p_user_agent
    ) RETURNING id INTO log_id;

    RETURN log_id;
END;
$$ LANGUAGE plpgsql;

-- 뷰 생성: 활성 사용자 세션
CREATE OR REPLACE VIEW active_user_sessions AS
SELECT
    us.id,
    us.user_id,
    u.username,
    u.full_name,
    us.created_at,
    us.last_accessed,
    us.expires_at,
    us.ip_address,
    us.user_agent
FROM user_sessions us
JOIN users u ON us.user_id = u.id
WHERE us.expires_at > CURRENT_TIMESTAMP
ORDER BY us.last_accessed DESC;

-- 뷰 생성: 사용자 활동 통계
CREATE OR REPLACE VIEW user_activity_stats AS
SELECT
    u.id,
    u.username,
    u.full_name,
    u.department,
    u.last_login,
    COUNT(DISTINCT us.id) as active_sessions,
    COUNT(DISTINCT al.id) as total_actions,
    COUNT(CASE WHEN al.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours' THEN 1 END) as actions_today
FROM users u
LEFT JOIN user_sessions us ON u.id = us.user_id AND us.expires_at > CURRENT_TIMESTAMP
LEFT JOIN audit_logs al ON u.id = al.user_id AND al.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
WHERE u.is_active = true
GROUP BY u.id, u.username, u.full_name, u.department, u.last_login
ORDER BY u.last_login DESC NULLS LAST;

-- 정리 작업을 위한 스케줄 설정 (pg_cron 확장이 있는 경우)
-- SELECT cron.schedule('cleanup-expired-sessions', '0 */6 * * *', 'SELECT cleanup_expired_sessions();');

-- 테이블 코멘트
COMMENT ON TABLE users IS 'LDAP 연동 사용자 정보';
COMMENT ON TABLE user_sessions IS 'JWT Refresh 토큰 및 세션 관리';
COMMENT ON TABLE audit_logs IS '사용자 활동 감사 로그';

-- 컬럼 코멘트
COMMENT ON COLUMN users.username IS 'LDAP 사용자명 (로그인 ID)';
COMMENT ON COLUMN users.is_active IS '계정 활성화 상태';
COMMENT ON COLUMN user_sessions.refresh_token_hash IS 'bcrypt 해시된 refresh 토큰';
COMMENT ON COLUMN user_sessions.expires_at IS 'refresh 토큰 만료 시간';
COMMENT ON COLUMN audit_logs.action IS '사용자 액션 (login, logout, view, create, update, delete 등)';
COMMENT ON COLUMN audit_logs.resource_type IS '리소스 타입 (deployment, project, user 등)';

-- 보안 설정: RLS (Row Level Security) 설정 예시
-- ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY user_sessions_policy ON user_sessions FOR ALL TO authenticated_user USING (user_id = current_user_id());