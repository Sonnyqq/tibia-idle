import {
  applyMigrations,
  checkDatabaseHealth,
  createDatabasePool,
  loadMigrationsFromDir,
  parseDatabaseConfig
} from '@tibia-idle/database';
import { describe, expect, it } from 'vitest';

const dbConfig = parseDatabaseConfig(process.env);
const requireDbTests = process.env['REQUIRE_DB_TESTS'] === '1';

describe('PostgreSQL live database integration', () => {
  it.skipIf(!dbConfig && !requireDbTests)(
    'connects to PostgreSQL and applies idempotent 0001_schema_migrations',
    async () => {
      if (!dbConfig) {
        throw new Error('REQUIRE_DB_TESTS=1 is set, but DATABASE_URL is missing');
      }
      const pool = createDatabasePool(dbConfig);
      try {
        const healthy = await checkDatabaseHealth(pool);
        expect(healthy).toBe(true);

        const migrations = loadMigrationsFromDir();
        await applyMigrations(pool, migrations);
        const secondRun = await applyMigrations(pool, migrations);
        expect(secondRun).toEqual([]);
      } finally {
        await pool.end();
      }
    }
  );
});
