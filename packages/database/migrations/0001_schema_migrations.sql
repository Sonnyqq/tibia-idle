-- 0001_schema_migrations.sql
-- Bootstrap migration ledger table for versioned PostgreSQL migrations (P01 scaffold).
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
