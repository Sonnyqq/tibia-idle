import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createDatabasePool, resolveTestDatabaseConfig } from '@tibia-idle/database';

const SCREENSHOT_DIR = process.env.SCREENSHOT_OUTPUT_DIR ?? 'test-results/screenshots';
const ARTIFACT_SCREENSHOT_DIR =
  'C:/Users/denis/.gemini/antigravity/brain/1936c148-66b3-4ae4-befd-74d093776eac/screenshots';

function saveScreenshot(sourcePath: string, filename: string): void {
  try {
    mkdirSync(ARTIFACT_SCREENSHOT_DIR, { recursive: true });
    copyFileSync(sourcePath, join(ARTIFACT_SCREENSHOT_DIR, filename));
  } catch {
    // Artifact copy is best-effort
  }
}

test('completes full equipment paperdoll lifecycle, combat stats scaling, hunt lock, F5 persistence, and visual QA screenshots', async ({
  page
}) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(ARTIFACT_SCREENSHOT_DIR, { recursive: true });

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (
      msg.type() === 'error' &&
      !msg.text().includes('401 (Unauthorized)') &&
      !msg.text().includes('favicon') &&
      !msg.text().includes('404 (Not Found)')
    ) {
      consoleErrors.push(msg.text());
    }
  });

  const assertNoHorizontalOverflow = async () => {
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
  };

  // 1. Desktop viewport setup (1440x900) & Registration
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByTestId('auth-mode-toggle').click();
  const uniqueEmail = `equip-e2e-${Date.now()}@example.com`;
  const password = 'KnightPassword123!';
  await page.getByTestId('auth-email-input').fill(uniqueEmail);
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-button').click();

  // Create Knight character
  await expect(page.getByTestId('character-select-panel')).toBeVisible();
  const randomSuffix = Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join('');
  const charName = `Knight${randomSuffix}`;
  await page.getByTestId('character-name-input').fill(charName);
  await page.getByTestId('character-vocation-select').selectOption('knight');
  await page.getByTestId('character-create-submit').click();

  await expect(page.getByTestId('character-dashboard')).toBeVisible();

  // 2. Navigate to Inventory tab when equipment is empty
  await page.getByTestId('nav.inventory').click();
  await expect(page.getByTestId('inventory-view')).toBeVisible();
  await expect(page.getByTestId('paperdoll-grid')).toBeVisible();
  await assertNoHorizontalOverflow();

  // Screenshot 1: equipment-empty-desktop.png (1440x900)
  const emptyScreenshotPath = join(SCREENSHOT_DIR, 'equipment-empty-desktop.png');
  await page.screenshot({ path: emptyScreenshotPath });
  saveScreenshot(emptyScreenshotPath, 'equipment-empty-desktop.png');

  // Verify baseline combat stats in CharacterView tab
  await page.getByTestId('nav.character').click();
  await expect(page.getByTestId('character-view')).toBeVisible();
  await expect(page.getByTestId('character-combat-stats-panel')).toBeVisible();
  await expect(page.getByTestId('combat-stat-attack')).toContainText('18');
  await expect(page.getByTestId('combat-stat-defense')).toContainText('16');
  await expect(page.getByTestId('combat-stat-armor')).toContainText('10');
  await expect(page.getByTestId('combat-stat-crit-chance')).toContainText('5.0%');
  await expect(page.getByTestId('combat-stat-crit-mult')).toContainText('1.25x');

  // Screenshot 5: character-combat-stats-desktop.png (1440x900)
  const statsScreenshotPath = join(SCREENSHOT_DIR, 'character-combat-stats-desktop.png');
  await page.screenshot({ path: statsScreenshotPath });
  saveScreenshot(statsScreenshotPath, 'character-combat-stats-desktop.png');

  // 3. Give items to character backpack in DB: rusted-blade (slot 0), silver-ring (slot 1), ritual-amulet (slot 2)
  const dbConfig = resolveTestDatabaseConfig(process.env);
  const pool = createDatabasePool(dbConfig);
  try {
    const charRow = await pool.query<{ id: string }>(
      'SELECT id FROM characters WHERE name = $1',
      [charName]
    );
    const charId = charRow.rows[0]?.id;
    expect(charId).toBeTruthy();

    const bpRow = await pool.query<{ id: string }>(
      "SELECT id FROM inventory_containers WHERE character_id = $1 AND container_type = 'backpack'",
      [charId]
    );
    const bpId = bpRow.rows[0]?.id;
    expect(bpId).toBeTruthy();

    await pool.query(
      `INSERT INTO inventory_instances (id, character_id, container_id, slot_index, item_id, quantity, row_version)
       VALUES
         ($1, $2, $3, 0, 'rusted-blade', 1, 1),
         ($4, $2, $3, 1, 'silver-ring', 1, 1),
         ($5, $2, $3, 2, 'ritual-amulet', 1, 1)`,
      [randomUUID(), charId, bpId, randomUUID(), randomUUID()]
    );
  } finally {
    await pool.end();
  }

  // Navigate back to Inventory
  await page.getByTestId('nav.inventory').click();
  await expect(page.getByTestId('backpack-slot-0')).toBeVisible();

  // Click slot 0 (rusted-blade) -> inspect details & comparison
  await page.getByTestId('backpack-slot-0').click();
  await expect(page.getByTestId('selected-item-box')).toBeVisible();
  await expect(page.getByTestId('stat-diff-attack')).toBeVisible();
  await expect(page.getByTestId('stat-diff-attack')).toContainText('+4');

  // Screenshot 4: stat-comparison-tooltip-desktop.png (1440x900)
  const comparisonScreenshotPath = join(SCREENSHOT_DIR, 'stat-comparison-tooltip-desktop.png');
  await page.screenshot({ path: comparisonScreenshotPath });
  saveScreenshot(comparisonScreenshotPath, 'stat-comparison-tooltip-desktop.png');

  // Click Equip button
  await page.getByTestId('equip-item-btn').click();

  // Verify weapon is now equipped in weapon paperdoll slot
  await expect(page.getByTestId('equip-slot-weapon')).toHaveAttribute(
    'data-slot-state',
    /occupied|selected/
  );

  // Screenshot 2: weapon-equipped-desktop.png (1440x900)
  const weaponScreenshotPath = join(SCREENSHOT_DIR, 'weapon-equipped-desktop.png');
  await page.screenshot({ path: weaponScreenshotPath });
  saveScreenshot(weaponScreenshotPath, 'weapon-equipped-desktop.png');

  // Verify Character tab reflects Attack 18 + 4 = 22
  await page.getByTestId('nav.character').click();
  await expect(page.getByTestId('combat-stat-attack')).toContainText('22');

  // 4. Equip silver-ring and ritual-amulet
  await page.getByTestId('nav.inventory').click();

  // Equip silver-ring from slot 1
  await page.getByTestId('backpack-slot-1').click();
  await page.getByTestId('equip-item-btn').click();
  await expect(page.getByTestId('equip-slot-ring')).toHaveAttribute(
    'data-slot-state',
    /occupied|selected/
  );

  // Equip ritual-amulet from slot 2
  await page.getByTestId('backpack-slot-2').click();
  await page.getByTestId('equip-item-btn').click();
  await expect(page.getByTestId('equip-slot-amulet')).toHaveAttribute(
    'data-slot-state',
    /occupied|selected/
  );

  // Screenshot 3: ring-amulet-equipped-desktop.png (1440x900)
  const allEquippedScreenshotPath = join(SCREENSHOT_DIR, 'ring-amulet-equipped-desktop.png');
  await page.screenshot({ path: allEquippedScreenshotPath });
  saveScreenshot(allEquippedScreenshotPath, 'ring-amulet-equipped-desktop.png');

  // Verify Character tab: Attack 22, Armor 13, Crit Chance 7.0%
  await page.getByTestId('nav.character').click();
  await expect(page.getByTestId('combat-stat-attack')).toContainText('22');
  await expect(page.getByTestId('combat-stat-armor')).toContainText('13');
  await expect(page.getByTestId('combat-stat-crit-chance')).toContainText('7.0%');

  // 5. Active hunt equipment lock: Start a hunt and verify equip/unequip is locked
  await page.getByTestId('nav.hunts').click();
  await page.getByTestId('zone-card-damp-catacombs').click();
  await page.getByTestId('strategy-option-balanced').click();
  await page.getByTestId('start-hunt-button').click();
  await expect(page.getByTestId('active-hunt-window')).toBeVisible({ timeout: 10000 });

  // Navigate to Inventory during active hunt
  await page.getByTestId('nav.inventory').click();
  await expect(page.getByTestId('active-hunt-equipment-locked')).toBeVisible();

  // Click equipped weapon -> unequip button should be disabled
  await page.getByTestId('equip-slot-weapon').click();
  await expect(page.getByTestId('unequip-item-btn')).toBeDisabled();

  // Screenshot 8: active-hunt-blocked-equip.png (1440x900)
  const lockedScreenshotPath = join(SCREENSHOT_DIR, 'active-hunt-blocked-equip.png');
  await page.screenshot({ path: lockedScreenshotPath });
  saveScreenshot(lockedScreenshotPath, 'active-hunt-blocked-equip.png');

  // Stop hunt
  await page.getByTestId('nav.hunts').click();
  await page.getByTestId('stop-hunt-button').click();
  await expect(page.getByTestId('hunt-report-window')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('close-report-button').click();

  // Go back to inventory -> active hunt lock banner should disappear
  await page.getByTestId('nav.inventory').click();
  await expect(page.getByTestId('active-hunt-equipment-locked')).not.toBeVisible();

  // 6. Unequip weapon
  await page.getByTestId('equip-slot-weapon').click();
  await expect(page.getByTestId('unequip-item-btn')).toBeEnabled();
  await page.getByTestId('unequip-item-btn').click();
  await expect(page.getByTestId('equip-slot-weapon')).toHaveAttribute(
    'title',
    /Pusty slot|Empty slot/
  );

  // Verify weapon returned to backpack
  await expect(page.getByTestId('backpack-slot-0')).toBeVisible();

  // 7. Mobile Viewports
  // 390x844 (iPhone 12/13/14)
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow();
  const mobile390ScreenshotPath = join(SCREENSHOT_DIR, 'equipment-mobile-390px.png');
  await page.screenshot({ path: mobile390ScreenshotPath });
  saveScreenshot(mobile390ScreenshotPath, 'equipment-mobile-390px.png');

  // 320x640 (Compact mobile)
  await page.setViewportSize({ width: 320, height: 640 });
  await assertNoHorizontalOverflow();
  const mobile320ScreenshotPath = join(SCREENSHOT_DIR, 'equipment-mobile-320px.png');
  await page.screenshot({ path: mobile320ScreenshotPath });
  saveScreenshot(mobile320ScreenshotPath, 'equipment-mobile-320px.png');

  // Reset to desktop viewport
  await page.setViewportSize({ width: 1440, height: 900 });

  // 8. F5 Refresh Persistence
  await page.reload();
  await expect(page.getByTestId('inventory-view')).toBeVisible();
  // Ring and Amulet must still be equipped after F5
  await expect(page.getByTestId('equip-slot-ring')).toHaveAttribute(
    'data-slot-state',
    /occupied|selected/
  );
  await expect(page.getByTestId('equip-slot-amulet')).toHaveAttribute(
    'data-slot-state',
    /occupied|selected/
  );
  await expect(page.getByTestId('equip-slot-weapon')).toHaveAttribute(
    'title',
    /Pusty slot|Empty slot/
  );

  // 9. Relogin Persistence
  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('auth-panel')).toBeVisible();

  // Login back
  await page.getByTestId('auth-email-input').fill(uniqueEmail);
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-button').click();

  // Select character
  await page.getByTestId(`select-character-${charName}`).click();
  await expect(page.getByTestId('character-dashboard')).toBeVisible();

  // Navigate to Inventory
  await page.getByTestId('nav.inventory').click();
  await expect(page.getByTestId('equip-slot-ring')).toHaveAttribute(
    'data-slot-state',
    /occupied|selected/
  );
  await expect(page.getByTestId('equip-slot-amulet')).toHaveAttribute(
    'data-slot-state',
    /occupied|selected/
  );

  expect(consoleErrors).toHaveLength(0);
});
