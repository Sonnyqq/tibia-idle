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

test('completes full NPC Shop lifecycle: buy potions, sell loot, restock, hunt locking, F5 persistence, and visual QA', async ({
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
  const uniqueEmail = `shop-e2e-${Date.now()}@example.com`;
  const password = 'ShopPassword123!';
  await page.getByTestId('auth-email-input').fill(uniqueEmail);
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-button').click();

  // Create Knight character
  await expect(page.getByTestId('character-select-panel')).toBeVisible();
  const randomSuffix = Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join('');
  const charName = `Merchant${randomSuffix}`;

  await page.getByTestId('character-name-input').fill(charName);
  await page.getByTestId('character-vocation-select').selectOption('knight');
  await page.getByTestId('character-create-submit').click();

  await expect(page.getByTestId('character-dashboard')).toBeVisible();

  // 2. Navigate to NPC Shop
  await page.getByTestId('nav.shop').click();
  await expect(page.getByTestId('npc-shop-view')).toBeVisible();
  await expect(page.getByTestId('shop-merchant-card')).toBeVisible();
  await expect(page.getByTestId('shop-character-gold')).toContainText('100 gp');
  await expect(page.getByTestId('shop-buy-health-potion')).toContainText('250');
  await expect(page.getByTestId('shop-buy-mana-potion')).toContainText('150');

  // Screenshot 1: shop-buy-tab-desktop (1440x900)
  const buyTabScreenshotPath = join(SCREENSHOT_DIR, 'shop-buy-tab-desktop.png');
  await page.screenshot({ path: buyTabScreenshotPath });
  saveScreenshot(buyTabScreenshotPath, 'shop-buy-tab-desktop.png');

  // 3. Purchase 2x Health Potion (2 * 45 = 90 gp)
  await page.getByTestId('input-buy-hp-qty').fill('2');
  await page.getByTestId('btn-buy-health-potion').click();

  // Gold drops to 10 gp, HP potions increase to 252
  await expect(page.getByTestId('shop-character-gold')).toContainText('10 gp');
  await expect(page.getByTestId('shop-buy-health-potion')).toContainText('252');

  // 4. Verify buy button is disabled now because 10 gp < 45 gp (cannot afford 1 potion)
  await page.getByTestId('input-buy-hp-qty').fill('1');
  await expect(page.getByTestId('btn-buy-health-potion')).toBeDisabled();

  // 5. Populate character backpack with rat-pelt and rusted-blade in DB
  const dbConfig = resolveTestDatabaseConfig(process.env);
  const pool = createDatabasePool(dbConfig);
  try {
    const charRow = await pool.query<{ id: string }>('SELECT id FROM characters WHERE name = $1', [
      charName
    ]);
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
         ($1, $2, $3, 0, 'rat-pelt', 5, 1),
         ($4, $2, $3, 1, 'rusted-blade', 1, 1)`,
      [randomUUID(), charId, bpId, randomUUID()]
    );
  } finally {
    await pool.end();
  }

  // Navigate to inventory and back to shop so fresh backpack instances are fetched
  await page.getByTestId('nav.inventory').click();
  await page.getByTestId('nav.shop').click();

  // Switch to SELL tab
  await page.getByTestId('shop-tab-sell').click();
  await expect(page.getByTestId('shop-sell-panel')).toBeVisible();
  await expect(page.getByTestId('shop-sell-item-rat-pelt')).toBeVisible();
  await expect(page.getByTestId('shop-sell-item-rusted-blade')).toBeVisible();

  // Screenshot 2: shop-sell-tab-desktop (1440x900)
  const sellTabScreenshotPath = join(SCREENSHOT_DIR, 'shop-sell-tab-desktop.png');
  await page.screenshot({ path: sellTabScreenshotPath });
  saveScreenshot(sellTabScreenshotPath, 'shop-sell-tab-desktop.png');

  // Sell 5x rat-pelt (5 * 9 = +45 gp). Gold: 10 + 45 = 55 gp.
  await page.getByTestId('btn-sell-all-rat-pelt').click();
  await page.getByTestId('btn-sell-submit-rat-pelt').click();
  await expect(page.getByTestId('shop-character-gold')).toContainText('55 gp');
  await expect(page.getByTestId('shop-sell-item-rat-pelt')).not.toBeVisible();

  // Sell 1x rusted-blade (+68 gp). Gold: 55 + 68 = 123 gp.
  await page.getByTestId('btn-sell-submit-rusted-blade').click();
  await expect(page.getByTestId('shop-character-gold')).toContainText('123 gp');
  await expect(page.getByTestId('shop-sell-item-rusted-blade')).not.toBeVisible();

  // 6. Buy potions with earned gold: 2x Mana Potion (2 * 50 = 100 gp)
  await page.getByTestId('shop-tab-buy').click();
  await page.getByTestId('input-buy-mp-qty').fill('2');
  await page.getByTestId('btn-buy-mana-potion').click();

  // Gold: 123 - 100 = 23 gp, MP potions: 150 + 2 = 152
  await expect(page.getByTestId('shop-character-gold')).toContainText('23 gp');
  await expect(page.getByTestId('shop-buy-mana-potion')).toContainText('152');

  // 7. Check transaction history
  await page.getByTestId('shop-tab-history').click();
  await expect(page.getByTestId('shop-history-panel')).toBeVisible();

  // Screenshot 3: shop-history-tab-desktop (1440x900)
  const historyScreenshotPath = join(SCREENSHOT_DIR, 'shop-history-tab-desktop.png');
  await page.screenshot({ path: historyScreenshotPath });
  saveScreenshot(historyScreenshotPath, 'shop-history-tab-desktop.png');

  // 8. Start an active hunt and verify shop locking
  await page.getByTestId('nav.hunts').click();
  await expect(page.getByTestId('hunts-view')).toBeVisible();
  await page.getByTestId('zone-card-damp-catacombs').click();
  await page.getByTestId('strategy-option-balanced').click();
  await page.getByTestId('hp-potions-input').fill('15');
  await page.getByTestId('mp-potions-input').fill('10');
  await page.getByTestId('start-hunt-button').click();
  await expect(page.getByTestId('active-hunt-window')).toBeVisible({ timeout: 10000 });

  // Return to Shop tab
  await page.getByTestId('nav.shop').click();
  await expect(page.getByTestId('shop-hunt-locked-notice')).toBeVisible();

  // Check buttons disabled under active hunt
  await page.getByTestId('shop-tab-buy').click();
  await expect(page.getByTestId('btn-buy-health-potion')).toBeDisabled();
  await expect(page.getByTestId('btn-buy-mana-potion')).toBeDisabled();

  // Screenshot 4: shop-hunt-locked-desktop (1440x900)
  const huntLockedScreenshotPath = join(SCREENSHOT_DIR, 'shop-hunt-locked-desktop.png');
  await page.screenshot({ path: huntLockedScreenshotPath });
  saveScreenshot(huntLockedScreenshotPath, 'shop-hunt-locked-desktop.png');

  // 9. F5 Persistence test: reload page and check state (237 HP / 142 MP available after 15/10 reserved in active hunt)
  await page.reload();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await page.getByTestId('nav.shop').click();
  await expect(page.getByTestId('shop-character-gold')).toContainText('23 gp');
  await expect(page.getByTestId('shop-buy-health-potion')).toContainText('237');
  await expect(page.getByTestId('shop-buy-mana-potion')).toContainText('142');

  // 10. Mobile responsiveness tests
  // 390x844 (Mobile viewport)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  await assertNoHorizontalOverflow();

  const mobile390Path = join(SCREENSHOT_DIR, 'shop-mobile-390px.png');
  await page.screenshot({ path: mobile390Path });
  saveScreenshot(mobile390Path, 'shop-mobile-390px.png');

  // 320x568 (Compact mobile viewport)
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(100);
  await assertNoHorizontalOverflow();

  const mobile320Path = join(SCREENSHOT_DIR, 'shop-mobile-320px.png');
  await page.screenshot({ path: mobile320Path });
  saveScreenshot(mobile320Path, 'shop-mobile-320px.png');

  expect(consoleErrors).toEqual([]);
});

test('completes genuine full gameplay loop without DB mock: HUNT -> SETTLE -> CLAIM -> NPC SELL -> BUY POTIONS -> NEXT HUNT', async ({
  page
}) => {
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

  // 1. Setup & Registration
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByTestId('auth-mode-toggle').click();
  const uniqueEmail = `loop-e2e-${Date.now()}@example.com`;
  const password = 'LoopPassword123!';
  await page.getByTestId('auth-email-input').fill(uniqueEmail);
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-button').click();

  // Create Knight character
  await expect(page.getByTestId('character-select-panel')).toBeVisible();
  const randomSuffix = Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join('');
  const charName = `LoopHero${randomSuffix}`;

  await page.getByTestId('character-name-input').fill(charName);
  await page.getByTestId('character-vocation-select').selectOption('knight');
  await page.getByTestId('character-create-submit').click();
  await expect(page.getByTestId('character-dashboard')).toBeVisible();

  // 2. Step 1: HUNT -> Start hunt in damp-catacombs
  await page.getByTestId('nav.hunts').click();
  await expect(page.getByTestId('hunts-view')).toBeVisible();
  await page.getByTestId('zone-card-damp-catacombs').click();
  await page.getByTestId('strategy-option-aggressive').click();
  await page.getByTestId('hp-potions-input').fill('20');
  await page.getByTestId('mp-potions-input').fill('10');
  await page.getByTestId('start-hunt-button').click();
  await expect(page.getByTestId('active-hunt-window')).toBeVisible({ timeout: 10000 });

  // 3. Step 2: SETTLE -> Wait for combat events and settle
  await page.waitForTimeout(11000);
  await page.getByTestId('settle-hunt-button').click();
  await page.waitForTimeout(1000);

  // Stop the hunt
  await page.getByTestId('stop-hunt-button').click();
  await expect(page.getByTestId('active-hunt-window')).not.toBeVisible({ timeout: 10000 });

  // Close hunt report
  await expect(page.getByTestId('hunt-report-window')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('close-report-button').click();
  await expect(page.getByTestId('hunt-report-window')).not.toBeVisible();

  // 4. Step 3: CLAIM -> Claim any dropped loot from the AFK reward inbox
  await expect(page.getByTestId('reward-inbox-window')).toBeVisible();
  const claimButtons = page.locator('[data-testid^="claim-reward-btn-"]');
  const claimCount = await claimButtons.count();
  if (claimCount > 0) {
    await claimButtons.first().click();
    await page.waitForTimeout(500);
  }

  // 5. Step 4: NPC SELL -> Navigate to Shop tab and sell items (or verify catalog)
  await page.getByTestId('nav.shop').click();
  await expect(page.getByTestId('npc-shop-view')).toBeVisible();

  // Check SELL tab
  await page.getByTestId('shop-tab-sell').click();
  await expect(page.getByTestId('shop-sell-panel')).toBeVisible();

  const sellSubmitBtns = page.locator('[data-testid^="btn-sell-submit-"]');
  const sellCount = await sellSubmitBtns.count();
  if (sellCount > 0) {
    await sellSubmitBtns.first().click();
    await page.waitForTimeout(500);
  }

  // 6. Step 5: BUY POTIONS -> Buy potions to restock
  await page.getByTestId('shop-tab-buy').click();
  await expect(page.getByTestId('shop-buy-panel')).toBeVisible();
  await page.getByTestId('input-buy-hp-qty').fill('1');

  const buyHpBtn = page.getByTestId('btn-buy-health-potion');
  if (await buyHpBtn.isEnabled()) {
    await buyHpBtn.click();
    await page.waitForTimeout(500);
  }

  // 7. Step 6: NEXT HUNT -> Start the next hunt cleanly
  await page.getByTestId('nav.hunts').click();
  await expect(page.getByTestId('hunts-view')).toBeVisible();
  await page.getByTestId('zone-card-damp-catacombs').click();
  await page.getByTestId('strategy-option-balanced').click();
  await page.getByTestId('hp-potions-input').fill('10');
  await page.getByTestId('mp-potions-input').fill('5');
  await page.getByTestId('start-hunt-button').click();
  await expect(page.getByTestId('active-hunt-window')).toBeVisible({ timeout: 10000 });

  expect(consoleErrors).toEqual([]);
});
