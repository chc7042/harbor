-- Migration: 005_remove_user_sessions.sql
-- Purpose: Remove user_sessions table and related objects to simplify authentication
-- Description: This migration removes the complex session management system and related infrastructure
--              as part of simplifying authentication to LDAP + simple JWT only.

BEGIN;

-- Drop dependent views first
DROP VIEW IF EXISTS active_user_sessions CASCADE;

-- Drop functions that depend on user_sessions table
DROP FUNCTION IF EXISTS cleanup_expired_sessions() CASCADE;

-- Drop scheduled jobs (if using pg_cron)
-- This is commented out as pg_cron extension might not be available
-- SELECT cron.unschedule('cleanup-expired-sessions') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-sessions');

-- Drop foreign key constraints first
ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS fk_user_sessions_user CASCADE;

-- Drop indexes
DROP INDEX IF EXISTS idx_user_sessions_user_id;
DROP INDEX IF EXISTS idx_user_sessions_expires_at;
DROP INDEX IF EXISTS idx_user_sessions_refresh_token_hash;
DROP INDEX IF EXISTS idx_user_sessions_last_accessed;
DROP INDEX IF EXISTS idx_user_sessions_user_expires;

-- Drop the user_sessions table
DROP TABLE IF EXISTS user_sessions CASCADE;

-- Remove session-related system settings
DELETE FROM system_settings WHERE key IN (
    'session_timeout',
    'max_sessions_per_user',
    'session_cleanup_interval',
    'refresh_token_expires_in'
);

-- Add a comment about this change
INSERT INTO system_settings (key, value, description, updated_at) VALUES (
    'auth_migration_005', 
    EXTRACT(EPOCH FROM NOW())::text, 
    'Timestamp when user_sessions table was removed for authentication simplification',
    NOW()
) ON CONFLICT (key) DO UPDATE SET 
    value = EXTRACT(EPOCH FROM NOW())::text,
    updated_at = NOW();

COMMIT;

-- Add comments for documentation
COMMENT ON SCHEMA public IS 'Schema updated: Removed user_sessions table and related objects for simplified JWT authentication';