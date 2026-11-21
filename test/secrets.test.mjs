import test from 'node:test';
import assert from 'node:assert/strict';
import { secretTools } from '../src/secrets.js';
import { withLog } from '../src/log.js';

const exec = { agent: {}, signal: new AbortController().signal };

function fake(answer, store = new Map()) {
  const asked = [], runs = [];
  const questions = () => ({ ask: async request => { asked.push(request); return { answers: [{ id: 'confirm', ...answer }] }; } });
  const run = async (request, _signal, options = {}) => {
    runs.push({ request, options });
    const key = `${request.site} · ${request.username}`;
    if (request.op === 'keychain.save') { const replaced = store.has(key); store.set(key, request.password); return { saved: true, replaced, site: request.site, username: request.username }; }
    if (request.op === 'keychain.get') return { site: request.site, username: request.username, password: store.get(key) };
    if (request.op === 'keychain.list') return { entries: [...store.keys()].map(entry => ({ site: entry.split(' · ')[0], username: entry.split(' · ')[1] })) };
    if (request.op === 'keychain.delete') { store.delete(key); return { deleted: true, site: request.site, username: request.username }; }
    throw new Error(`unexpected ${request.op}`);
  };
  return { tools: Object.fromEntries(secretTools({ run, questions }).map(tool => [tool.name, tool])), asked, runs, store };
}

test('saving asks first, sends the password through a file, and never shows it on the card', async () => {
  const yes = fake({ selected: ['存进去'] });
  const saved = await yes.tools.secret_save.execute({ site: 'Canvas', username: 'abc123', password: 's3cret!' }, exec);
  assert.deepEqual(saved, { saved: true, replaced: false, site: 'Canvas', username: 'abc123' });
  assert.equal(yes.runs[0].options.viaFile, true, 'a request with a password never goes on the command line');
  const card = yes.asked[0].questions[0];
  assert.equal(card.question, '把「Canvas」的密码存进钥匙串？');
  assert.doesNotMatch(JSON.stringify(yes.asked), /s3cret/);

  const no = fake({ selected: ['取消'] });
  assert.equal((await no.tools.secret_save.execute({ site: 'Canvas', username: 'abc123', password: 'x' }, exec)).saved, false);
  assert.deepEqual(no.runs, [], 'nothing reaches the keychain when the user says no');
  await assert.rejects(yes.tools.secret_save.execute({ site: 'Canvas', username: 'abc123', password: '' }, exec), /password/);
});

test('taking a password out asks where it goes, each time; listing shows no passwords', async () => {
  const store = new Map([['Canvas · abc123', 's3cret!']]);
  const yes = fake({ selected: ['允许'] }, store);
  const listed = await yes.tools.secret_list.execute({}, exec);
  assert.deepEqual(listed, { entries: [{ site: 'Canvas', username: 'abc123' }] });
  assert.equal(yes.asked.length, 0, 'listing needs no card');
  const taken = await yes.tools.secret_get.execute({ site: 'Canvas', username: 'abc123', where: 'Duke 登录页的密码栏', why: '登录下载课件' }, exec);
  assert.equal(taken.password, 's3cret!');
  assert.equal(yes.asked[0].questions[0].question, '取出「Canvas」的密码，填到「Duke 登录页的密码栏」？');
  assert.equal(yes.runs.at(-1).options.viaFile, true, 'the reply with the password also stays off the command line');

  const no = fake({ selected: ['取消'] }, store);
  const refused = await no.tools.secret_get.execute({ site: 'Canvas', username: 'abc123', where: '某个页面' }, exec);
  assert.equal(refused.taken, false);
  assert.equal(refused.password, undefined);
  await assert.rejects(yes.tools.secret_get.execute({ site: 'Canvas', username: 'abc123' }, exec), /where/);
});

test('the action log records what was saved, used and deleted, never the password', async () => {
  const lines = [];
  const { tools: raw } = fake({ selected: [] });
  // Approve every card: options[0] is always the yes button.
  const approveAll = () => ({ ask: async ({ questions: [question] }) => ({ answers: [{ id: question.id, selected: [question.options[0].label] }] }) });
  const store = new Map();
  const run = async request => {
    const key = `${request.site} · ${request.username}`;
    if (request.op === 'keychain.save') { store.set(key, request.password); return { saved: true, site: request.site, username: request.username }; }
    if (request.op === 'keychain.get') return { password: store.get(key) };
    store.delete(key);
    return { deleted: true, site: request.site, username: request.username };
  };
  assert.ok(raw.secret_save, 'the fake builds the same tools');
  const tools = withLog(secretTools({ run, questions: approveAll }), async (_tool, text) => { lines.push(text); });
  const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
  await byName.secret_save.execute({ site: 'GitHub', username: 'me', password: 'p@ss' }, exec);
  await byName.secret_get.execute({ site: 'GitHub', username: 'me', where: 'GitHub 登录页' }, exec);
  await byName.secret_delete.execute({ site: 'GitHub', username: 'me' }, exec);
  assert.deepEqual(lines, ['存进密码本：GitHub（me）', '从密码本取出：GitHub（me）→ GitHub 登录页', '从密码本删除：GitHub（me）']);
  assert.doesNotMatch(lines.join('\n'), /p@ss/);
});
