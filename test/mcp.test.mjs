import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { mkdtemp, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer, loadTools } from '../mcp/server.js';
import { appleTools } from '../src/apple.js';

// A scripted MCP client: replies to the server's elicitation requests with the queued answers.
function connect({ elicitation, answers = [], confirm, makeTools, sources, watchSources = false }) {
  const input = new PassThrough(), output = new PassThrough(), runs = [], waiting = new Map(), elicited = [], notified = [];
  makeTools ??= questions => appleTools({ run: async request => { runs.push(request); return { created: true }; }, questions });
  startServer({ input, output, confirm, makeTools, sources, watchSources });
  createInterface({ input: output }).on('line', line => {
    const message = JSON.parse(line);
    if (message.id === undefined) {
      notified.push(message.method);
    } else if (message.method === 'elicitation/create') {
      elicited.push(message.params);
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: answers.shift() })}\n`);
    } else {
      waiting.get(message.id)?.(message);
    }
  });
  let next = 1;
  const call = (method, params) => new Promise(resolve => {
    const id = next++;
    waiting.set(id, resolve);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const ready = call('initialize', { protocolVersion: '2099-01-01', capabilities: elicitation ? { elicitation: {} } : {}, clientInfo: { name: 'test', version: '0' } })
    .then(reply => { input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`); return reply; });
  return { call, runs, elicited, notified, ready };
}

const reminder = { name: 'reminders_create', arguments: { title: '喝水', due: '2026-10-29T09:00-04:00' } };
const body = reply => JSON.parse(reply.result.content[0].text);

test('the server lists the shared tools and answers unknown methods and tools with errors', async () => {
  const client = connect({ elicitation: true });
  assert.equal((await client.ready).result.protocolVersion, '2025-06-18');
  const listed = await client.call('tools/list');
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ['calendar_events', 'calendar_create', 'reminders_list', 'reminders_create', 'notes_search', 'notes_read', 'mail_accounts', 'mail_list', 'mail_read', 'mail_draft', 'mail_reply_draft', 'notes_create']);
  assert.equal(listed.result.tools[0].inputSchema.type, 'object');
  assert.equal((await client.call('tools/call', { name: 'nope' })).error.code, -32602);
  assert.equal((await client.call('bogus')).error.code, -32601);
  const failed = await client.call('tools/call', { name: 'notes_search', arguments: { query: ' ' } });
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.content[0].text, /non-empty/);
});

test('creating goes through an elicitation and only runs when the user picks 创建', async () => {
  const client = connect({ elicitation: true, answers: [
    { action: 'accept', content: { choice: '创建' } },
    { action: 'accept', content: { choice: '取消' } },
    { action: 'accept', content: { choice: '创建', change: '改成十点' } },
    { action: 'decline' },
    { action: 'cancel' },
  ] });
  await client.ready;
  assert.deepEqual(body(await client.call('tools/call', reminder)), { created: true });
  assert.deepEqual(client.runs, [{ op: 'reminders.create', title: '喝水', due: '2026-10-29T09:00:00-04:00' }]);
  const [form] = client.elicited;
  assert.match(form.message, /标题：喝水/);
  assert.deepEqual(form.requestedSchema.properties.choice.enum, ['创建', '取消']);
  assert.deepEqual(body(await client.call('tools/call', reminder)), { created: false, reason: 'the user did not confirm' });
  assert.deepEqual(body(await client.call('tools/call', reminder)), { created: false, user_feedback: '改成十点' });
  for (let i = 0; i < 2; i++) assert.deepEqual(body(await client.call('tools/call', reminder)), { created: false, reason: 'the user did not confirm' });
  assert.equal(client.runs.length, 1);
});

test('in permission mode the host prompt is the confirmation and no form is sent', async () => {
  const client = connect({ elicitation: true, confirm: 'permission' });
  await client.ready;
  assert.deepEqual(body(await client.call('tools/call', reminder)), { created: true });
  assert.equal(client.elicited.length, 0);
  assert.deepEqual(client.runs, [{ op: 'reminders.create', title: '喝水', due: '2026-10-29T09:00:00-04:00' }]);
});

test('without elicitation support nothing is created', async () => {
  const client = connect({ elicitation: false });
  await client.ready;
  const reply = await client.call('tools/call', reminder);
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /nothing was created/);
  assert.equal(client.runs.length, 0);
});

test('edited tool files are reloaded and the client is told the list changed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-agent-reload-'));
  const files = ['a.js', 'b.js'].map(name => join(dir, name));
  for (const file of files) await writeFile(file, '');
  let loads = 0;
  const makeTools = () => {
    loads += 1;
    if (loads === 3) throw new Error('caught mid-edit');
    return [{ name: 'probe', description: `load ${loads}`, parameters: { type: 'object' }, execute: async () => ({ load: loads }) }];
  };
  const client = connect({ makeTools, sources: files.map(file => pathToFileURL(file)) });
  assert.deepEqual((await client.ready).result.capabilities.tools, { listChanged: true });
  const describe = async () => (await client.call('tools/list')).result.tools[0].description;
  assert.equal(await describe(), 'load 1');
  assert.equal(await describe(), 'load 1');
  const touch = async seconds => utimes(files[0], new Date(), new Date(Date.now() + seconds * 1000));
  await touch(10);
  assert.equal(await describe(), 'load 2');
  assert.deepEqual(client.notified, ['notifications/tools/list_changed']);
  await touch(20);
  assert.equal(await describe(), 'load 2', 'a failed reload keeps the previous tools');
  assert.equal(client.notified.length, 1);
  await touch(30);
  assert.deepEqual(body(await client.call('tools/call', { name: 'probe', arguments: {} })), { load: 4 });
  assert.equal(client.notified.length, 2);
});

test('the real tool files load, and a new version imports a fresh copy', async () => {
  const first = await loadTools(() => undefined);
  const second = await loadTools(() => undefined, 'test-version');
  assert.deepEqual(first.map(tool => tool.name), ['calendar_events', 'calendar_create', 'reminders_list', 'reminders_create', 'notes_search', 'notes_read', 'mail_accounts', 'mail_list', 'mail_read', 'mail_draft', 'mail_reply_draft', 'notes_create', 'todo_add', 'reminders_complete', 'reminders_update', 'calendar_update', 'calendar_delete', 'task_create', 'task_update', 'task_list', 'today_update', 'journal_status', 'journal_write', 'sensitive_confirm', 'secret_list', 'secret_save', 'secret_get', 'secret_delete', 'notify', 'arxiv_search']);
  assert.notEqual(first[0].execute, second[0].execute);
});
