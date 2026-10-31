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
  await page.getByTestId('character-name-input').fill('HuntMaster');
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

  // 7. Test F5 Reload persistence
  await page.reload();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('hunts-view')).toBeVisible();
  await expect(page.getByTestId('reward-inbox-window')).toBeVisible();

  // 8. Mobile 390x844 responsive check
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, '14-playable-hunts-mobile-390x844.png'),
    fullPage: true
  });

  expect(consoleErrors).toEqual([]);
});
