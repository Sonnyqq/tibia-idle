import { randomUUID } from 'node:crypto';
import { buildApiServer } from '@tibia-idle/api';
import {
  type CharacterDto,
  CharacterEquipmentResponseSchema,
  EquipItemResponseSchema,
  UnequipItemResponseSchema,
  type UserDto
} from '@tibia-idle/contracts';
import {
  applyMigrations,
  createDatabasePool,
  getCharacterContainers,
  loadMigrationsFromDir,
  resolveTestDatabaseConfig
} from '@tibia-idle/database';
import {
  createFixedClock,
  getItemDefinition
} from '@tibia-idle/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('IDLE-005B — Equipment Paperdoll & Combat Stats Integration Tests', () => {
  const dbConfig = resolveTestDatabaseConfig(process.env);
  const pool = createDatabasePool(dbConfig);

  beforeAll(async () => {
    const migrations = loadMigrationsFromDir();
    await applyMigrations(pool, migrations);
    await pool.query(
      'TRUNCATE TABLE inventory_movements, inventory_instances, inventory_containers, currency_ledger, hunt_reward_items, hunt_segments, hunts, characters, sessions, users RESTART IDENTITY CASCADE'
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createTestAccountAndCharacter(
    name: string,
    vocation: 'knight' | 'paladin' | 'sorcerer' | 'druid' = 'knight'
  ): Promise<{ user: UserDto; character: CharacterDto; sessionCookie: string; csrfToken: string }> {
    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({
      dbPool: pool,
      clock
    });
    await server.ready();

    const email = `equip_${randomUUID()}@example.com`;
    const password = 'StrongPassword123!';

    const regRes = await server.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: { email, password, locale: 'en' }
    });
    expect(regRes.statusCode).toBe(201);
    const regBody = regRes.json();
    const rawSetCookie = Array.isArray(regRes.headers['set-cookie'])
      ? regRes.headers['set-cookie'][0]
      : (regRes.headers['set-cookie'] as string);
    const sessionCookie = (rawSetCookie ?? '').split(';')[0] ?? '';
    const csrfToken = regBody.csrfToken as string;

    const charRes = await server.inject({
      method: 'POST',
      url: '/characters',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: { name, vocation }
    });
    expect(charRes.statusCode).toBe(201);
    const character = charRes.json() as CharacterDto;

    await server.close();
    return { user: regBody.user as UserDto, character, sessionCookie, csrfToken };
  }

  async function giveItemToBackpack(
    characterId: string,
    itemId: string,
    slotIndex: number,
    quantity = 1
  ): Promise<string> {
    const containers = await getCharacterContainers(pool, characterId);
    const backpack = containers.find((c) => c.containerType === 'backpack');
    if (!backpack) throw new Error('No backpack container');

    const def = getItemDefinition(itemId);
    if (!def) throw new Error(`Unknown item ${itemId}`);

    const instanceId = randomUUID();
    await pool.query(
      `INSERT INTO inventory_instances
        (id, character_id, container_id, slot_index, item_id, quantity, row_version)
       VALUES ($1, $2, $3, $4, $5, $6, 1)`,
      [instanceId, characterId, backpack.id, slotIndex, itemId, quantity]
    );

    return instanceId;
  }

  function generateTestCharName(prefix: string): string {
    const letters = randomUUID().replace(/[^a-zA-Z]/g, '').slice(0, 6);
    return `${prefix} ${letters}`;
  }

  it('1. GET /characters/:id/equipment returns empty paperdoll with baseline Knight combat stats', async () => {
    const { character, sessionCookie, csrfToken } = await createTestAccountAndCharacter(
      generateTestCharName('HeroEq'),
      'knight'
    );

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    const res = await server.inject({
      method: 'GET',
      url: `/characters/${character.id}/equipment`,
      headers: {
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      }
    });

    expect(res.statusCode).toBe(200);
    const parsed = CharacterEquipmentResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const data = parsed.data;
    expect(data.characterId).toBe(character.id);
    expect(data.activeHuntLocked).toBe(false);
    expect(data.totalEquipmentWeight).toBe(0);

    // All 9 slots must be empty
    for (const slot of ['helmet', 'amulet', 'weapon', 'armor', 'shield', 'ring', 'legs', 'boots', 'ammunition'] as const) {
      expect(data.slots[slot]).toBeNull();
    }

    // Knight baseline combat stats (18 / 16 / 10 / 50 / 1250)
    expect(data.stats.weaponAttack).toEqual({ base: 18, bonus: 0, effective: 18 });
    expect(data.stats.shieldDefense).toEqual({ base: 16, bonus: 0, effective: 16 });
    expect(data.stats.totalArmor).toEqual({ base: 10, bonus: 0, effective: 10 });
    expect(data.stats.critChancePermille).toEqual({ base: 50, bonus: 0, effective: 50 });
    expect(data.stats.critMultiplierPermille).toEqual({ base: 1250, bonus: 0, effective: 1250 });

    await server.close();
  });

  it('2. POST /characters/:id/equipment/equip equips weapon, updates combat stats and recalculates carried weight', async () => {
    const { character, sessionCookie, csrfToken } = await createTestAccountAndCharacter(
      generateTestCharName('HeroEq'),
      'knight'
    );

    // Give rusted-blade to backpack slot 0
    await giveItemToBackpack(character.id, 'rusted-blade', 0);

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    const idempotencyKey = randomUUID();
    const equipRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey
      }
    });

    expect(equipRes.statusCode).toBe(200);
    const parsed = EquipItemResponseSchema.safeParse(equipRes.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const data = parsed.data;
    expect(data.equipment.slots.weapon).not.toBeNull();
    expect(data.equipment.slots.weapon?.itemId).toBe('rusted-blade');
    expect(data.equipment.slots.weapon?.combatBonuses?.weaponAttack).toBe(4);

    // Stats: Attack 18 + 4 = 22
    expect(data.equipment.stats.weaponAttack).toEqual({ base: 18, bonus: 4, effective: 22 });
    expect(data.equipment.totalEquipmentWeight).toBe(250);

    // Backpack slot 0 should now be empty
    const bpItem = data.inventory.slots.find((s) => s.slotIndex === 0);
    expect(bpItem).toBeUndefined();

    // Total weight must still include the equipped item weight (250)
    expect(data.inventory.capacity.currentWeight).toBe(250);

    // Verify idempotency replay returns same result with idempotentReplay: true
    const replayRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey
      }
    });
    expect(replayRes.statusCode).toBe(200);
    expect(replayRes.json().idempotentReplay).toBe(true);

    await server.close();
  });

  it('3. POST /characters/:id/equipment/unequip returns weapon to backpack and restores baseline combat stats', async () => {
    const { character, sessionCookie, csrfToken } = await createTestAccountAndCharacter(
      generateTestCharName('HeroEq'),
      'knight'
    );

    // Give rusted-blade to backpack slot 0 and equip it
    await giveItemToBackpack(character.id, 'rusted-blade', 0);

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });

    // Unequip weapon to backpack slot 3
    const unequipRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        targetBackpackSlot: 3,
        idempotencyKey: randomUUID()
      }
    });

    expect(unequipRes.statusCode).toBe(200);
    const parsed = UnequipItemResponseSchema.safeParse(unequipRes.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const data = parsed.data;
    expect(data.equipment.slots.weapon).toBeNull();
    expect(data.equipment.stats.weaponAttack).toEqual({ base: 18, bonus: 0, effective: 18 });
    expect(data.equipment.totalEquipmentWeight).toBe(0);

    // Item should now be in backpack slot 3
    const bpItem = data.inventory.slots.find((s) => s.slotIndex === 3);
    expect(bpItem).toBeDefined();
    expect(bpItem?.itemId).toBe('rusted-blade');

    await server.close();
  });

  it('4. POST /characters/:id/equipment/equip swaps items if equipment slot is already occupied', async () => {
    const { character, sessionCookie, csrfToken } = await createTestAccountAndCharacter(
      generateTestCharName('HeroEq'),
      'knight'
    );

    // Put rusted-blade in backpack slot 0
    await giveItemToBackpack(character.id, 'rusted-blade', 0);

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    // 1. Equip rusted-blade into weapon slot
    await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });

    // 2. Put another rusted-blade in backpack slot 5
    await giveItemToBackpack(character.id, 'rusted-blade', 5);

    // 3. Equip backpack slot 5 into weapon slot (swap)
    const swapRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 5,
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });

    expect(swapRes.statusCode).toBe(200);
    const data = swapRes.json();
    expect(data.equipment.slots.weapon).not.toBeNull();
    // The previous weapon should now occupy backpack slot 5
    const bpItem = data.inventory.slots.find((s: { slotIndex: number }) => s.slotIndex === 5);
    expect(bpItem).toBeDefined();
    expect(bpItem.itemId).toBe('rusted-blade');

    await server.close();
  });

  it('5. Rejects invalid equipment operations: not equipment, slot mismatch, wrong vocation, backpack full', async () => {
    const { character, sessionCookie, csrfToken } = await createTestAccountAndCharacter(
      generateTestCharName('HeroEq'),
      'knight'
    );

    await giveItemToBackpack(character.id, 'copper-coin', 0, 10);
    await giveItemToBackpack(character.id, 'rusted-blade', 1);

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    // 1. Cannot equip non-equipment item
    const notEqRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });
    expect(notEqRes.statusCode).toBe(400);
    expect(notEqRes.json().error.code).toBe('NOT_EQUIPMENT');

    // 2. Slot mismatch: cannot equip weapon into helmet slot
    const mismatchRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 1,
        equipmentSlot: 'helmet',
        idempotencyKey: randomUUID()
      }
    });
    expect(mismatchRes.statusCode).toBe(400);
    expect(mismatchRes.json().error.code).toBe('SLOT_MISMATCH');

    // 3. Vocation mismatch: sorcerer cannot equip knight rusted-blade
    const sorc = await createTestAccountAndCharacter(
      generateTestCharName('Sorc'),
      'sorcerer'
    );
    await giveItemToBackpack(sorc.character.id, 'rusted-blade', 0);
    const vocRes = await server.inject({
      method: 'POST',
      url: `/characters/${sorc.character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sorc.sessionCookie,
        'x-csrf-token': sorc.csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });
    expect(vocRes.statusCode).toBe(400);
    expect(vocRes.json().error.code).toBe('VOCATION_INCOMPATIBLE');

    // 4. Unequip rejected when backpack is 100% full (20/20 slots occupied)
    const fullChar = await createTestAccountAndCharacter(
      generateTestCharName('FullChar'),
      'knight'
    );
    // Equip weapon first
    await giveItemToBackpack(fullChar.character.id, 'rusted-blade', 0);
    await server.inject({
      method: 'POST',
      url: `/characters/${fullChar.character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: fullChar.sessionCookie,
        'x-csrf-token': fullChar.csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });
    // Now fill all 20 backpack slots (0 to 19)
    for (let i = 0; i < 20; i++) {
      await giveItemToBackpack(fullChar.character.id, 'copper-coin', i, 1);
    }
    // Attempt unequip -> BACKPACK_FULL
    const unequipFullRes = await server.inject({
      method: 'POST',
      url: `/characters/${fullChar.character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: fullChar.sessionCookie,
        'x-csrf-token': fullChar.csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });
    expect(unequipFullRes.statusCode).toBe(400);
    expect(unequipFullRes.json().error.code).toBe('BACKPACK_FULL');

    await server.close();
  });

  it('6. Active hunt lock: ACTIVE_HUNT_LOCKED blocks equip and unequip during hunt', async () => {
    const { character, sessionCookie, csrfToken } = await createTestAccountAndCharacter(
      generateTestCharName('Hunter'),
      'knight'
    );

    await giveItemToBackpack(character.id, 'silver-ring', 0);

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    // Start a hunt
    const startRes = await server.inject({
      method: 'POST',
      url: '/hunts/start',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        characterId: character.id,
        zoneId: 'damp-catacombs',
        strategy: 'balanced',
        hpPotions: 0,
        mpPotions: 0,
        idempotencyKey: randomUUID()
      }
    });
    expect(startRes.statusCode).toBe(201);
    const huntId = startRes.json().hunt.huntId;

    // GET /equipment returns activeHuntLocked = true
    const eqCheck = await server.inject({
      method: 'GET',
      url: `/characters/${character.id}/equipment`,
      headers: {
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      }
    });
    expect(eqCheck.statusCode).toBe(200);
    expect(eqCheck.json().activeHuntLocked).toBe(true);

    // Attempt equip -> 409 ACTIVE_HUNT_LOCKED
    const lockedEquipRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'ring',
        idempotencyKey: randomUUID()
      }
    });
    expect(lockedEquipRes.statusCode).toBe(409);
    expect(lockedEquipRes.json().error.code).toBe('ACTIVE_HUNT_LOCKED');

    // Attempt unequip -> 409 ACTIVE_HUNT_LOCKED
    const lockedUnequipRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });
    expect(lockedUnequipRes.statusCode).toBe(409);
    expect(lockedUnequipRes.json().error.code).toBe('ACTIVE_HUNT_LOCKED');

    // Now stop hunt
    const stopRes = await server.inject({
      method: 'POST',
      url: `/hunts/${huntId}/stop`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        idempotencyKey: randomUUID()
      }
    });
    expect(stopRes.statusCode).toBe(200);

    // Equip should now succeed!
    const unlockEquipRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'ring',
        idempotencyKey: randomUUID()
      }
    });
    expect(unlockEquipRes.statusCode).toBe(200);
    expect(unlockEquipRes.json().equipment.slots.ring?.itemId).toBe('silver-ring');

    await server.close();
  });

  it('7. Idempotency key conflict returns HTTP 409 when payload changes', async () => {
    const { character, sessionCookie, csrfToken } = await createTestAccountAndCharacter(
      generateTestCharName('Idem'),
      'knight'
    );

    await giveItemToBackpack(character.id, 'silver-ring', 0);
    await giveItemToBackpack(character.id, 'ritual-amulet', 1);

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    const sharedKey = randomUUID();

    // 1. Equip silver-ring with sharedKey
    const firstRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'ring',
        idempotencyKey: sharedKey
      }
    });
    expect(firstRes.statusCode).toBe(200);

    // 2. Try to equip ritual-amulet using the SAME sharedKey but different payload -> 409 Conflict
    const conflictRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 1,
        equipmentSlot: 'amulet',
        idempotencyKey: sharedKey
      }
    });
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json().error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');

    await server.close();
  });

  it('8. IDOR Protection: User B cannot equip or unequip Character A items', async () => {
    const charA = await createTestAccountAndCharacter('Alice Hero', 'knight');
    const charB = await createTestAccountAndCharacter('Bob Hero', 'knight');

    await giveItemToBackpack(charA.character.id, 'rusted-blade', 0);

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    // User B tries to equip on Character A
    const idorEquip = await server.inject({
      method: 'POST',
      url: `/characters/${charA.character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: charB.sessionCookie,
        'x-csrf-token': charB.csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });
    expect([403, 404]).toContain(idorEquip.statusCode);

    // User B tries to unequip on Character A
    const idorUnequip = await server.inject({
      method: 'POST',
      url: `/characters/${charA.character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: charB.sessionCookie,
        'x-csrf-token': charB.csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });
    expect([403, 404]).toContain(idorUnequip.statusCode);

    await server.close();
  });

  it('9. Weight check: equipping heavy weapon restricts reward claim if max weight exceeded', async () => {
    const { character, sessionCookie, csrfToken } = await createTestAccountAndCharacter(
      'Weight Knight',
      'knight'
    );

    // Give rusted-blade (250) to backpack and equip it
    await giveItemToBackpack(character.id, 'rusted-blade', 0);

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });

    // Knight max capacity at level 1 is 5000.
    // Create a hunt reward of 30 rusted-blades (30 * 250 = 7500 > 5000)
    const rewardId = randomUUID();
    const huntId = randomUUID();
    const segId = randomUUID();
    await pool.query(
      `INSERT INTO hunts (id, character_id, start_idempotency_key, zone_id, strategy, status, started_at, settled_until, completed_at, simulation_version, config_digest, private_checkpoint, reserved_hp_potions, reserved_mp_potions, potions_returned)
       VALUES ($1, $2, 'weight-test', 'damp-catacombs', 'balanced', 'COMPLETED', NOW(), NOW(), NOW(), '1.0.0', 'd', '{}'::jsonb, 0, 0, true)`,
      [huntId, character.id]
    );
    await pool.query(
      `INSERT INTO hunt_segments (id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version, segment_from, segment_to, processed_duration_ms, simulated_events, stop_reason, is_partial, rewards)
       VALUES ($1, $2, 'seg-1', 1, 2, NOW(), NOW(), 60000, 10, 'TIME_REACHED', false, '{}'::jsonb)`,
      [segId, huntId]
    );
    await pool.query(
      `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state)
       VALUES ($1, $2, $3, $4, 'rusted-blade', 30, 'UNCLAIMED')`,
      [rewardId, huntId, segId, character.id]
    );

    // Claim should fail with CAPACITY_EXCEEDED
    const claimRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/hunt-rewards/${rewardId}/claim`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: { idempotencyKey: randomUUID() }
    });
    expect(claimRes.statusCode).toBe(400);
    expect(claimRes.json().error.code).toBe('CAPACITY_EXCEEDED');

    await server.close();
  });

  it('10. 20 concurrent equip requests serialize safely with zero corruption', async () => {
    const { character, sessionCookie, csrfToken } = await createTestAccountAndCharacter(
      generateTestCharName('Concurrent'),
      'knight'
    );

    // Give rusted-blade to backpack slot 0
    await giveItemToBackpack(character.id, 'rusted-blade', 0);

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    // Fire 20 parallel equip calls with unique idempotency keys for the same slot 0 -> weapon
    const promises = Array.from({ length: 20 }, () =>
      server.inject({
        method: 'POST',
        url: `/characters/${character.id}/equipment/equip`,
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          'x-csrf-token': csrfToken
        },
        payload: {
          backpackSlot: 0,
          equipmentSlot: 'weapon',
          idempotencyKey: randomUUID()
        }
      })
    );

    const results = await Promise.all(promises);

    // Exactly one should succeed with 200, the remaining should fail (e.g. SLOT_EMPTY because slot 0 was emptied)
    const successes = results.filter((r) => r.statusCode === 200);
    const failures = results.filter((r) => r.statusCode === 400);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(19);

    // Check weapon slot has exactly 1 weapon and backpack has 0
    const eqCheck = await server.inject({
      method: 'GET',
      url: `/characters/${character.id}/equipment`,
      headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken }
    });
    expect(eqCheck.json().slots.weapon?.itemId).toBe('rusted-blade');

    await server.close();
  });

  it('11. P0 — Rejects out-of-range backpack slots in unequip, equip, move, split, and enforces DB trigger bounds', async () => {
    const { character, sessionCookie, csrfToken } = await createTestAccountAndCharacter(
      generateTestCharName('SlotBounds'),
      'knight'
    );

    await giveItemToBackpack(character.id, 'rusted-blade', 0);

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    // 1. Equip weapon into weapon slot
    await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });

    // Count movements before failed unequip
    const movementsBefore = await pool.query(
      `SELECT count(*) FROM inventory_movements WHERE character_id = $1`,
      [character.id]
    );

    // 2. Try unequip to slot 50 -> 400 SLOT_OUT_OF_BOUNDS
    const res50 = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        targetBackpackSlot: 50,
        idempotencyKey: randomUUID()
      }
    });
    expect(res50.statusCode).toBe(400);
    expect(res50.json().error.code).toBe('SLOT_OUT_OF_BOUNDS');
    expect(res50.json().error.messageKey).toBe('error.slotOutOfBounds');

    // 3. Try unequip to slot 20 (slot_capacity is 20, so valid slots are 0..19) -> 400 SLOT_OUT_OF_BOUNDS
    const res20 = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        targetBackpackSlot: 20,
        idempotencyKey: randomUUID()
      }
    });
    expect(res20.statusCode).toBe(400);
    expect(res20.json().error.code).toBe('SLOT_OUT_OF_BOUNDS');
    expect(res20.json().error.messageKey).toBe('error.slotOutOfBounds');

    // 4. Try unequip to slot 99 -> 400 SLOT_OUT_OF_BOUNDS
    const res99 = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        targetBackpackSlot: 99,
        idempotencyKey: randomUUID()
      }
    });
    expect(res99.statusCode).toBe(400);
    expect(res99.json().error.code).toBe('SLOT_OUT_OF_BOUNDS');

    // 5. Try unequip to slot -1 -> 400 Zod VALIDATION_FAILED
    const resMinus1 = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        targetBackpackSlot: -1,
        idempotencyKey: randomUUID()
      }
    });
    expect(resMinus1.statusCode).toBe(400);

    // Verify weapon is STILL equipped and no extra movement was created
    const eqCheck = await server.inject({
      method: 'GET',
      url: `/characters/${character.id}/equipment`,
      headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken }
    });
    expect(eqCheck.json().slots.weapon?.itemId).toBe('rusted-blade');

    const movementsAfter = await pool.query(
      `SELECT count(*) FROM inventory_movements WHERE character_id = $1`,
      [character.id]
    );
    expect(movementsAfter.rows[0].count).toBe(movementsBefore.rows[0].count);

    // 6. Unequip to slot 19 (valid edge slot) succeeds!
    const res19 = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        targetBackpackSlot: 19,
        idempotencyKey: randomUUID()
      }
    });
    expect(res19.statusCode).toBe(200);
    expect(res19.json().inventory.slots.find((s: { slotIndex: number }) => s.slotIndex === 19)?.itemId).toBe('rusted-blade');

    // 7. Equip from invalid backpackSlot 50 -> 400 SLOT_OUT_OF_BOUNDS
    const equip50 = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 50,
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });
    expect(equip50.statusCode).toBe(400);
    expect(equip50.json().error.code).toBe('SLOT_OUT_OF_BOUNDS');

    // 8. Move item with out-of-bounds toSlot 50 -> 400 SLOT_OUT_OF_BOUNDS
    const move50 = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/inventory/move`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        fromSlot: 19,
        toSlot: 50,
        idempotencyKey: randomUUID()
      }
    });
    expect(move50.statusCode).toBe(400);
    expect(move50.json().error.code).toBe('SLOT_OUT_OF_BOUNDS');

    // 9. Database trigger integrity: direct insert into inventory_instances with slot_index >= capacity is rejected
    const containersRes = await getCharacterContainers(pool, character.id);
    const backpack = containersRes.find((c) => c.containerType === 'backpack');
    const equipment = containersRes.find((c) => c.containerType === 'equipment');
    expect(backpack).toBeDefined();
    expect(equipment).toBeDefined();
    if (!backpack || !equipment) return;

    await expect(
      pool.query(
        `INSERT INTO inventory_instances (id, character_id, container_id, slot_index, item_id, quantity)
         VALUES ($1, $2, $3, $4, 'rusted-blade', 1)`,
        [randomUUID(), character.id, backpack.id, 20]
      )
    ).rejects.toThrow(/out of bounds/i);

    await expect(
      pool.query(
        `INSERT INTO inventory_instances (id, character_id, container_id, slot_index, item_id, quantity)
         VALUES ($1, $2, $3, $4, 'rusted-blade', 1)`,
        [randomUUID(), character.id, equipment.id, 9]
      )
    ).rejects.toThrow(/out of bounds/i);

    await server.close();
  });

  it('12. P1 — Idempotent replay of equip and unequip succeeds during active hunt while new changes are blocked', async () => {
    const { character, sessionCookie, csrfToken } = await createTestAccountAndCharacter(
      generateTestCharName('HuntReplay'),
      'knight'
    );

    await giveItemToBackpack(character.id, 'rusted-blade', 0);
    await giveItemToBackpack(character.id, 'silver-ring', 1);

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    // 1. Equip rusted-blade with key equip-k1
    const equipKey1 = 'equip-k1-' + randomUUID();
    const equipRes1 = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey: equipKey1
      }
    });
    expect(equipRes1.statusCode).toBe(200);
    expect(equipRes1.json().idempotentReplay).toBe(false);

    // 2. Start active hunt
    const startRes = await server.inject({
      method: 'POST',
      url: '/hunts/start',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        characterId: character.id,
        zoneId: 'damp-catacombs',
        strategy: 'balanced',
        hpPotions: 0,
        mpPotions: 0,
        idempotencyKey: randomUUID()
      }
    });
    expect(startRes.statusCode).toBe(201);
    const huntData = startRes.json().hunt;
    const huntDbRes = await pool.query<{
      private_checkpoint: {
        snapshot: { character: { equipment: { weaponAttack: number } } };
      };
    }>(
      `SELECT private_checkpoint FROM hunts WHERE id = $1`,
      [huntData.huntId]
    );
    expect(huntDbRes.rows[0]?.private_checkpoint.snapshot.character.equipment.weaponAttack).toBe(22); // rusted-blade weapon attack (22)

    // 3. Replay exact same equip request during ACTIVE hunt -> MUST return 200 idempotentReplay: true
    const replayEquipRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey: equipKey1
      }
    });
    expect(replayEquipRes.statusCode).toBe(200);
    expect(replayEquipRes.json().idempotentReplay).toBe(true);

    // 4. Same key equipKey1 with different payload -> 409 IDEMPOTENCY_KEY_CONFLICT
    const conflictEquipRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 1,
        equipmentSlot: 'ring',
        idempotencyKey: equipKey1
      }
    });
    expect(conflictEquipRes.statusCode).toBe(409);
    expect(conflictEquipRes.json().error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');

    // 5. NEW equip request (new key) during active hunt -> 409 ACTIVE_HUNT_LOCKED
    const newEquipRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/equip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        backpackSlot: 1,
        equipmentSlot: 'ring',
        idempotencyKey: randomUUID()
      }
    });
    expect(newEquipRes.statusCode).toBe(409);
    expect(newEquipRes.json().error.code).toBe('ACTIVE_HUNT_LOCKED');

    // 6. Stop hunt, test unequip replay during active hunt
    await server.inject({
      method: 'POST',
      url: `/hunts/${huntData.huntId}/stop`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: { idempotencyKey: randomUUID() }
    });

    // Unequip weapon with key unequip-k1
    const unequipKey1 = 'unequip-k1-' + randomUUID();
    const unequipRes1 = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        targetBackpackSlot: 0,
        idempotencyKey: unequipKey1
      }
    });
    expect(unequipRes1.statusCode).toBe(200);
    expect(unequipRes1.json().idempotentReplay).toBe(false);

    // Start a 2nd hunt
    const start2Res = await server.inject({
      method: 'POST',
      url: '/hunts/start',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        characterId: character.id,
        zoneId: 'damp-catacombs',
        strategy: 'balanced',
        hpPotions: 0,
        mpPotions: 0,
        idempotencyKey: randomUUID()
      }
    });
    expect(start2Res.statusCode).toBe(201);

    // Replay exact unequip request during ACTIVE hunt -> MUST return 200 idempotentReplay: true
    const replayUnequipRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        targetBackpackSlot: 0,
        idempotencyKey: unequipKey1
      }
    });
    expect(replayUnequipRes.statusCode).toBe(200);
    expect(replayUnequipRes.json().idempotentReplay).toBe(true);

    // Same key unequipKey1 with different payload -> 409 IDEMPOTENCY_KEY_CONFLICT
    const conflictUnequipRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        targetBackpackSlot: 1,
        idempotencyKey: unequipKey1
      }
    });
    expect(conflictUnequipRes.statusCode).toBe(409);
    expect(conflictUnequipRes.json().error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');

    // NEW unequip request during active hunt -> 409 ACTIVE_HUNT_LOCKED
    const newUnequipRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/equipment/unequip`,
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: {
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      }
    });
    expect(newUnequipRes.statusCode).toBe(409);
    expect(newUnequipRes.json().error.code).toBe('ACTIVE_HUNT_LOCKED');

    await server.close();
  });
});
