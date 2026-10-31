import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const SCREENSHOT_DIR = process.env.SCREENSHOT_OUTPUT_DIR ?? 'test-results/screenshots';

test('completes full playable AFK offline hunt slice: start, active monitoring, settle now, stop, hunt report, reward inbox and F5 persistence', async ({
  page
}) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('401 (Unauthorized)')) {
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

  // 1. Desktop viewport setup & registration
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByTestId('auth-mode-toggle').click();
  const uniqueEmail = `hunt-e2e-${Date.now()}@example.com`;
  await page.getByTestId('auth-email-input').fill(uniqueEmail);
  await page.getByTestId('auth-password-input').fill('KnightPass123!');
  await page.getByTestId('auth-submit-button').click();

  // Create Knight character
  await expect(page.getByTestId('character-select-panel')).toBeVisible();
  const randomSuffix = Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join('');
  const charName = `Hunt${randomSuffix}`;
  await page.getByTestId('character-name-input').fill(charName);
  await page.getByTestId('character-vocation-select').selectOption('knight');
  await page.getByTestId('character-create-submit').click();

  await expect(page.getByTestId('character-dashboard')).toBeVisible();

  // 2. Navigate to Hunts tab
  await page.getByTestId('nav.hunts').click();
  await expect(page.getByTestId('hunts-view')).toBeVisible();

  // Check Damp Catacombs zone card is visible and selected
  await expect(page.getByTestId('zone-card-damp-catacombs')).toBeVisible();
  await page.getByTestId('zone-card-damp-catacombs').click();

  // Configure Strategy & Potions
  await page.getByTestId('strategy-option-balanced').click();
  await page.getByTestId('hp-potions-input').fill('20');
  await page.getByTestId('mp-potions-input').fill('10');

  // Verify Start Hunt button is enabled
  const startButton = page.getByTestId('start-hunt-button');
  await expect(startButton).toBeEnabled();

  // Take screenshot of hunting grounds setup
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '11-playable-hunts-setup-1440x900.png'),
    fullPage: true
  });

  // 3. Start Hunt
  await startButton.click();

  // Verify Active Hunt Window appears
  await expect(page.getByTestId('active-hunt-window')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('active-hunt-status-pill')).toBeVisible();
  await expect(page.getByTestId('hunt-elapsed-time')).toBeVisible();
  await expect(page.getByTestId('settle-hunt-button')).toBeVisible();
  await expect(page.getByTestId('stop-hunt-button')).toBeVisible();

  // Verify Dashboard shows active hunt status
  await page.getByTestId('nav.dashboard').click();
  await expect(page.getByTestId('dashboard-activity-status')).toContainText('damp-catacombs');

  // Navigate back to Hunts tab
  await page.getByTestId('nav.hunts').click();
  await expect(page.getByTestId('active-hunt-window')).toBeVisible();

  // Wait 2.5 seconds for combat time to elapse
  await page.waitForTimeout(2500);

  // Capture screenshot of Active Hunt in progress
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '12-playable-hunts-active-1440x900.png'),
    fullPage: true
  });

  // 4. Settle Now
  await page.getByTestId('settle-hunt-button').click();
  // Active hunt remains visible after settle
  await expect(page.getByTestId('active-hunt-window')).toBeVisible();

  // Wait another 1.5 seconds
  await page.waitForTimeout(1500);

  // 5. Stop Hunt
  await page.getByTestId('stop-hunt-button').click();

  // Active hunt window should disappear
  await expect(page.getByTestId('active-hunt-window')).not.toBeVisible({ timeout: 10000 });

  // Hunt Report Window should appear
  await expect(page.getByTestId('hunt-report-window')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('report-total-duration')).toBeVisible();
  await expect(page.getByTestId('report-returned-potions')).toBeVisible();

  // Capture screenshot of Hunt Report
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '13-playable-hunts-report-1440x900.png'),
    fullPage: true
  });

  // Dismiss report
  await page.getByTestId('close-report-button').click();
  await expect(page.getByTestId('hunt-report-window')).not.toBeVisible();

  // 6. Verify AFK Reward Inbox is visible
  await expect(page.getByTestId('reward-inbox-window')).toBeVisible();

  // 7. Test F5 Reload persistence & Report Restore
  await page.reload();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('hunts-view')).toBeVisible();
  await expect(page.getByTestId('reward-inbox-window')).toBeVisible();

  // Test persistent report restore via "Ostatnie polowanie" / "Last Hunt" button
  const openReportBtn = page.getByTestId('open-latest-report-button');
  await expect(openReportBtn).toBeVisible();
  await openReportBtn.click();
  await expect(page.getByTestId('hunt-report-window')).toBeVisible();
  await page.getByTestId('close-report-button').click();
  await expect(page.getByTestId('hunt-report-window')).not.toBeVisible();

  // 8. Mobile 320x640 and 390x844 responsive check
  await page.setViewportSize({ width: 320, height: 640 });
  await assertNoHorizontalOverflow();

  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '14-playable-hunts-mobile-390x844.png'),
    fullPage: true
  });

  expect(consoleErrors).toEqual([]);
});

test('recovers session and active hunt in new tab without sessionStorage using HttpOnly cookie', async ({
  browser
}) => {
  const context1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page1 = await context1.newPage();

  // 1. Register & create knight in context 1
  await page1.goto('/');
  await page1.getByTestId('auth-mode-toggle').click();
  const uniqueEmail = `cookie-recovery-${Date.now()}@example.com`;
  await page1.getByTestId('auth-email-input').fill(uniqueEmail);
  await page1.getByTestId('auth-password-input').fill('CookiePass123!');
  await page1.getByTestId('auth-submit-button').click();

  await expect(page1.getByTestId('character-select-panel')).toBeVisible();
  const randomSuffix2 = Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join('');
  const charName2 = `Cookie${randomSuffix2}`;
  await page1.getByTestId('character-name-input').fill(charName2);
  await page1.getByTestId('character-vocation-select').selectOption('knight');
  await page1.getByTestId('character-create-submit').click();
  await expect(page1.getByTestId('character-dashboard')).toBeVisible();

  // 2. Start hunt in damp-catacombs
  await page1.getByTestId('nav.hunts').click();
  await page1.getByTestId('zone-card-damp-catacombs').click();
  await page1.getByTestId('strategy-option-balanced').click();
  await page1.getByTestId('hp-potions-input').fill('15');
  await page1.getByTestId('mp-potions-input').fill('10');
  await page1.getByTestId('start-hunt-button').click();
  await expect(page1.getByTestId('active-hunt-window')).toBeVisible({ timeout: 10000 });

  // 3. Extract HttpOnly cookies & close context 1 completely (clearing all sessionStorage/localStorage)
  const cookies = await context1.cookies();
  await context1.close();

  // 4. Create context 2 with zero sessionStorage, add HttpOnly cookies and open fresh tab
  const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context2.addCookies(cookies);
  const page2 = await context2.newPage();

  await page2.goto('/');
  // Server-authoritative /me verifies session cookie and auto-restores character
  await expect(page2.getByTestId('character-dashboard')).toBeVisible({ timeout: 10000 });

  // Navigate to Hunts tab: active hunt is restored
  await page2.getByTestId('nav.hunts').click();
  await expect(page2.getByTestId('active-hunt-window')).toBeVisible();

  // Wait a moment for combat, then settle & stop
  await page2.waitForTimeout(2000);
  await page2.getByTestId('settle-hunt-button').click();
  await expect(page2.getByTestId('active-hunt-window')).toBeVisible();

  await page2.waitForTimeout(1000);
  await page2.getByTestId('stop-hunt-button').click();
  await expect(page2.getByTestId('active-hunt-window')).not.toBeVisible({ timeout: 10000 });
  await expect(page2.getByTestId('hunt-report-window')).toBeVisible();
  await page2.getByTestId('close-report-button').click();

  // 5. Reload (F5) in context 2
  await page2.reload();
  await expect(page2.getByTestId('app-shell')).toBeVisible();
  await expect(page2.getByTestId('open-latest-report-button')).toBeVisible();

  // Re-open report via "Ostatnie polowanie"
  await page2.getByTestId('open-latest-report-button').click();
  await expect(page2.getByTestId('hunt-report-window')).toBeVisible();

  await context2.close();
});
