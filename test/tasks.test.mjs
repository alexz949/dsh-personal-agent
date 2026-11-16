import test from 'node:test';
import assert from 'node:assert/strict';
import { taskStore, taskTools, sameWhen, changedOn } from '../src/tasks.js';
import { mailId } from '../src/apple.js';

const LIST = 'Assistant';
const exec = { agent: {}, signal: new AbortController().signal };
const MAIL = mailId('Gmail', 'INBOX', 42);

function memoryStore() {
  const files = new Map();
  const enoent = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const store = taskStore('/s/tasks.json', {
    read: async file => { if (!files.has(file)) throw enoent(); return files.get(file); },
    write: async (file, text) => { files.set(file, text); },
    move: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    mkdirp: async () => {},
  });
  return { store, files };
}

/** A fake helper: mail meta, reminders keyed by external id, and a reply state per subject. */
function fakeApple() {
  const state = { reminders: new Map(), replies: { replied: false, drafts: 0 }, fail: new Set(), runs: [] };
  let next = 1;
  const run = async request => {
    state.runs.push(request);
    if (state.fail.has(request.op)) throw Object.assign(new Error('Mail is not responding'), { code: 'mail_failed' });
    switch (request.op) {
      case 'mail.meta': return { account: 'Gmail', mailbox: 'INBOX', id: 42, message_id: '<abc@mail.example.com>', from: 'Prof. Rivera <rivera@example.edu>', subject: 'Letter of recommendation', received: '2026-11-10T09:00:00-05:00' };
      case 'reminders.create': {
        const reminder = { id: `local-${next}`, external_id: `ext-${next++}`, title: request.title, list: request.list, due: request.due, completed: false };
        state.reminders.set(reminder.external_id, reminder);
        return { created: true, reminder };
      }
      case 'reminders.get': {
        const reminder = [...state.reminders.values()].find(item => item.external_id === request.external_id || item.id === request.id);
        if (!reminder) throw Object.assign(new Error('gone'), { code: 'not_found' });
        return { reminder };
      }
      case 'reminders.complete': state.reminders.get(request.external_id).completed = true; return { completed: true };
      case 'mail.reply_status': return { ...state.replies, checked: {} };
      default: throw new Error(`unexpected op ${request.op}`);
    }
  };
  return { run, state };
}

function setup() {
  const { store, files } = memoryStore();
  const apple = fakeApple();
  const tools = Object.fromEntries(taskTools({ store, run: apple.run, todoList: LIST, now: () => new Date('2026-11-16T15:00:00Z') }).map(tool => [tool.name, tool]));
  return { tools, apple, files };
}

test('the same email checked twice makes one task', async () => {
  const { tools, files } = setup();
  const first = await tools.task_create.execute({ title: '回复推荐信邮件', mail_id: MAIL, done_when: 'replied' }, exec);
  const again = await tools.task_create.execute({ title: '回推荐信', mail_id: MAIL }, exec);
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.task.id, first.task.id);
  assert.equal(JSON.parse(files.get('/s/tasks.json')).tasks.length, 1);
  assert.equal(first.task.source.message_id, '<abc@mail.example.com>');
});

test('a saved draft is not a sent reply; the reply is seen once it is sent', async () => {
  const { tools, apple } = setup();
  const { task } = await tools.task_create.execute({ title: '回复推荐信邮件', mail_id: MAIL, done_when: 'replied', add_todo: true }, exec);
  const drafted = await tools.task_update.execute({ id: task.id, draft_subject: 'Re: Letter of recommendation' }, exec);
  assert.equal(drafted.task.status, 'doing');
  assert.equal(drafted.task.next, '检查草稿并发送');

  apple.state.replies = { replied: false, drafts: 1 };
  let listed = await tools.task_list.execute({}, exec);
  assert.equal(listed.tasks[0].status, 'doing');
  assert.equal(listed.tasks[0].draft_state, 'saved');
  assert.equal(listed.sync.ok, true);

  apple.state.replies = { replied: true, drafts: 0, sent_at: '2026-11-16T10:05:00-05:00', match: 'subject' };
  listed = await tools.task_list.execute({}, exec);
  assert.equal(listed.tasks[0].status, 'done');
  assert.equal(listed.tasks[0].draft_state, 'sent');
  assert.deepEqual(listed.sync.changed.map(item => item.change), ['已回复（2026-11-16T10:05:00-05:00）', '已勾掉关联的待办']);
  assert.equal(apple.state.reminders.get(task.links.reminder.external_id).completed, true);
});

test('a reply moves a task without done_when "replied" to waiting on the sender', async () => {
  const { tools, apple } = setup();
  const { task } = await tools.task_create.execute({ title: '请推荐人确认提交', mail_id: MAIL, done_when: '推荐信已提交' }, exec);
  await tools.task_update.execute({ id: task.id, draft_subject: 'Re: Letter of recommendation' }, exec);
  apple.state.replies = { replied: true, drafts: 0, sent_at: '2026-11-16T10:05:00-05:00', match: 'header' };
  const [listed] = (await tools.task_list.execute({}, exec)).tasks;
  assert.equal(listed.status, 'waiting');
  assert.equal(listed.waiting_on, 'Prof. Rivera <rivera@example.edu>');
});

test('completing the reminder in Reminders shows up in task_list, and the due time follows Reminders', async () => {
  const { tools, apple } = setup();
  const { task } = await tools.task_create.execute({ title: '交作业 3', add_todo: true, due: '2026-11-20T23:59-05:00' }, exec);
  assert.equal(task.links.reminder.list, LIST);
  const reminder = apple.state.reminders.get(task.links.reminder.external_id);
  reminder.due = '2026-11-21T23:59:00-05:00';
  let listed = await tools.task_list.execute({}, exec);
  assert.equal(listed.tasks[0].due, '2026-11-21T23:59:00-05:00');
  reminder.completed = true;
  listed = await tools.task_list.execute({}, exec);
  assert.equal(listed.tasks[0].status, 'done');
  assert.equal(listed.sync.ok, true);
});

test('failed checks are reported and never mark tasks done', async () => {
  const { tools, apple } = setup();
  const mail = await tools.task_create.execute({ title: '回复推荐信邮件', mail_id: MAIL, done_when: 'replied' }, exec);
  await tools.task_update.execute({ id: mail.task.id, draft_subject: 'Re: Letter of recommendation' }, exec);
  const todo = await tools.task_create.execute({ title: '交作业 3', add_todo: true }, exec);
  apple.state.fail.add('mail.reply_status');
  apple.state.reminders.clear();
  const listed = await tools.task_list.execute({}, exec);
  assert.equal(listed.sync.ok, false);
  assert.deepEqual(listed.tasks.map(item => item.status), ['doing', 'todo']);
  assert.deepEqual(listed.sync.problems.map(item => item.id), [mail.task.id, todo.task.id]);
  assert.match(listed.sync.problems[0].problem, /没能检查邮件/);
  assert.match(listed.sync.problems[1].problem, /找不到了/);

  apple.state.fail.clear();
  apple.state.replies = { replied: false, drafts: 0 };
  const missing = await tools.task_list.execute({}, exec);
  assert.equal(missing.tasks[0].draft_state, 'missing');
  assert.equal(missing.tasks[0].status, 'doing');
});

test('done completes a linked assistant to-do; a reminder in another list is left open', async () => {
  const { tools, apple } = setup();
  const own = await tools.task_create.execute({ title: '交作业 3', add_todo: true }, exec);
  const done = await tools.task_update.execute({ id: own.task.id, status: 'done' }, exec);
  assert.equal(done.reminder, 'completed');
  assert.equal(apple.state.reminders.get(own.task.links.reminder.external_id).completed, true);

  apple.state.reminders.set('ext-other', { id: 'r-other', external_id: 'ext-other', title: '牙医', list: '提醒', completed: false });
  const other = await tools.task_create.execute({ title: '看牙医', reminder_id: 'r-other' }, exec);
  assert.equal((await tools.task_create.execute({ title: '牙医', reminder_id: 'r-other' }, exec)).created, false);
  const cancelled = await tools.task_update.execute({ id: other.task.id, status: 'cancelled' }, exec);
  assert.match(cancelled.reminder, /left open/);
  assert.equal(apple.state.reminders.get('ext-other').completed, false);
  await assert.rejects(tools.task_update.execute({ id: 't-nope', status: 'done' }, exec), /no task with id/);
});

test('helpers: same instant in another offset, and the day\'s changes for the journal', () => {
  assert.equal(sameWhen('2026-11-20T23:59:00-05:00', '2026-11-21T04:59:00Z'), true);
  assert.equal(sameWhen('2026-11-20', '2026-11-20T00:00:00-05:00'), false);
  assert.equal(sameWhen(undefined, null), true);
  const tasks = [{ id: 't-1', title: 'A', status: 'done', history: [{ at: '2026-11-16T15:00:00.000Z', what: '新建' }, { at: '2026-11-17T01:00:00.000Z', what: '完成' }] }];
  assert.deepEqual(changedOn(tasks, '2026-11-16').map(item => item.what), ['新建']);
});

test('writes are queued so concurrent creates never lose a task', async () => {
  const { tools, files } = setup();
  await Promise.all(Array.from({ length: 5 }, (_, i) => tools.task_create.execute({ title: `事项 ${i}` }, exec)));
  assert.equal(JSON.parse(files.get('/s/tasks.json')).tasks.length, 5);
});
