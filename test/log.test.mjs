import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionLogger, stamp, withLog } from '../src/log.js';

const exec = { agent: {}, signal: new AbortController().signal };
const fake = (name, value) => ({ name, description: '', parameters: {}, execute: async () => value });

test('only real changes by write tools are logged, one line each with the local time', async () => {
  const lines = [];
  const log = async (tool, text) => { lines.push(`${tool} · ${text}`); };
  const tools = withLog([
    fake('calendar_events', { events: [] }),
    fake('todo_add', { created: true, reminder: { title: '[PhD] 交材料', list: 'Assistant', due: '2026-11-24T09:00:00-05:00' } }),
    fake('reminders_create', { created: false, reason: 'the user did not confirm' }),
    fake('mail_draft', { saved: true, sent: false, from: 'me@example.edu', to: [], subject: '推荐信\n提醒' }),
    fake('mail_reply_draft', { saved: true, sent: false, from: 'a@gmail.com', to: ['b@x.edu'], subject: 'Re: Letter' }),
    fake('notes_create', { created: true, folder: '助手', title: '早间简报' }),
    fake('bib_add', { added: false, reason: 'already in the library', key: 'k' }),
    fake('bib_add', { added: true, key: 'lovelace2026', title: 'Example Paper' }),
  ], log);
  for (const tool of tools) await tool.execute({}, exec);
  assert.deepEqual(lines, [
    'todo_add · 加入助手待办：[PhD] 交材料（Assistant，2026-11-24T09:00:00-05:00）',
    'mail_draft · 存邮件草稿：推荐信 提醒（发件 me@example.edu，收件 （未填））',
    'mail_reply_draft · 存回复草稿：Re: Letter（发件 a@gmail.com，收件 b@x.edu）',
    'notes_create · 新建备忘录：助手/早间简报',
    'bib_add · 加入 JabRef：lovelace2026（Example Paper）',
  ]);
});

test('a calendar change to the repeat rule logs the old and new rule and how many occurrences dropped', async () => {
  const lines = [];
  const before = { title: '周会', start: '2026-11-16T21:30:00-05:00', repeat: { frequency: 'weekly', interval: 1, until: '2026-12-14' } };
  const [tool] = withLog([fake('calendar_update', { updated: true, span: 'future', before, event: { ...before, repeat: { ...before.repeat, until: '2026-11-16' } }, dropped_occurrences: ['a', 'b', 'c', 'd'] })], async (_tool, text) => { lines.push(text); });
  await tool.execute({ repeat: { frequency: 'weekly', until: '2026-11-16' } }, exec);
  assert.deepEqual(lines, ['修改日程：周会（2026-11-16T21:30:00-05:00 → 2026-11-16T21:30:00-05:00，本次及以后，重复：每周，到 2026-12-14 为止 → 每周，到 2026-11-16 为止，之后 4 次不再出现）']);
});

test('a failed log write never fails the action, and lines append to the file', async () => {
  const broken = withLog([fake('notes_create', { created: true, folder: '助手', title: 't' })], async () => { throw new Error('disk full'); });
  assert.deepEqual(await broken[0].execute({}, exec), { created: true, folder: '助手', title: 't' });
  const dir = await mkdtemp(join(tmpdir(), 'log-test-'));
  try {
    const path = join(dir, 'nested', 'actions.md');
    const log = actionLogger({ path, now: () => new Date(2026, 10, 15, 5, 40) });
    await log('todo_add', 'a');
    await log('bib_add', 'b');
    const when = stamp(new Date(2026, 10, 15, 5, 40));
    assert.match(when, /^2026-11-15 05:40 [+-]\d{2}:\d{2}$/);
    assert.equal(await readFile(path, 'utf8'), `- ${when} · todo_add · a\n- ${when} · bib_add · b\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
