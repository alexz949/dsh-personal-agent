import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// DSH 0.2.x treats a tool's rendered output as content blocks (it calls content.some(...) after every
// call), so render must return an array, never a bare string.
test('every tool output render returns content blocks', () => {
  for (const file of readdirSync(new URL('../src/', import.meta.url))) {
    if (!file.endsWith('.js')) continue;
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/render:\s*\(_args, value\)\s*=>\s*([^\n]+)/g)) {
      assert.match(match[1], /^(\[\{ type: 'text'|json\(value\))/, `${file}: ${match[1]}`);
    }
  }
});
