import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '../..');
const readJson = (rel) => JSON.parse(readFileSync(resolve(rootDir, rel), 'utf8'));

test('tsconfig.base.json enforces strict TypeScript across monorepo', () => {
  const base = readJson('tsconfig.base.json');
  assert.equal(base.compilerOptions.strict, true);
  assert.equal(base.compilerOptions.noUncheckedIndexedAccess, true);

  const workspaces = [
    'packages/i18n/tsconfig.json',
    'packages/contracts/tsconfig.json',
    'packages/domain/tsconfig.json',
    'packages/database/tsconfig.json',
    'apps/api/tsconfig.json',
    'apps/web/tsconfig.json'
  ];
  for (const ws of workspaces) {
    const cfg = readJson(ws);
    assert.equal(cfg.extends, '../../tsconfig.base.json', `${ws} must extend tsconfig.base.json`);
  }
});

test('package dependency boundaries respect modular monolith layers', () => {
  const getDeps = (rel) => {
    const pkg = readJson(rel);
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  };

  const i18nDeps = getDeps('packages/i18n/package.json');
  assert.deepEqual(i18nDeps, [], 'i18n must have zero dependencies');

  const contractsDeps = getDeps('packages/contracts/package.json');
  for (const forbidden of ['@tibia-idle/domain', '@tibia-idle/database', '@tibia-idle/api', '@tibia-idle/web', 'pg', 'fastify']) {
    assert.ok(!contractsDeps.includes(forbidden), `contracts must not depend on ${forbidden}`);
  }

  const domainDeps = getDeps('packages/domain/package.json');
  for (const forbidden of ['@tibia-idle/database', '@tibia-idle/api', '@tibia-idle/web', 'pg', 'fastify', 'react']) {
    assert.ok(!domainDeps.includes(forbidden), `domain must not depend on ${forbidden}`);
  }

  const domainSrc = readdirSync(resolve(rootDir, 'packages/domain/src'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(resolve(rootDir, 'packages/domain/src', f), 'utf8'))
    .join('\n');
  assert.doesNotMatch(domainSrc, /from\s+['"](pg|fastify|react|node:http|node:fs|@tibia-idle\/database|@tibia-idle\/api|@tibia-idle\/web)['"]/);

  const webDeps = getDeps('apps/web/package.json');
  for (const forbidden of ['@tibia-idle/domain', '@tibia-idle/database', '@tibia-idle/api', 'pg', 'fastify']) {
    assert.ok(!webDeps.includes(forbidden), `web must not depend on ${forbidden}`);
  }
});

test('root package.json scripts contain no dummy echo/true no-ops', () => {
  const pkg = readJson('package.json');
  const requiredScripts = ['build', 'typecheck', 'lint', 'check:docs', 'test:tooling', 'test:unit', 'test:integration', 'test:e2e', 'verify'];
  for (const name of requiredScripts) {
    const cmd = pkg.scripts[name];
    assert.ok(cmd, `Missing required script: ${name}`);
    assert.doesNotMatch(cmd, /\b(echo|true|exit 0)\b/i, `Script ${name} must not be a no-op`);
  }
});

test('CI workflow requires PostgreSQL service and integration tests contain no skip markers', () => {
  const workflow = readFileSync(resolve(rootDir, '.github/workflows/verify.yml'), 'utf8');
  assert.match(workflow, /postgres:\s*\n\s*image:\s*postgres:16-alpine/);
  assert.match(workflow, /REQUIRE_DB_TESTS:\s*['"]1['"]/);

  const integrationFiles = readdirSync(resolve(rootDir, 'tests/integration')).filter((f) => f.endsWith('.ts'));
  for (const file of integrationFiles) {
    const content = readFileSync(resolve(rootDir, 'tests/integration', file), 'utf8');
    assert.doesNotMatch(content, /\b(it|describe|test)\.(skip|skipIf|todo)\b/, `${file} must not skip tests`);
  }
});
