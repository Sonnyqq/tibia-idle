import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root = (name) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');

test('AGENTS.md short enough to auto-load efficiently', () => {
  assert.ok(Buffer.byteLength(root('AGENTS.md')) <= 6500);
});
test('CLAUDE.md only routes to canonical instructions', () => {
  const text = root('CLAUDE.md');
  assert.ok(text.includes('AGENTS.md'));
  assert.ok(Buffer.byteLength(text) <= 1200);
});
test('README marks current implementation limits honestly', () => {
  const text = root('README.md');
  assert.match(text, /NOT a playable game/);
  assert.match(text, /gameplay|Game/i);
});
test('Legal asset gate documented before original Tibia artwork', () => {
  const text = root('docs/LEGAL_ASSETS.md');
  assert.match(text, /written permission/i);
});
