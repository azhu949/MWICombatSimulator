#!/usr/bin/env node
/**
 * check-dead-keys.mjs
 *
 * Scans the `queue` i18n domain for dead translation keys (keys defined in
 * locales/{en,zh}/common.json but never referenced from src/), and verifies
 * that the en/zh key sets stay symmetric.
 *
 * Detection rules:
 *   - A key is "referenced" when the literal `queue.<key>` appears in any
 *     `js`/`vue`/`mjs` file under the src directory, followed by a
 *     non-identifier character.
 *   - localStorage keys like 'mwi.queue.settings.v1' are stripped first so they
 *     cannot masquerade as i18n references.
 *   - Dynamically composed keys such as `common:queue.changeCategory.${category}`
 *     are matched by their static prefix (`queue.changeCategory`), so nested
 *     objects under the prefix stay "referenced".
 *
 * Exit code: 0 when everything is clean, 1 when dead keys or en/zh key set
 * mismatches are found (suitable for CI usage).
 *
 * Usage: node scripts/check-dead-keys.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const readLocale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang, 'common.json'), 'utf8'));

const en = readLocale('en');
const zh = readLocale('zh');

const enQueueKeys = Object.keys(en.queue || {});
const zhQueueKeys = Object.keys(zh.queue || {});

// Collect all source files under src/
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|vue|mjs)$/.test(e.name)) files.push(p);
  }
})(path.join(ROOT, 'src'));

// Strip localStorage keys (e.g. 'mwi.queue.settings.v1') so they cannot
// masquerade as i18n references.
let allSources = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
allSources = allSources.replace(/['"]mwi\.[A-Za-z0-9_.]+['"]/g, '');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const referenced = (key) => new RegExp(`queue\\.${escapeRe(key)}(?![A-Za-z0-9_])`).test(allSources);

const deadEn = enQueueKeys.filter((k) => !referenced(k));
const deadZh = zhQueueKeys.filter((k) => !referenced(k));
const deadBoth = deadEn.filter((k) => deadZh.includes(k));
const onlyEn = enQueueKeys.filter((k) => !zhQueueKeys.includes(k));
const onlyZh = zhQueueKeys.filter((k) => !enQueueKeys.includes(k));

console.log(`en queue keys: ${enQueueKeys.length}  dead: ${deadEn.length}`);
console.log(`zh queue keys: ${zhQueueKeys.length}  dead: ${deadZh.length}`);

let problems = 0;

if (deadBoth.length > 0) {
  problems += deadBoth.length;
  console.log('\nDead keys in en+zh (remove them from both locales):');
  for (const k of deadBoth) console.log(`  - ${k}`);
}
const deadEnOnly = deadEn.filter((k) => !deadZh.includes(k));
if (deadEnOnly.length > 0) {
  problems += deadEnOnly.length;
  console.log('\nDead keys in en only:');
  for (const k of deadEnOnly) console.log(`  - ${k}`);
}
const deadZhOnly = deadZh.filter((k) => !deadEn.includes(k));
if (deadZhOnly.length > 0) {
  problems += deadZhOnly.length;
  console.log('\nDead keys in zh only:');
  for (const k of deadZhOnly) console.log(`  - ${k}`);
}

if (onlyEn.length > 0 || onlyZh.length > 0) {
  problems += onlyEn.length + onlyZh.length;
  console.log('\nen/zh key set mismatch:');
  for (const k of onlyEn) console.log(`  - en-only: ${k}`);
  for (const k of onlyZh) console.log(`  - zh-only: ${k}`);
}

if (problems === 0) {
  console.log('\nOK: no dead queue keys, en/zh key sets are symmetric.');
} else {
  console.log(`\nFAIL: ${problems} problem(s) found.`);
  process.exitCode = 1;
}
