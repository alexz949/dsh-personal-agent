// The preset's ask_computer row reads its model from the plugin settings file through a !!js
// expression. Evaluate it the way the Cordis loader does (new Function + eval) to check it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const evaluate = new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }');

async function agentOptionsExpr() {
  const text = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  const row = text.slice(text.indexOf('- id: tool-ask-computer'));
  const match = /agentOptions: !!js "(.+)"\n/.exec(row);
  assert.ok(match, 'ask_computer has a quoted agentOptions expression');
  return match[1];
}

test('ask_computer takes its model from the settings file, and keeps the default without one', async () => {
  const expr = await agentOptionsExpr();
  const dir = await mkdtemp(join(tmpdir(), 'pa-preset-'));
  const before = process.env.PERSONAL_AGENT_CONFIG;
  try {
    process.env.PERSONAL_AGENT_CONFIG = join(dir, 'config.json');
    assert.deepEqual(evaluate({}, expr), {}, 'no file');
    await writeFile(process.env.PERSONAL_AGENT_CONFIG, '{ "todoList": "Assistant" }');
    assert.deepEqual(evaluate({}, expr), {}, 'no computerModel');
    await writeFile(process.env.PERSONAL_AGENT_CONFIG, '{ "computerModel": " gpt-6.1-terra " }');
    assert.deepEqual(evaluate({}, expr), { provider: 'openai', model: 'gpt-6.1-terra' });
    await writeFile(process.env.PERSONAL_AGENT_CONFIG, '{ "computerModel": "claude-x", "computerProvider": "anthropic" }');
    assert.deepEqual(evaluate({}, expr), { provider: 'anthropic', model: 'claude-x' });
    await writeFile(process.env.PERSONAL_AGENT_CONFIG, '{ not json');
    assert.deepEqual(evaluate({}, expr), {}, 'a broken file never breaks the preset');
  } finally {
    if (before === undefined) delete process.env.PERSONAL_AGENT_CONFIG; else process.env.PERSONAL_AGENT_CONFIG = before;
    await rm(dir, { recursive: true, force: true });
  }
});
