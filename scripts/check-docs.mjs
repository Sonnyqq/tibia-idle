import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const required = [
  'AGENTS.md', 'CLAUDE.md', 'PROJECT_MAP.md', 'README.md',
  'docs/ARCHITECTURE.md', 'docs/ROADMAP.md', 'docs/TEST_STRATEGY.md',
  'docs/AI_EFFICIENCY.md', 'docs/GAME_DESIGN.md', 'docs/DATA_MODEL.md',
  'docs/SESSION_STATE.md', 'docs/LEGAL_ASSETS.md', 'docs/WORKFLOW.md',
  'docs/tasks/TASK_TEMPLATE.md', 'docs/tasks/BACKLOG.md',
  'packages/i18n/locales/pl.json', 'packages/i18n/locales/en.json'
];
let errors = [];
for (const rel of required) {
  const full = resolve(process.cwd(), rel);
  if (!existsSync(full)) errors.push(`Missing required file: ${rel}`);
  else if (!readFileSync(full, 'utf8').trim()) errors.push(`Empty required file: ${rel}`);
}
for (const [rel, max] of [['AGENTS.md', 6500], ['CLAUDE.md', 1200]]) {
  if (existsSync(rel)) {
    const size = Buffer.byteLength(readFileSync(rel, 'utf8'));
    if (size > max) errors.push(`${rel}: ${size} bytes, exceeds ${max} byte token-efficiency budget`);
  }
}
const docs = ['README.md', 'PROJECT_MAP.md', 'AGENTS.md'];
for (const name of docs) {
  if (!existsSync(name)) continue;
  const content = readFileSync(name, 'utf8');
  for (const match of content.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    if (/^(https?:|mailto:)/.test(match[1])) continue;
    const target = resolve(name.includes('/') ? name.substring(0, name.lastIndexOf('/')) : '.', match[1]);
    if (!existsSync(target)) errors.push(`Broken local link in ${name}: ${match[1]}`);
  }
}
if (errors.length) {
  console.error(`Documentation gate FAILED (${errors.length})`);
  for (const err of errors) console.error(`- ${err}`);
  process.exit(1);
}
console.log(`Documentation gate PASS: ${required.length} required docs/locales + instruction size budgets`);
