import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createDatabasePool, resolveTestDatabaseConfig } from '@tibia-idle/database';

const SCREENSHOT_DIR = process.env.SCREENSHOT_OUTPUT_DIR ?? 'test-results/screenshots';

test('completes full persistent inventory, backpack, stack split, move, F5 persistence, relogin, and visual QA screenshots', async ({
  page
}) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

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

  // 1. Desktop viewport setup (1440x900) & registration
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByTestId('auth-mode-toggle').click();
  const uniqueEmail = `inv-e2e-${Date.now()}@example.com`;
  const password = 'KnightPassword123!';
  await page.getByTestId('auth-email-input').fill(uniqueEmail);
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-button').click();

  // Create Knight character
  await expect(page.getByTestId('character-select-panel')).toBeVisible();
  const randomSuffix = Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join('');
  const charName = `Hero${randomSuffix}`;
  await page.getByTestId('character-name-input').fill(charName);
  await page.getByTestId('character-vocation-select').selectOption('knight');
  await page.getByTestId('character-create-submit').click();

  await expect(page.getByTestId('character-dashboard')).toBeVisible();

  // 2. Navigate to Inventory tab when empty
  await page.getByTestId('nav.inventory').click();
  await expect(page.getByTestId('inventory-view')).toBeVisible();
  await expect(page.getByTestId('inventory-capacity-tag')).toContainText('0 / 5000 oz');
  await expect(page.getByTestId('inventory-slots-tag')).toContainText('0 / 20');
  await assertNoHorizontalOverflow();

  // Screenshot 1: Inventory empty desktop
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '15-inventory-empty-desktop-1440x900.png')
  });

  // 3. Start a Hunt, wait/settle, then stop
  await page.getByTestId('nav.hunts').click();
  await expect(page.getByTestId('hunts-view')).toBeVisible();
  await page.getByTestId('zone-card-damp-catacombs').click();
  await page.getByTestId('strategy-option-balanced').click();
  await page.getByTestId('hp-potions-input').fill('20');
  await page.getByTestId('mp-potions-input').fill('10');
  await page.getByTestId('start-hunt-button').click();

  await expect(page.getByTestId('active-hunt-window')).toBeVisible({ timeout: 10000 });

  // Settle immediately (granting initial loot segment)
  await page.waitForTimeout(1000);
  await page.getByTestId('settle-hunt-button').click();
  await page.waitForTimeout(1000);

  // Stop hunt
  await page.getByTestId('stop-hunt-button').click();
  await expect(page.getByTestId('hunt-report-window')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('close-report-button').click();

  // Ensure deterministic rewards in AFK inbox for claim testing
  const dbConfig = resolveTestDatabaseConfig(process.env);
  const pool = createDatabasePool(dbConfig);
  try {
    const charRes = await pool.query<{ id: string }>(
      'SELECT id FROM characters WHERE name = $1 LIMIT 1',
      [charName]
    );
    const charRow = charRes.rows[0];
    if (!charRow) throw new Error('Character not found in test db');
    const charId = charRow.id;

    const existingRewards = await pool.query<{ id: string }>(
      'SELECT id FROM hunt_reward_items WHERE character_id = $1 AND ownership_state = $2',
      [charId, 'UNCLAIMED']
    );
    if (existingRewards.rows.length === 0) {
      const huntRes = await pool.query<{ id: string }>(
        'SELECT id FROM hunts WHERE character_id = $1 ORDER BY started_at DESC LIMIT 1',
        [charId]
      );
      const huntRow = huntRes.rows[0];
      if (!huntRow) throw new Error('Hunt not found in test db');
      const huntId = huntRow.id;

      const segRes = await pool.query<{ id: string }>(
        'SELECT id FROM hunt_segments WHERE hunt_id = $1 ORDER BY segment_from DESC LIMIT 1',
        [huntId]
      );
      const segRow = segRes.rows[0];
      if (!segRow) throw new Error('Hunt segment not found in test db');
      const segId = segRow.id;

      await pool.query(
        `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state)
         VALUES
           ($1, $2, $3, $4, 'copper-coin', 25, 'UNCLAIMED'),
           ($5, $2, $3, $4, 'rusted-blade', 1, 'UNCLAIMED')`,
        [randomUUID(), huntId, segId, charId, randomUUID()]
      );
    }
  } finally {
    await pool.end();
  }

  // 4. Return to Inventory Tab: verify rewards are in Magazyn nagród AFK
  await page.getByTestId('nav.inventory').click();
  await expect(page.getByTestId('inventory-view')).toBeVisible();
  await expect(page.getByTestId('reward-inbox-panel')).toBeVisible();

  // Screenshot 5: Reward inbox desktop
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '19-inventory-reward-inbox-desktop-1440x900.png')
  });

  // Claim first reward
  const firstClaimBtn = page.locator('[data-testid^="claim-reward-btn-"]').first();
  await expect(firstClaimBtn).toBeVisible({ timeout: 10000 });
  await firstClaimBtn.click();

  // Verify item is placed in backpack!
  await expect(page.getByTestId('backpack-slot-0')).toBeVisible();
  await expect(page.getByTestId('inventory-slots-tag')).not.toContainText('0 / 20', { timeout: 10000 });

  // Screenshot 2: Inventory with loot desktop
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '16-inventory-with-loot-desktop-1440x900.png')
  });

  // 5. Select item in backpack and verify item action inspector
  await page.getByTestId('backpack-slot-0').click();
  await expect(page.getByTestId('selected-item-box')).toBeVisible();

  // Screenshot 3: Selected item + inspector
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '17-inventory-selected-tooltip-desktop-1440x900.png')
  });

  // 6. Test move item: click slot 3 to move item from slot 0 to slot 3
  await page.getByTestId('backpack-slot-3').click();
  await expect(page.getByTestId('backpack-slot-3')).toContainText('(');

  // 7. Test split stack if stackable item exists, or move again
  const splitBtn = page.getByTestId('split-stack-btn');
  if (await splitBtn.isVisible()) {
    await page.getByTestId('backpack-slot-3').click();
    await splitBtn.click();
    await expect(page.getByTestId('split-controls-box')).toBeVisible();

    // Screenshot 4: Split stack desktop
    await page.screenshot({
      path: join(SCREENSHOT_DIR, '18-inventory-split-stack-desktop-1440x900.png')
    });

    await page.getByTestId('confirm-split-auto-btn').click();
    await expect(page.getByTestId('inventory-slots-tag')).toContainText('2 / 20');
  }

  // 8. F5 Reload test: verify item positions and quantities persist
  await page.reload();
  await expect(page.getByTestId('inventory-view')).toBeVisible();
  await expect(page.getByTestId('inventory-slots-tag')).not.toContainText('0 / 20');
  await expect(page.getByTestId('backpack-slot-3')).toBeVisible();

  // 9. Relogin test: logout, login, verify inventory persistence
  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('auth-mode-toggle')).toBeVisible();

  await page.getByTestId('auth-email-input').fill(uniqueEmail);
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-button').click();

  await expect(page.getByTestId('character-select-panel')).toBeVisible();
  await page.getByTestId(`select-character-${charName}`).click();

  await expect(page.getByTestId('character-dashboard')).toBeVisible();
  await page.getByTestId('nav.inventory').click();
  await expect(page.getByTestId('inventory-view')).toBeVisible();
  await expect(page.getByTestId('inventory-slots-tag')).not.toContainText('0 / 20');

  // 10. Viewport responsive tests & mobile screenshots
  // Mobile 390x844
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '20-inventory-mobile-390x844.png')
  });

  // Claim another reward on mobile if available
  const mobileClaimBtn = page.locator('[data-testid^="claim-reward-btn-"]').first();
  if (await mobileClaimBtn.isVisible()) {
    await page.screenshot({
      path: join(SCREENSHOT_DIR, '22-inventory-reward-claim-mobile-390x844.png')
    });
    await mobileClaimBtn.click();
  }

  // Mobile 320x640
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(300);
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '21-inventory-mobile-320x640.png')
  });

  // Tablet 768x1024
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(300);
  await assertNoHorizontalOverflow();

  // Desktop 1280x800
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  await assertNoHorizontalOverflow();

  // Verify no console errors occurred
  expect(consoleErrors).toHaveLength(0);
});
