import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appleTools, todoTool, completeTool, normalizeWhen, describeWhen, mailId, parseMailId } from '../src/apple.js';

const TODO_LIST = 'Assistant Test';

const signal = new AbortController().signal;
const exec = { agent: {}, signal };
const byName = tools => Object.fromEntries(tools.map(tool => [tool.name, tool]));

function setup(answer) {
  const runs = [], asked = [];
  const questions = answer === undefined ? () => undefined : () => ({
    ask: async request => { asked.push(request); if (answer instanceof Error) throw answer; return { answers: [{ id: 'confirm', ...answer }] }; },
  });
  const tools = byName(appleTools({ run: async request => { runs.push(request); return request.op === 'calendar.events' ? { events: [] } : { created: true }; }, questions }));
  return { tools, runs, asked };
}

test('times are normalized to what the helper parses, and bad times are refused before launching it', () => {
  assert.equal(normalizeWhen('2026-10-28T09:00+08:00', 'due'), '2026-10-28T09:00:00+08:00');
  assert.equal(normalizeWhen(' 2026-10-28 ', 'due'), '2026-10-28');
  assert.equal(normalizeWhen('2026-10-28T09:00:00.5Z', 'due'), '2026-10-28T09:00:00.5Z');
  for (const bad of ['2026-10-28T09:00', 'tomorrow', '', 7]) assert.throws(() => normalizeWhen(bad, 'due'), /due must be/);
  assert.match(describeWhen('2026-10-28T13:00:00Z'), /^10月28日（周[一二三四五六日]）\d{2}:00$/);
  const now = new Date(2026, 9, 27);
  assert.equal(describeWhen('2026-10-28', now), '10月28日（周三）');
  assert.equal(describeWhen('2027-01-02', now), '2027年1月2日（周六）');
  assert.match(describeWhen(new Date(2026, 9, 28, 9, 5).toISOString(), now), /^10月28日（周三）09:05$/);
});

test('reads go straight to the helper with normalized arguments', async () => {
  const { tools, runs, asked } = setup();
  assert.deepEqual(Object.keys(tools), ['calendar_events', 'calendar_create', 'reminders_list', 'reminders_create', 'notes_search', 'notes_read', 'mail_accounts', 'mail_list', 'mail_read', 'mail_draft', 'mail_reply_draft', 'notes_create']);
  await tools.calendar_events.execute({ start: '2026-10-28', end: '2026-10-29T18:00+08:00', calendars: [] }, exec);
  await tools.reminders_list.execute({ list: ' 工作 ', due_before: '2026-10-30' }, exec);
  await tools.notes_search.execute({ query: '签证', limit: 99 }, exec);
  await tools.notes_read.execute({ id: 'x-coredata://note/p1' }, exec);
  assert.deepEqual(runs, [
    { op: 'calendar.events', start: '2026-10-28', end: '2026-10-29T18:00:00+08:00' },
    { op: 'reminders.list', list: '工作', due_before: '2026-10-30' },
    { op: 'notes.search', query: '签证', limit: 20 },
    { op: 'notes.read', id: 'x-coredata://note/p1' },
  ]);
  assert.equal(asked.length, 0);
  await assert.rejects(tools.notes_search.execute({ query: '  ' }, exec), /non-empty/);
});

test('mail reads pass normalized filters and round-trip message ids', async () => {
  const runs = [];
  const run = async request => {
    runs.push(request);
    return request.op === 'mail.list'
      ? { messages: [{ id: 42, account: 'Work', mailbox: '收件箱', from: 'a@example.edu', subject: 'HW', received: '2026-10-28T19:57:37-04:00', read: false }], matched: 1, truncated: false, searched: [] }
      : { text: 'body' };
  };
  const tools = byName(appleTools({ run }));
  await tools.mail_accounts.execute({}, exec);
  const listed = await tools.mail_list.execute({ account: ' Work ', query: ' example ', unread_only: true, since: '2026-10-21', limit: 500 }, exec);
  await tools.mail_list.execute({ mailbox: '  ', unread_only: false }, exec);
  const [message] = listed.messages;
  assert.deepEqual(message, { id: mailId('Work', '收件箱', 42), account: 'Work', mailbox: '收件箱', from: 'a@example.edu', subject: 'HW', received: '2026-10-28T19:57:37-04:00', read: false });
  await tools.mail_read.execute({ id: message.id }, exec);
  assert.deepEqual(runs, [
    { op: 'mail.accounts' },
    { op: 'mail.list', account: 'Work', query: 'example', unread_only: true, since: '2026-10-21', limit: 50 },
    { op: 'mail.list' },
    { op: 'mail.read', account: 'Work', mailbox: '收件箱', message_id: 42 },
  ]);
  assert.deepEqual(parseMailId(mailId('a/b', 'x:y', 7)), { account: 'a/b', mailbox: 'x:y', message_id: 7 });
  for (const bad of ['42', 'not base64!', mailId('Work', '收件箱', 1.5), '']) {
    await assert.rejects(tools.mail_read.execute({ id: bad }, exec), /message id returned by mail_list/);
  }
  await assert.rejects(tools.mail_list.execute({ since: 'yesterday' }, exec), /since must be/);
  assert.equal(runs.length, 4);
});

test('drafts and new notes go straight to the helper, notes only into the assistant folder', async () => {
  const runs = [];
  const tools = byName(appleTools({ run: async request => { runs.push(request); return { saved: true }; } }));
  await tools.mail_draft.execute({ account: ' Work ', to: ['a@example.edu'], subject: ' 推荐信提醒 ', body: '您好' }, exec);
  await tools.mail_draft.execute({ subject: 'x', body: 'y' }, exec);
  await tools.notes_create.execute({ title: ' 早间简报 ', body: '第一行\n第二行', folder: '别的文件夹' }, exec);
  assert.deepEqual(runs, [
    { op: 'mail.draft', subject: '推荐信提醒', body: '您好', account: 'Work', to: ['a@example.edu'] },
    { op: 'mail.draft', subject: 'x', body: 'y' },
    { op: 'notes.create', folder: 'Assistant', title: '早间简报', body: '第一行\n第二行' },
  ]);
  assert.equal(tools.notes_create.parameters.properties.folder, undefined);
  await tools.mail_reply_draft.execute({ id: mailId('Work', '收件箱', 42), body: '谢谢老师', reply_all: true }, exec);
  await tools.mail_reply_draft.execute({ id: mailId('Gmail', 'INBOX', 7), body: 'ok', reply_all: 'yes' }, exec);
  assert.deepEqual(runs.slice(-2), [
    { op: 'mail.reply', account: 'Work', mailbox: '收件箱', message_id: 42, body: '谢谢老师', reply_all: true },
    { op: 'mail.reply', account: 'Gmail', mailbox: 'INBOX', message_id: 7, body: 'ok' },
  ]);
  await assert.rejects(tools.mail_reply_draft.execute({ id: 'nope', body: 'x' }, exec), /message id returned by mail_list/);
  await assert.rejects(tools.mail_draft.execute({ subject: ' ', body: 'y' }, exec), /subject must be a non-empty string/);
  await assert.rejects(tools.notes_create.execute({ title: 't' }, exec), /body must be a non-empty string/);
});

test('creating asks for confirmation first and only runs after 创建', async () => {
  const confirmed = setup({ selected: ['创建'] });
  await confirmed.tools.reminders_create.execute({ title: '喝水', due: '2026-10-28T09:00+08:00' }, exec);
  assert.deepEqual(confirmed.runs, [{ op: 'reminders.create', title: '喝水', due: '2026-10-28T09:00:00+08:00' }]);
  const card = confirmed.asked[0];
  assert.equal(card.agent, exec.agent);
  assert.equal(card.signal, signal);
  assert.deepEqual(card.questions[0].options.map(option => option.label), ['创建', '取消']);
  assert.equal(card.questions[0].detail, `标题：喝水\n时间：${describeWhen('2026-10-28T09:00:00+08:00')}\n列表：默认列表`);

  for (const [answer, expected] of [
    [{ selected: ['取消'] }, { created: false, reason: 'the user did not confirm', conflicts: [] }],
    [{ selected: [], custom: '改成十点' }, { created: false, user_feedback: '改成十点', conflicts: [] }],
    [Object.assign(new Error('closed'), { code: 'ASK_CANCELLED' }), { created: false, reason: 'the user did not confirm', conflicts: [] }],
  ]) {
    const { tools, runs } = setup(answer);
    assert.deepEqual(await tools.calendar_create.execute({ title: '组会', start: '2026-10-28T14:00+08:00', end: '2026-10-28T15:00+08:00' }, exec), expected);
    // Only the conflict check read the calendar; nothing was written.
    assert.deepEqual(runs.map(request => request.op), ['calendar.events']);
  }

  const { tools, runs } = setup();
  await assert.rejects(tools.reminders_create.execute({ title: '喝水' }, exec), /nothing was created/);
  await assert.rejects(setup({ selected: ['创建'] }).tools.calendar_create.execute({ title: 'x', start: '2026-10-28', end: '2026-10-28', alert_minutes: -5 }, exec), /alert_minutes/);
  assert.equal(runs.length, 0);
});

test('built apple module registers its tools through the preset subpath', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.exports['./apple'], './lib/apple.js');
  assert.ok(pkg.files.includes('helper/PersonalAgentHelper.app'));
  const plugin = await import('../lib/apple.js');
  const registered = [];
  plugin.apply({ tools: { register: tool => registered.push(tool.name) }, get: () => undefined });
  assert.equal(registered.length, 16);
  assert.equal(registered.slice(-4).join(), 'todo_add,reminders_complete,reminders_update,calendar_update');
  assert.equal(pkg.exports['./arxiv'], './lib/arxiv.js');
  const arxiv = [];
  (await import('../lib/arxiv.js')).apply({ tools: { register: tool => arxiv.push(tool.name) } });
  assert.deepEqual(arxiv, ['arxiv_search']);
  assert.equal(pkg.exports['./bib'], './lib/bib.js');
  const bibPlugin = await import('../lib/bib.js');
  const bib = [];
  bibPlugin.apply({ tools: { register: tool => bib.push(tool.name) } });
  assert.deepEqual(bib, []);
  bibPlugin.apply({ tools: { register: tool => bib.push(tool.name) } }, { bibLibrary: '/tmp/references.bib' });
  assert.deepEqual(bib, ['bib_add']);
  const info = await readFile(new URL('../helper/PersonalAgentHelper.app/Contents/Info.plist', import.meta.url), 'utf8');
  for (const key of ['NSCalendarsFullAccessUsageDescription', 'NSRemindersFullAccessUsageDescription', 'NSAppleEventsUsageDescription', 'LSUIElement']) assert.ok(info.includes(key), key);
});

test('todo_add writes only to the assistant list, without asking, and skips an open duplicate', async () => {
  const runs = [];
  const run = async request => {
    runs.push(request);
    return request.op === 'reminders.list' ? { reminders: [{ title: '回复导师邮件' }], lists: [] } : { created: true };
  };
  const tool = todoTool({ run, list: TODO_LIST });
  assert.equal(tool.name, 'todo_add');
  assert.equal(tool.parameters.properties.list, undefined);
  assert.deepEqual(await tool.execute({ title: ' 交 HW5 ', due: '2026-11-20T23:59-05:00', notes: 'Canvas', list: '其他' }, exec), { created: true });
  assert.deepEqual(runs.splice(0), [
    { op: 'reminders.list', list: TODO_LIST },
    { op: 'reminders.create', title: '交 HW5', list: TODO_LIST, due: '2026-11-20T23:59:00-05:00', notes: 'Canvas' },
  ]);
  const duplicate = await tool.execute({ title: '回复导师邮件' }, exec);
  assert.equal(duplicate.created, false);
  assert.deepEqual(runs.map(request => request.op), ['reminders.list']);
  await assert.rejects(tool.execute({ title: '  ' }, exec), /title must be a non-empty string/);
});

test('reminders_complete finishes assistant to-dos without asking and asks for other lists', async () => {
  const make = (reminder, answer) => {
    const runs = [], asked = [];
    const questions = answer === undefined ? () => undefined : () => ({ ask: async request => { asked.push(request); return { answers: [{ id: 'confirm', ...answer }] }; } });
    const run = async request => { runs.push(request); return request.op === 'reminders.get' ? { reminder } : { completed: true, reminder: { ...reminder, completed: true } }; };
    return { tool: completeTool({ run, questions, list: TODO_LIST }), runs, asked };
  };
  const own = make({ id: 'r1', title: '交课程周报', list: TODO_LIST, completed: false });
  assert.equal((await own.tool.execute({ id: 'r1' }, exec)).completed, true);
  assert.deepEqual(own.runs, [{ op: 'reminders.get', id: 'r1' }, { op: 'reminders.complete', id: 'r1', list: TODO_LIST }]);

  const other = { id: 'r2', title: '提交周反思', list: '提醒', due: '2026-11-15T20:00:00-05:00', completed: false };
  const yes = make(other, { selected: ['完成'] });
  assert.equal((await yes.tool.execute({ id: 'r2' }, exec)).completed, true);
  assert.deepEqual(yes.runs.at(-1), { op: 'reminders.complete', id: 'r2' });
  assert.deepEqual(yes.asked[0].questions[0].options.map(option => option.label), ['完成', '取消']);
  assert.match(yes.asked[0].questions[0].detail, /标题：提交周反思\n列表：提醒/);

  const no = make(other, { selected: ['取消'] });
  assert.deepEqual(await no.tool.execute({ id: 'r2' }, exec), { completed: false, reason: 'the user did not confirm' });
  assert.equal(no.runs.length, 1);

  const done = make({ ...other, completed: true });
  assert.equal((await done.tool.execute({ id: 'r2' }, exec)).reason, 'already completed');
  await assert.rejects(make(other).tool.execute({ id: 'r2' }, exec), /cannot ask the user to confirm/);
});
