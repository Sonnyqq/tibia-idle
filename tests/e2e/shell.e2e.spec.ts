import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const SCREENSHOT_DIR = process.env.SCREENSHOT_OUTPUT_DIR ?? 'test-results/screenshots';

test('completes full Tibia-client responsive PC (1440x900, 1280x800) & mobile (768px, 390px, 320px) flow, all 5 screens, console log, tooltips, PL/EN switch, F5 reload, and captures 10 visual QA screenshots', async ({
  page
}) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
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

  // 10. Login mobile 320x640 first before registering
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(page.getByTestId('auth-heading')).toHaveText('Zaloguj się na konto');
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '10-login-mobile-320x640.png'),
    fullPage: true
  });

  // 1. Login desktop 1440x900
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId('auth-heading')).toHaveText('Zaloguj się na konto');
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '01-login-desktop-1440x900.png'),
    fullPage: true
  });

  // Switch to registration & create account
  await page.getByTestId('auth-mode-toggle').click();
  await expect(page.getByTestId('auth-heading')).toHaveText('Utwórz nowe konto');

  const uniqueEmail = `e2e-${Date.now()}@example.com`;
  await page.getByTestId('auth-email-input').fill(uniqueEmail);
  await page.getByTestId('auth-password-input').fill('StrongPass123!');
  await page.getByTestId('auth-submit-button').click();

  // Character lobby
  await expect(page.getByTestId('character-select-panel')).toBeVisible();
  await page.getByTestId('character-name-input').fill('Valkor');
  await page.getByTestId('character-vocation-select').selectOption('knight');
  await page.getByTestId('character-create-submit').click();

  // 2. Dashboard desktop 1440x900
  await expect(page.getByTestId('character-dashboard')).toBeVisible();
  await expect(page.getByTestId('dashboard-character-name')).toHaveText('Valkor');
  await expect(page.getByTestId('dashboard-activity-status')).toContainText(
    'Odpoczynek w obozie — brak aktywnego polowania'
  );
  await expect(page.getByTestId('game-log-panel')).toBeVisible();
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '02-dashboard-desktop-1440x900.png'),
    fullPage: true
  });

  // Check 1280x800 desktop viewport as well
  await page.setViewportSize({ width: 1280, height: 800 });
  await assertNoHorizontalOverflow();
  await page.setViewportSize({ width: 1440, height: 900 });

  // 3. Hunts desktop 1440x900
  await page.getByTestId('nav.hunts').click();
  await expect(page.getByTestId('hunts-view')).toBeVisible();
  await expect(page.getByTestId('zone-card-damp-catacombs')).toBeVisible();
  await expect(page.getByTestId('zone-card-sunken-crypts')).toBeVisible();
  await expect(page.getByTestId('zone-card-ashwind-ridge')).toBeVisible();
  await expect(page.getByTestId('start-hunt-damp-catacombs')).toBeDisabled();
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '03-hunts-desktop-1440x900.png'),
    fullPage: true
  });

  // 4. Character & Skills desktop 1440x900
  await page.getByTestId('nav.character').click();
  await expect(page.getByTestId('character-view')).toBeVisible();
  await expect(page.getByTestId('char-sheet-melee')).toContainText('15');
  await expect(page.getByTestId('char-sheet-sword')).toContainText('15');
  await expect(page.getByTestId('character-talents-panel')).toBeVisible();
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '04-character-desktop-1440x900.png'),
    fullPage: true
  });

  // 5. Inventory desktop 1440x900
  await page.getByTestId('nav.inventory').click();
  await expect(page.getByTestId('inventory-view')).toBeVisible();
  await page.getByTestId('equip-slot-helmet').click();
  await expect(page.getByTestId('inventory-slot-tooltip')).toContainText('Głowa');
  await expect(page.getByTestId('inventory-backpack-empty')).toBeVisible();
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '05-inventory-desktop-1440x900.png'),
    fullPage: true
  });

  // 6. Bestiary desktop 1440x900 + PL/EN live switch + F5 reload persistence
  await page.getByTestId('nav.bestiary').click();
  await expect(page.getByTestId('bestiary-view')).toBeVisible();
  await page.getByTestId('bestiary-select-ashwind-drake').click();
  await expect(page.getByTestId('bestiary-detail-name')).toHaveText('Popielny Drakon');
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '06-bestiary-desktop-1440x900.png'),
    fullPage: true
  });

  // Switch language PL -> EN on Bestiary without resetting active view
  await page.getByTestId('lang-en').click();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-locale', 'en');
  await expect(page.getByTestId('bestiary-detail-name')).toHaveText('Ashwind Drake');

  // Test bottom console log tab switching
  await page.getByTestId('log-tab-hunt').click();
  await expect(page.getByTestId('game-log-empty')).toContainText(
    'No active or settled hunts recorded.'
  );
  await page.getByTestId('log-tab-system').click();

  // Reload page (F5) -> preserves session, locale (EN), character (Valkor), and active tab (Bestiary)
  await page.reload();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-locale', 'en');
  await expect(page.getByTestId('bestiary-view')).toBeVisible();

  // Switch back to PL for mobile screenshots & checks
  await page.getByTestId('lang-pl').click();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-locale', 'pl');

  // Tablet 768x1024 check
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByTestId('mobile-bottom-nav')).toBeVisible();
  await assertNoHorizontalOverflow();

  // 7. Dashboard mobile 390x844
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('mobile-nav-dashboard').click();
  await expect(page.getByTestId('character-dashboard')).toBeVisible();
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '07-dashboard-mobile-390x844.png'),
    fullPage: true
  });

  // 8. Hunts mobile 390x844
  await page.getByTestId('mobile-nav-hunts').click();
  await expect(page.getByTestId('hunts-view')).toBeVisible();
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '08-hunts-mobile-390x844.png'),
    fullPage: true
  });

  // 9. Inventory mobile 390x844
  await page.getByTestId('mobile-nav-inventory').click();
  await expect(page.getByTestId('inventory-view')).toBeVisible();
  await page.getByTestId('equip-slot-shield').click();
  await expect(page.getByTestId('inventory-slot-tooltip')).toContainText('Lewa dłoń');
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '09-inventory-mobile-390x844.png'),
    fullPage: true
  });

  // Smallest mobile 320x640 check across views
  await page.setViewportSize({ width: 320, height: 640 });
  await assertNoHorizontalOverflow();
  await page.getByTestId('mobile-nav-character').click();
  await expect(page.getByTestId('character-view')).toBeVisible();
  await assertNoHorizontalOverflow();

  // Logout
  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('auth-panel')).toBeVisible();

  const localStorageKeys = await page.evaluate(() => Object.keys(window.localStorage));
  expect(localStorageKeys).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
