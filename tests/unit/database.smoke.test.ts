import {
  computeMigrationChecksum,
  loadMigrationsFromDir,
  mapActiveHuntDto,
  parseDatabaseConfig,
  type PublicHuntSessionView,
  resolveTestDatabaseConfig,
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

    expect(() =>
      resolveTestDatabaseConfig({
        REQUIRE_DB_TESTS: '1'
      })
    ).toThrow(/REQUIRE_DB_TESTS=1 requires explicit DATABASE_URL/);
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

  it('correctly maps authoritative frozen maxHp and maxMp for high-level Knight (lvl 20 and lvl 100)', () => {
    const baseMockHuntView = (overrides: Partial<PublicHuntSessionView>): PublicHuntSessionView => ({
      huntId: '00000000-0000-0000-0000-000000000001',
      characterId: '00000000-0000-0000-0000-000000000002',
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      status: 'ACTIVE',
      stopReason: null,
      startedAtIso: new Date(1_000_000).toISOString(),
      settledUntilIso: new Date(1_000_000).toISOString(),
      stopRequestedAtIso: null,
      completedAtIso: null,
      simulationVersion: '1.0.0',
      configDigest: 'digest-test',
      reservedHpPotions: 50,
      reservedMpPotions: 50,
      potionsReturned: false,
      rowVersion: 1,
      checkpointView: {
        simulationVersion: '1.0.0',
        configDigest: 'digest-test',
        zoneId: 'damp-catacombs',
        strategy: 'balanced',
        elapsedMs: 0,
        currentHp: 435,
        currentMp: 130,
        hpPotionsRemaining: 50,
        mpPotionsRemaining: 50,
        nextPassiveRegenInMs: 2000,
        respawnCooldownRemainingMs: 0,
        activeEncounter: null,
        totalKills: 0,
        killsByMonster: {},
        totalXpGained: 0, // Notice totalXpGained is 0! Level must come from snapshot, not totalXpGained
        totalGoldGained: 0,
        totalLootByItem: {},
        totalDamageDealt: 0,
        totalDamageTaken: 0,
        hpPotionsUsed: 0,
        mpPotionsUsed: 0,
        brutalStrikesCast: 0,
        terminated: false,
        stopReason: null
      },
      ...overrides
    });

    // Level 20 Knight (Max HP: 150 + 19 * 15 = 435, Max MP: 35 + 19 * 5 = 130)
    const lvl20HuntView = baseMockHuntView({
      snapshotLevel: 20,
      snapshotMaxHp: 435,
      snapshotMaxMp: 130,
      checkpointView: {
        ...baseMockHuntView({}).checkpointView,
        currentHp: 435,
        currentMp: 130,
        totalXpGained: 0
      }
    });

    const lvl20Dto = mapActiveHuntDto(lvl20HuntView, 1_060_000);
    expect(lvl20Dto.maxHp).toBe(435);
    expect(lvl20Dto.hp).toBe(435);
    expect(lvl20Dto.maxMp).toBe(130);
    expect(lvl20Dto.mp).toBe(130);
    expect(lvl20Dto.hp).toBeLessThanOrEqual(lvl20Dto.maxHp);
    expect(lvl20Dto.mp).toBeLessThanOrEqual(lvl20Dto.maxMp);

    // Level 100 Knight (Max HP: 150 + 99 * 15 = 1635, Max MP: 35 + 99 * 5 = 530)
    const lvl100HuntView = baseMockHuntView({
      snapshotLevel: 100,
      snapshotMaxHp: 1635,
      snapshotMaxMp: 530,
      checkpointView: {
        ...baseMockHuntView({}).checkpointView,
        currentHp: 1635,
        currentMp: 530,
        totalXpGained: 0
      }
    });

    const lvl100Dto = mapActiveHuntDto(lvl100HuntView, 1_060_000);
    expect(lvl100Dto.maxHp).toBe(1635);
    expect(lvl100Dto.hp).toBe(1635);
    expect(lvl100Dto.maxMp).toBe(530);
    expect(lvl100Dto.mp).toBe(530);
    expect(lvl100Dto.hp).toBeLessThanOrEqual(lvl100Dto.maxHp);
    expect(lvl100Dto.mp).toBeLessThanOrEqual(lvl100Dto.maxMp);

    // Clamping test: hp never exceeds maxHp even if checkpoint currentHp is corrupted/anomalous
    const anomalousHuntView = baseMockHuntView({
      snapshotLevel: 20,
      snapshotMaxHp: 435,
      snapshotMaxMp: 130,
      checkpointView: {
        ...baseMockHuntView({}).checkpointView,
        currentHp: 9999,
        currentMp: 9999
      }
    });
    const clampedDto = mapActiveHuntDto(anomalousHuntView, 1_060_000);
    expect(clampedDto.hp).toBe(435);
    expect(clampedDto.maxHp).toBe(435);
    expect(clampedDto.mp).toBe(130);
    expect(clampedDto.maxMp).toBe(130);
  });
});
