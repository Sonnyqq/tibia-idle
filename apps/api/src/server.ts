import {
  applyMigrations,
  checkDatabaseHealth,
  createDatabasePool,
  loadMigrationsFromDir,
  parseDatabaseConfig
} from '@tibia-idle/database';
import { buildApiServer } from './app.js';

const port = Number(process.env['PORT'] ?? '3001');
const host = process.env['HOST'] ?? '127.0.0.1';

const dbConfig = parseDatabaseConfig(process.env);
const pool = dbConfig ? createDatabasePool(dbConfig) : null;

if (pool) {
  const migrations = loadMigrationsFromDir();
  await applyMigrations(pool, migrations);
}

const app = buildApiServer({
  logger: true,
  dbPool: pool,
  checkDatabaseReady: async () => {
    if (!pool) return 'unconfigured';
    const ok = await checkDatabaseHealth(pool);
    return ok ? 'up' : 'down';
  }
});

const shutdown = async () => {
  await app.close();
  if (pool) {
    await pool.end();
  }
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ port, host });
