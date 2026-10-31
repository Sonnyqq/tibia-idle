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
        'DROP TABLE IF EXISTS inventory_movements, inventory_instances, inventory_containers, currency_ledger, hunt_reward_items, hunt_segments, hunts, characters, sessions, users, schema_migrations CASCADE'
      );

      const migrations = loadMigrationsFromDir();
      expect(migrations.map((m) => m.version)).toEqual([
        '0001_schema_migrations',
        '0002_auth_sessions_characters',
        '0003_persistent_offline_hunts',
        '0004_persistent_inventory_backpack'
      ]);

      // 1. Test incremental upgrade on a database that already has existing characters from 0002
      const pre0003 = migrations.slice(0, 2);
      const step1Run = await applyMigrations(pool, pre0003);
      expect(step1Run).toEqual(['0001_schema_migrations', '0002_auth_sessions_characters']);

      const preUserId = '11111111-1111-4111-8111-111111111111';
      const preCharId = '22222222-2222-4222-8222-222222222222';
      await pool.query(
        `INSERT INTO users (id, email, email_normalized, password_hash, locale)
         VALUES ($1, 'legacy@example.com', 'legacy@example.com', 'hash', 'pl')`,
        [preUserId]
      );
      await pool.query(
        `INSERT INTO characters (
           id, user_id, slot_number, name, name_normalized, vocation,
           level, xp, hp, max_hp, mp, max_mp, gold,
           skill_melee, skill_distance, skill_magic, skill_shielding
         )
         VALUES ($1, $2, 1, 'Legacy Knight', 'legacy knight', 'knight', 1, 0, 185, 185, 40, 40, 100, 15, 10, 1, 15)`,
        [preCharId, preUserId]
      );

      const step2Run = await applyMigrations(pool, migrations);
      expect(step2Run).toEqual([
        '0003_persistent_offline_hunts',
        '0004_persistent_inventory_backpack'
      ]);

      // Verify existing character received one-time starter potion supplies, backfilled currency_ledger, and 20-slot backpack
      const migratedChar = await pool.query<{
        hp_potions: number;
        mp_potions: number;
        starter_supplies_granted_at: Date | null;
      }>(
        'SELECT hp_potions, mp_potions, starter_supplies_granted_at FROM characters WHERE id = $1',
        [preCharId]
      );
      expect(migratedChar.rows[0]?.hp_potions).toBe(250);
      expect(migratedChar.rows[0]?.mp_potions).toBe(150);
      expect(migratedChar.rows[0]?.starter_supplies_granted_at).toBeInstanceOf(Date);

      const migratedLedger = await pool.query<{
        source_type: string;
        amount: string;
        balance_after: string;
      }>('SELECT source_type, amount, balance_after FROM currency_ledger WHERE character_id = $1', [
        preCharId
      ]);
      expect(migratedLedger.rows).toHaveLength(1);
      expect(migratedLedger.rows[0]).toEqual({
        source_type: 'CHARACTER_INITIAL_GRANT',
        amount: '100',
        balance_after: '100'
      });

      const migratedBackpack = await pool.query<{
        container_type: string;
        slot_capacity: number;
      }>('SELECT container_type, slot_capacity FROM inventory_containers WHERE character_id = $1', [
        preCharId
      ]);
      expect(migratedBackpack.rows).toHaveLength(1);
      expect(migratedBackpack.rows[0]).toEqual({
        container_type: 'backpack',
        slot_capacity: 20
      });

      // 2. Test clean migration from empty database + idempotent re-run
      await pool.query(
        'DROP TABLE IF EXISTS inventory_movements, inventory_instances, inventory_containers, currency_ledger, hunt_reward_items, hunt_segments, hunts, characters, sessions, users, schema_migrations CASCADE'
      );

      const firstRun = await applyMigrations(pool, migrations);
      expect(firstRun).toEqual([
        '0001_schema_migrations',
        '0002_auth_sessions_characters',
        '0003_persistent_offline_hunts',
        '0004_persistent_inventory_backpack'
      ]);

      const secondRun = await applyMigrations(pool, migrations);
      expect(secondRun).toEqual([]);

      const ledgerRows = await pool.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations ORDER BY version ASC'
      );
      expect(ledgerRows.rows).toHaveLength(4);
      expect(ledgerRows.rows[0]?.version).toBe('0001_schema_migrations');
      expect(ledgerRows.rows[0]?.checksum).toBe(migrations[0]?.checksum);
      expect(ledgerRows.rows[1]?.version).toBe('0002_auth_sessions_characters');
      expect(ledgerRows.rows[1]?.checksum).toBe(migrations[1]?.checksum);
      expect(ledgerRows.rows[2]?.version).toBe('0003_persistent_offline_hunts');
      expect(ledgerRows.rows[2]?.checksum).toBe(migrations[2]?.checksum);
      expect(ledgerRows.rows[3]?.version).toBe('0004_persistent_inventory_backpack');
      expect(ledgerRows.rows[3]?.checksum).toBe(migrations[3]?.checksum);

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
