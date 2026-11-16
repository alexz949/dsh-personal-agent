import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, loadSettings } from '../src/config.js';

test('settings come from the preset row, then the settings file, then the defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'settings-test-'));
  try {
    const file = join(dir, 'config.json');
    assert.deepEqual(loadSettings({}, join(dir, 'missing.json')), { ...DEFAULTS });
    await writeFile(file, JSON.stringify({ todoList: '待办', bibLibrary: '~/refs/main.bib', unknown: 'x', notesFolder: '  ' }));
    const fromFile = loadSettings({}, file);
    assert.equal(fromFile.todoList, '待办');
    assert.equal(fromFile.bibLibrary, join(homedir(), 'refs', 'main.bib'));
    assert.equal(fromFile.notesFolder, DEFAULTS.notesFolder);
    assert.equal('unknown' in fromFile, false);
    assert.equal(loadSettings({ todoList: 'Row' }, file).todoList, 'Row');
    await writeFile(file, '{ not json');
    assert.deepEqual(loadSettings({}, file), { ...DEFAULTS });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
