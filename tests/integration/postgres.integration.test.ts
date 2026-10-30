import { buildApiServer } from '@tibia-idle/api';
import { ReadinessResponseSchema } from '@tibia-idle/contracts';
import {
  applyMigrations,
  checkDatabaseHealth,
  computeMigrationChecksum,
  createDatabasePool,
  loadMigrationsFromDir,
  resolveTestDatabaseConfig
} from '@tibia-idle/database';
import { describe, expect, it } from 'vitest';

describe('PostgreSQL live database integration', () => {
  it('connects to PostgreSQL, applies migrations idempotently, verifies checksums, and backs /ready', async () => {
    const dbConfig = resolveTestDatabaseConfig(process.env);
    const pool = createDatabasePool(dbConfig);

    try {
      const healthy = await checkDatabaseHealth(pool);
      expect(healthy).toBe(true);

      await pool.query(
        'DROP TABLE IF EXISTS characters, sessions, users, schema_migrations CASCADE'
      );

      const migrations = loadMigrationsFromDir();
      const firstRun = await applyMigrations(pool, migrations);
      expect(firstRun).toEqual(['0001_schema_migrations', '0002_auth_sessions_characters']);

      const secondRun = await applyMigrations(pool, migrations);
      expect(secondRun).toEqual([]);

      const ledgerRows = await pool.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations ORDER BY version ASC'
      );
      expect(ledgerRows.rows).toHaveLength(2);
      expect(ledgerRows.rows[0]?.version).toBe('0001_schema_migrations');
      expect(ledgerRows.rows[0]?.checksum).toBe(migrations[0]?.checksum);
      expect(ledgerRows.rows[1]?.version).toBe('0002_auth_sessions_characters');
      expect(ledgerRows.rows[1]?.checksum).toBe(migrations[1]?.checksum);

      const tamperedMigrations = [
        {
          version: '0001_schema_migrations',
          filename: '0001_schema_migrations.sql',
          sql: '-- tampered sql',
          checksum: computeMigrationChecksum('-- tampered sql')
        },
        {
          version: '0003_rollback_check',
          filename: '0003_rollback_check.sql',
          sql: 'CREATE TABLE rollback_probe_table (id INT PRIMARY KEY);',
          checksum: computeMigrationChecksum(
            'CREATE TABLE rollback_probe_table (id INT PRIMARY KEY);'
          )
        }
      ];

      await expect(applyMigrations(pool, tamperedMigrations)).rejects.toThrow(
        /Checksum mismatch for already-applied migration 0001_schema_migrations/
      );

      const probeCheck = await pool.query<{ exists: string | null }>(
        "SELECT to_regclass('public.rollback_probe_table') AS exists"
      );
      expect(probeCheck.rows[0]?.exists).toBeNull();

      const liveApi = buildApiServer({
        checkDatabaseReady: async () => ((await checkDatabaseHealth(pool)) ? 'up' : 'down')
      });
      const liveUrl = await liveApi.listen({ host: '127.0.0.1', port: 0 });
      try {
        const resUp = await fetch(`${liveUrl}/ready`);
        expect(resUp.status).toBe(200);
        const bodyUp = ReadinessResponseSchema.parse(await resUp.json());
        expect(bodyUp.status).toBe('ready');
        expect(bodyUp.database).toBe('up');
      } finally {
        await liveApi.close();
      }

      const deadPool = createDatabasePool({
        connectionString: 'postgresql://tibia_idle:tibia_idle_dev@127.0.0.1:59999/tibia_idle_test',
        maxConnections: 1,
        connectionTimeoutMs: 500
      });
      try {
        const deadHealthy = await checkDatabaseHealth(deadPool);
        expect(deadHealthy).toBe(false);

        const deadApi = buildApiServer({
          checkDatabaseReady: async () => ((await checkDatabaseHealth(deadPool)) ? 'up' : 'down')
        });
        const deadUrl = await deadApi.listen({ host: '127.0.0.1', port: 0 });
        try {
          const resDown = await fetch(`${deadUrl}/ready`);
          expect(resDown.status).toBe(503);
          const bodyDown = ReadinessResponseSchema.parse(await resDown.json());
          expect(bodyDown.status).toBe('degraded');
          expect(bodyDown.database).toBe('down');
        } finally {
          await deadApi.close();
        }
      } finally {
        await deadPool.end();
      }
    } finally {
      await pool.end();
    }
  });
});
