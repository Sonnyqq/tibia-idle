import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const locale = (code) => JSON.parse(readFileSync(new URL(`../../packages/i18n/locales/${code}.json`, import.meta.url), 'utf8'));
const sorted = (obj) => Object.keys(obj).sort();
test('PL and EN contain identical translation keys', () => {
  assert.deepEqual(sorted(locale('pl')), sorted(locale('en')));
});
test('translations are nonempty', () => {
  for (const code of ['pl', 'en']) {
    for (const [key, value] of Object.entries(locale(code))) {
      assert.equal(typeof value, 'string', `${code}:${key} not a string`);
      assert.ok(value.trim(), `${code}:${key} empty`);
    }
  }
});
test('translation keys have stable namespace prefix', () => {
  for (const key of sorted(locale('en'))) assert.match(key, /^[a-z]+\.[a-zA-Z][a-zA-Z0-9]*$/);
});
