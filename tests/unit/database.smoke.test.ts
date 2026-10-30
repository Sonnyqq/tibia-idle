import {
  computeMigrationChecksum,
  loadMigrationsFromDir,
  parseDatabaseConfig,
  validateMigrationsOrder
} from '@tibia-idle/database';
import { describe, expect, it } from 'vitest';

describe('@tibia-idle/database smoke tests', () => {
  it('parses valid PostgreSQL DATABASE_URL and rejects non-postgres protocols', () => {
    expect(parseDatabaseConfig({})).toBeNull();
    const cfg = parseDatabaseConfig({
      DATABASE_URL: 'postgresql://tibia_idle:secret@127.0.0.1:5432/tibia_idle_test'
    });
    expect(cfg?.connectionString).toContain('postgresql://');

    expect(() =>
      parseDatabaseConfig({
        DATABASE_URL: 'mysql://root@127.0.0.1:3306/db'
      })
    ).toThrow(/postgres/);
  });

  it('loads and validates ordered SQL migrations with deterministic checksums', () => {
    const migrations = loadMigrationsFromDir();
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0]?.version).toBe('0001_schema_migrations');
    expect(migrations[0]?.checksum).toBe(computeMigrationChecksum(migrations[0]?.sql ?? ''));

    expect(() =>
      validateMigrationsOrder([
        {
          version: '0002_second',
          filename: '0002_second.sql',
          sql: 'SELECT 1;',
          checksum: 'abc'
        },
        {
          version: '0001_first',
          filename: '0001_first.sql',
          sql: 'SELECT 1;',
          checksum: 'abc'
        }
      ])
    ).toThrow(/out of order/);
  });
});
