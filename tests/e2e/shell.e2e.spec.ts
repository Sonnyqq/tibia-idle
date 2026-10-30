import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('renders PL shell by default, switches PL/EN, and completes register -> create character -> dashboard -> logout flow on desktop & mobile', async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-locale', 'pl');
  await expect(page.getByTestId('nav.hunts')).toHaveText('Polowania');
  await expect(page.getByTestId('auth-heading')).toHaveText('Zaloguj się na konto');

  // Switch to EN and back to PL
  await page.getByTestId('lang-en').click();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-locale', 'en');
  await expect(page.getByTestId('nav.hunts')).toHaveText('Hunts');
  await expect(page.getByTestId('auth-heading')).toHaveText('Sign in to account');

  await page.getByTestId('lang-pl').click();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-locale', 'pl');
  await expect(page.getByTestId('auth-heading')).toHaveText('Zaloguj się na konto');

  // Switch to registration mode and register a new account
  await page.getByTestId('auth-mode-toggle').click();
  await expect(page.getByTestId('auth-heading')).toHaveText('Utwórz nowe konto');

  const uniqueSuffix = randomUUID().replace(/[^a-zA-Z]/g, '').slice(0, 8);
  const email = `e2e.${uniqueSuffix}@example.com`;
  const password = 'E2eStrongPassword!99';
  const charName = `Rycerz${uniqueSuffix}`;

  await page.getByTestId('auth-email-input').fill(email);
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-button').click();

  // Character selection screen should now be visible with 0 / 3 slots
  await expect(page.getByTestId('character-select-panel')).toBeVisible();
  await expect(page.getByTestId('character-slots-indicator')).toContainText('0 / 3');

  // Verify no session token is stored in localStorage
  const localStorageKeys = await page.evaluate(() => Object.keys(window.localStorage));
  expect(localStorageKeys).toEqual([]);

  // Logout and log back in
  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('auth-panel')).toBeVisible();

  await page.getByTestId('auth-mode-toggle').click();
  await expect(page.getByTestId('auth-heading')).toHaveText('Zaloguj się na konto');
  await page.getByTestId('auth-email-input').fill(email);
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-button').click();

  await expect(page.getByTestId('character-create-panel')).toBeVisible();

  // Switch to mobile viewport and create a character
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('character-name-input').fill(charName);
  await page.getByTestId('character-vocation-select').selectOption('knight');
  await page.getByTestId('character-create-submit').click();

  // Character Dashboard should appear with Level 1 Knight stats
  await expect(page.getByTestId('character-dashboard')).toBeVisible();
  await expect(page.getByTestId('dashboard-character-name')).toHaveText(charName);
  await expect(page.getByTestId('stat-level')).toContainText('1');
  await expect(page.getByTestId('stat-hp')).toContainText('185 / 185');
  await expect(page.getByTestId('stat-mp')).toContainText('40 / 40');
  await expect(page.getByTestId('stat-gold')).toContainText('100');

  // Switch back to character list, verify 1 / 3 slots used, then logout
  await page.getByTestId('back-to-characters-button').click();
  await expect(page.getByTestId('character-slots-indicator')).toContainText('1 / 3');
  await expect(page.getByTestId(`character-item-${charName}`)).toBeVisible();

  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('auth-panel')).toBeVisible();
});
