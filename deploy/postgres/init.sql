-- PostgreSQL init script (run on first container start)
-- Enables required extensions and configures sensible defaults.

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";        -- for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";         -- for fast LIKE/ILIKE searches
CREATE EXTENSION IF NOT EXISTS "btree_gin";       -- for composite indexes
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- for query performance monitoring

-- Connection settings (also set in postgresql.conf, but ensure here)
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '512MB';
ALTER SYSTEM SET effective_cache_size = '2GB';
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET maintenance_work_mem = '128MB';
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- log queries > 1s
ALTER SYSTEM SET log_checkpoints = on;
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;
ALTER SYSTEM SET log_line_prefix = '%t [%p]: user=%u,db=%d,app=%a,client=%h ';

-- Reload to apply
SELECT pg_reload_conf();
