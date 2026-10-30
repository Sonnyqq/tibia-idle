import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('completes full responsive PC & mobile game shell flow (320px/390px/768px/1280px), all 5 screens, PL/EN switch, reload persistence, and zero console errors', async ({
  page
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore expected 401 network log from initial unauthenticated /api/me probe
      if (!text.includes('401')) {
        consoleErrors.push(text);
      }
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // 1. Unauthenticated access restriction
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-locale', 'pl');
  await expect(page.getByTestId('auth-panel')).toBeVisible();
  await expect(page.getByTestId('character-dashboard')).toHaveCount(0);

  const unauthZonesStatus = await page.evaluate(async () => {
    const res = await fetch('/api/zones', { credentials: 'include' });
    return res.status;
  });
  expect(unauthZonesStatus).toBe(401);

  // 2. Register and create character
  await page.getByTestId('auth-mode-toggle').click();
  const uniqueSuffix = randomUUID().replace(/[^a-zA-Z]/g, '').slice(0, 8);
  const email = `shell.${uniqueSuffix}@example.com`;
  const password = 'ShellStrongPassword!99';
  const charName = `Valkor${uniqueSuffix}`;

  await page.getByTestId('auth-email-input').fill(email);
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-button').click();

  await expect(page.getByTestId('character-create-panel')).toBeVisible();
  await page.getByTestId('character-name-input').fill(charName);
  await page.getByTestId('character-vocation-select').selectOption('knight');
  await page.getByTestId('character-create-submit').click();

  // 3. Dashboard screen verification
  await expect(page.getByTestId('character-dashboard')).toBeVisible();
  await expect(page.getByTestId('dashboard-character-name')).toHaveText(charName);
  await expect(page.getByTestId('dashboard-activity-status')).toContainText(
    'Odpoczynek w obozie — brak aktywnego polowania'
  );
  await expect(page.getByTestId('xp-progress-label')).toContainText('0 / 100 (0%)');

  // 4. Quick action to Hunts & Hunts view verification
  await page.getByTestId('quick-goto-hunts').click();
  await expect(page.getByTestId('hunts-view')).toBeVisible();
  await expect(page.getByTestId('zone-card-damp-catacombs')).toBeVisible();
  await expect(page.getByTestId('zone-card-sunken-crypts')).toBeVisible();
  await expect(page.getByTestId('zone-card-ashwind-ridge')).toBeVisible();
  await expect(page.getByTestId('start-hunt-damp-catacombs')).toBeDisabled();
  await expect(page.getByTestId('zone-xp-rate-damp-catacombs')).toContainText(
    'Oczekuje na symulację P02'
  );

  // 5. Switch PL <-> EN without losing active Hunts view
  await page.getByTestId('lang-en').click();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-locale', 'en');
  await expect(page.getByTestId('hunts-view')).toBeVisible();
  await expect(page.getByTestId('zone-card-damp-catacombs')).toContainText('Damp Catacombs');
  await expect(page.getByTestId('zone-xp-rate-damp-catacombs')).toContainText(
    'Pending P02 simulation'
  );

  await page.getByTestId('lang-pl').click();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-locale', 'pl');
  await expect(page.getByTestId('zone-card-damp-catacombs')).toContainText('Wilgotne Katakumby');

  // 6. Character screen via desktop sidebar
  await page.getByTestId('nav.character').click();
  await expect(page.getByTestId('character-view')).toBeVisible();
  await expect(page.getByTestId('char-sheet-hp')).toContainText('185 / 185');
  await expect(page.getByTestId('character-talents-panel')).toBeVisible();

  // 7. Inventory screen via desktop sidebar
  await page.getByTestId('nav.inventory').click();
  await expect(page.getByTestId('inventory-view')).toBeVisible();
  await expect(page.getByTestId('equip-slot-helmet')).toBeVisible();
  await page.getByTestId('equip-slot-shield').click();
  await expect(page.getByTestId('inventory-slot-tooltip')).toContainText('Lewa dłoń');
  await expect(page.getByTestId('inventory-backpack-empty')).toBeVisible();

  // 8. Bestiary screen via desktop sidebar
  await page.getByTestId('nav.bestiary').click();
  await expect(page.getByTestId('bestiary-view')).toBeVisible();
  await expect(page.getByTestId('bestiary-detail-name')).toHaveText('Piwniczny Prześladowca');
  await page.getByTestId('bestiary-select-ashwind-drake').click();
  await expect(page.getByTestId('bestiary-detail-name')).toHaveText('Popielny Drakon');
  await expect(page.getByTestId('bestiary-kill-count')).toContainText('0');

  // 9. Page reload preserves session, selected character, and active tab
  await page.reload();
  await expect(page.getByTestId('bestiary-view')).toBeVisible();
  await expect(page.getByTestId('context-character-summary')).toContainText(charName);

  // 10. Responsive viewports check (1280px, 768px, 390px, 320px) + mobile navigation
  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow, `Horizontal overflow detected at ${width}px`).toBe(false);
  }

  // At 320px mobile viewport, use mobile bottom navigation
  await expect(page.getByTestId('mobile-bottom-nav')).toBeVisible();
  await page.getByTestId('mobile-nav-dashboard').click();
  await expect(page.getByTestId('character-dashboard')).toBeVisible();

  await page.getByTestId('mobile-nav-inventory').click();
  await expect(page.getByTestId('inventory-view')).toBeVisible();

  // 11. Logout & verify session cleared
  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('auth-panel')).toBeVisible();

  const localStorageKeys = await page.evaluate(() => Object.keys(window.localStorage));
  expect(localStorageKeys).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
