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

test('the browser MCP drives the assistant\'s own Chrome by default and the user\'s Chrome when browserMode is mine', async () => {
  const text = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  const row = text.slice(text.indexOf('- id: mcp-browser'));
  const match = /args: !!js "(.+)"\n/.exec(row);
  assert.ok(match, 'the browser row has a quoted args expression');
  const dir = await mkdtemp(join(tmpdir(), 'pa-preset-'));
  const before = process.env.PERSONAL_AGENT_CONFIG;
  const home = process.env.HOME;
  const cli = `${home}/.dsh/mcp/playwright/node_modules/@playwright/mcp/cli.js`;
  const out = ['--output-dir', `${home}/.dsh/mcp/playwright/output`];
  const background = [cli, '--browser', 'chromium', '--executable-path', `${home}/.dsh/mcp/playwright/Chromium.app/Contents/MacOS/Google Chrome for Testing`, '--headless', '--user-data-dir', `${home}/.dsh/mcp/playwright/profile`, ...out];
  try {
    process.env.PERSONAL_AGENT_CONFIG = join(dir, 'config.json');
    assert.deepEqual(evaluate({}, match[1]), background, 'no settings file');
    await writeFile(process.env.PERSONAL_AGENT_CONFIG, '{ "browserMode": "background" }');
    assert.deepEqual(evaluate({}, match[1]), background);
    await writeFile(process.env.PERSONAL_AGENT_CONFIG, '{ "browserMode": "mine" }');
    assert.deepEqual(evaluate({}, match[1]), [cli, '--extension', ...out], 'no profile, no headless: the user\'s running Chrome');
    await writeFile(process.env.PERSONAL_AGENT_CONFIG, '{ broken');
    assert.deepEqual(evaluate({}, match[1]), background, 'a broken file falls back to the isolated browser');

    // The extension token reaches Playwright only in "mine" mode, and only from the settings file.
    const env = /env: !!js "(.+)"\n/.exec(row);
    assert.ok(env, 'the browser row has a quoted env expression');
    assert.deepEqual(evaluate({}, env[1]), {}, 'a broken file passes nothing');
    await writeFile(process.env.PERSONAL_AGENT_CONFIG, '{ "browserMode": "mine" }');
    assert.deepEqual(evaluate({}, env[1]), {}, 'no token: the extension asks on each connection');
    await writeFile(process.env.PERSONAL_AGENT_CONFIG, '{ "browserMode": "mine", "browserExtensionToken": " abc123 " }');
    assert.deepEqual(evaluate({}, env[1]), { PLAYWRIGHT_MCP_EXTENSION_TOKEN: 'abc123' });
    await writeFile(process.env.PERSONAL_AGENT_CONFIG, '{ "browserMode": "mine", "browserExtensionToken": "PLAYWRIGHT_MCP_EXTENSION_TOKEN=abc123" }');
    assert.deepEqual(evaluate({}, env[1]), { PLAYWRIGHT_MCP_EXTENSION_TOKEN: 'abc123' }, 'the extension copies the value with its variable name; the name is dropped');
    await writeFile(process.env.PERSONAL_AGENT_CONFIG, '{ "browserExtensionToken": "abc123" }');
    assert.deepEqual(evaluate({}, env[1]), {}, 'the isolated browser never gets the token');
    assert.doesNotMatch(text, /PLAYWRIGHT_MCP_EXTENSION_TOKEN: [A-Za-z0-9]{8,}/, 'no token value is written in the preset');
  } finally {
    if (before === undefined) delete process.env.PERSONAL_AGENT_CONFIG; else process.env.PERSONAL_AGENT_CONFIG = before;
    await rm(dir, { recursive: true, force: true });
  }
});
