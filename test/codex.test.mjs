// The Codex plugin: its manifest, MCP config, local marketplace and skills fit together, and the MCP
// server's workspace tools say how to set the workspace when it is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

test('the Codex plugin manifest, MCP config and marketplace point at files that exist', async () => {
  const plugin = await json('.codex-plugin/plugin.json');
  const pkg = await json('package.json');
  assert.equal(plugin.name, 'personal-agent');
  assert.equal(plugin.version, pkg.version, 'the Codex plugin version follows package.json');
  assert.equal(plugin.skills, './codex/skills/');
  const mcp = await json('.mcp.json');
  assert.deepEqual(mcp.mcpServers['personal-agent'].args, ['./mcp/server.js']);
  assert.equal(mcp.mcpServers['personal-agent'].cwd, '.', 'Codex resolves the script against the plugin root');
  const market = await json('.agents/plugins/marketplace.json');
  assert.deepEqual(market.plugins.map(entry => [entry.name, entry.source.path]), [['personal-agent', './']]);
  const skills = await readdir(new URL('codex/skills/', root));
  assert.deepEqual(skills.sort(), ['evening-check', 'morning-check', 'personal-agent', 'weekly-journal']);
  for (const skill of skills) {
    const text = await readFile(new URL(`codex/skills/${skill}/SKILL.md`, root), 'utf8');
    const front = /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n/.exec(text);
    assert.ok(front, `${skill} has name and description front matter`);
    assert.equal(front[1], skill);
    assert.doesNotMatch(text, /schedule_create|ask_research|ask_computer|Mnemon|browser_login/, `${skill} names no DSH-only tool`);
  }
});

test('without a workspace the MCP server\'s 今日 note tool says how to set one', async () => {
  const before = process.env.PERSONAL_AGENT_WORKSPACE;
  delete process.env.PERSONAL_AGENT_WORKSPACE;
  try {
    const { loadTools } = await import('../mcp/server.js');
    const tools = await loadTools(undefined, `codex-${Date.now()}`);
    const today = tools.find(tool => tool.name === 'today_update');
    await assert.rejects(today.execute({ changes: [{ op: 'add', text: 'x' }] }, { signal: new AbortController().signal }), /workspace.*config\.json/);
  } finally {
    if (before !== undefined) process.env.PERSONAL_AGENT_WORKSPACE = before;
  }
});
