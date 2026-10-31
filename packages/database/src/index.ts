import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export {
  type ActiveSessionRecord,
  type CreateCharacterDbResult,
  createCharacterTransactional,
  createSessionRecord,
  createUserAccount,
  findActiveSessionByTokenHash,
  findCharacterByIdForUser,
  findUserByEmail,
  listCharactersForUser,
  revokeSessionByTokenHash,
  type StoredUserRecord,
  updateUserLocale
} from './auth-repository.js';
export {
  type ExtendedCharacterDto,
  getActiveHuntForCharacter,
  getCharacterHuntRewardItems,
  getHuntByIdForUser,
  getHuntSegmentsWithSummary,
  type HuntStatus,
  mapActiveHuntDto,
  type PersistedHuntStopReason,
  type PublicHuntSessionView,
  reconcileCharacterEconomy,
  type ReconcileCharacterEconomyReport,
  type SettleHuntInput,
  type SettleHuntResult,
  settleHunt,
  type SettlementFaultInjectionHook,
  type SettlementFaultStage,
  type SettlementSegmentRewardsSummary,
  type SettlementTelemetry,
  type StartHuntInput,
  type StartHuntResult,
  startHunt,
  type StopHuntInput,
  type StopHuntResult,
  stopHunt
} from './hunt-repository.js';
export {
  type ClaimHuntRewardInput,
  type ClaimHuntRewardResult,
  claimHuntReward,
  getCharacterContainers,
  getCharacterInventory,
  type InventoryContainerDbRow,
  type InventoryInstanceDbRow,
  type MoveInventoryItemInput,
  type MoveInventoryItemResult,
  moveInventoryItem,
  type SplitInventoryStackInput,
  type SplitInventoryStackResult,
  splitInventoryStack
} from './inventory-repository.js';

export interface DatabaseConfig {
  connectionString: string;
  maxConnections: number;
  connectionTimeoutMs: number;
}

export interface MigrationDefinition {
  version: string;
  filename: string;
  sql: string;
  checksum: string;
}

export const DEFAULT_LOCAL_DATABASE_URL =
  'postgresql://tibia_idle:tibia_idle_dev@127.0.0.1:5432/tibia_idle_test';

export function parseDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig | null {
  const rawUrl = env['DATABASE_URL']?.trim();
  if (!rawUrl) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid DATABASE_URL format');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgres:// or postgresql:// protocol');
  }
  return {
    connectionString: rawUrl,
    maxConnections: 10,
    connectionTimeoutMs: 5000
  };
}

export function resolveTestDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const explicit = parseDatabaseConfig(env);
  if (explicit) {
    return explicit;
  }
  if (env['REQUIRE_DB_TESTS'] === '1') {
    throw new Error('REQUIRE_DB_TESTS=1 requires explicit DATABASE_URL environment variable');
  }
  return {
    connectionString: DEFAULT_LOCAL_DATABASE_URL,
    maxConnections: 10,
    connectionTimeoutMs: 5000
  };
}

export function createDatabasePool(config: DatabaseConfig): pg.Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections,
    connectionTimeoutMillis: config.connectionTimeoutMs
  });
}

export async function checkDatabaseHealth(pool: pg.Pool): Promise<boolean> {
  try {
    const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

export function computeMigrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export function validateMigrationsOrder(migrations: readonly MigrationDefinition[]): void {
  const seenVersions = new Set<string>();
  let previousVersion = '';
  for (const migration of migrations) {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(migration.filename)) {
      throw new Error(`Invalid migration filename format: ${migration.filename}`);
    }
    if (seenVersions.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    if (previousVersion && migration.version <= previousVersion) {
      throw new Error(`Migrations out of order: ${migration.version} after ${previousVersion}`);
    }
    seenVersions.add(migration.version);
    previousVersion = migration.version;
  }
}

export function loadMigrationsFromDir(
  migrationsDir: string = resolve(import.meta.dirname, '../migrations')
): MigrationDefinition[] {
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const definitions = files.map((filename) => {
    const sql = readFileSync(resolve(migrationsDir, filename), 'utf8');
    const version = filename.replace(/\.sql$/, '');
    return {
      version,
      filename,
      sql,
      checksum: computeMigrationChecksum(sql)
    };
  });

  validateMigrationsOrder(definitions);
  return definitions;
}

export async function applyMigrations(
  pool: pg.Pool,
  migrations: readonly MigrationDefinition[]
): Promise<string[]> {
  validateMigrationsOrder(migrations);
  const client = await pool.connect();
  const appliedNow: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(74219001)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const existing = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version ASC'
    );
    const existingMap = new Map(existing.rows.map((r) => [r.version, r.checksum]));

    for (const migration of migrations) {
      const priorChecksum = existingMap.get(migration.version);
      if (priorChecksum !== undefined) {
        if (priorChecksum !== migration.checksum) {
          throw new Error(`Checksum mismatch for already-applied migration ${migration.version}`);
        }
        continue;
      }
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
        migration.version,
        migration.checksum
      ]);
      appliedNow.push(migration.version);
    }

    await client.query('COMMIT');
    return appliedNow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
