import { App } from '@tibia-idle/web/App.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

describe('@tibia-idle/web smoke tests', () => {
  it('renders localized shell in Polish and English without raw keys', () => {
    const htmlPl = renderToStaticMarkup(<App initialLocale="pl" />);
    expect(htmlPl).toContain('Polowania');
    expect(htmlPl).toContain('Ekwipunek');
    expect(htmlPl).toContain('Szkielet techniczny P01 gotowy.');

    const htmlEn = renderToStaticMarkup(<App initialLocale="en" />);
    expect(htmlEn).toContain('Hunts');
    expect(htmlEn).toContain('Inventory');
    expect(htmlEn).toContain('P01 technical scaffold ready.');
  });
});
