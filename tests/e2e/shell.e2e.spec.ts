import { expect, test } from '@playwright/test';

test('renders PL shell by default and switches between PL and EN', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-locale', 'pl');
  await expect(page.getByTestId('nav.hunts')).toHaveText('Polowania');
  await expect(page.getByTestId('scaffold-notice')).toContainText('Szkielet techniczny P01 gotowy.');

  await page.getByTestId('lang-en').click();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-locale', 'en');
  await expect(page.getByTestId('nav.hunts')).toHaveText('Hunts');
  await expect(page.getByTestId('scaffold-notice')).toContainText('P01 technical scaffold ready.');

  await page.getByTestId('lang-pl').click();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-locale', 'pl');
  await expect(page.getByTestId('nav.hunts')).toHaveText('Polowania');
});
