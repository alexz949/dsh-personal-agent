import test from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, parseDay, periodOf, putWeekSection, missingSummaries, actionsOn, journalTools } from '../src/journal.js';

test('weeks follow ISO 8601 across year ends', () => {
  assert.equal(isoWeek(parseDay('2026-11-15')).id, '2026-W46');
  assert.equal(isoWeek(parseDay('2026-11-16')).id, '2026-W47');
  assert.equal(isoWeek(parseDay('2027-01-01')).id, '2026-W53');
  assert.equal(isoWeek(parseDay('2025-12-29')).id, '2026-W01');
  assert.equal(periodOf('day', parseDay('2026-11-15')).file, 'journal/2026/2026-W46.md');
  assert.equal(periodOf('month', parseDay('2026-11-15')).file, 'journal/2026/2026-11.md');
  assert.equal(periodOf('quarter', parseDay('2026-11-15')).file, 'journal/2026/2026-Q4.md');
  assert.equal(periodOf('year', parseDay('2026-11-15')).file, 'journal/2026/2026.md');
  assert.throws(() => parseDay('2026-02-30'), /no such date/);
});

test('a week file keeps the summary on top and days in order, replacing a rewritten day', () => {
  const week = periodOf('week', parseDay('2026-11-12'));
  let text = putWeekSection('', week, '## 2026-11-13 周五', '- 交了 HW5');
  text = putWeekSection(text, week, '## 2026-11-12 周四', '- 组会');
  text = putWeekSection(text, week, '## 2026-11-13 周五', '- 交了 HW5\n- 存了推荐信跟进草稿');
  text = putWeekSection(text, week, '## 本周总结', '主要进展：HW5 交了。');
  assert.equal(text, '# 2026 年第 46 周（11-09 至 11-15）\n\n## 本周总结\n\n主要进展：HW5 交了。\n\n## 2026-11-12 周四\n\n- 组会\n\n## 2026-11-13 周五\n\n- 交了 HW5\n- 存了推荐信跟进草稿\n');
});

test('missing summaries: finished weeks without 本周总结 and finished months without a file', () => {
  const files = {
    'journal/2026/2026-W44.md': '# w\n\n## 2026-10-30 周五\n\n- a\n',
    'journal/2026/2026-W45.md': '# w\n\n## 本周总结\n\nok\n\n## 2026-11-03 周二\n\n- b\n',
    'journal/2026/2026-W46.md': '# w\n\n## 2026-11-15 周日\n\n- c\n',
  };
  const result = missingSummaries(files, parseDay('2026-11-15'));
  assert.deepEqual(result.weeks.map(item => item.week), ['2026-W44']);
  assert.deepEqual(result.months, [{ month: '2026-10', file: 'journal/2026/2026-10.md', weeks: ['journal/2026/2026-W44.md'] }]);
  assert.deepEqual(missingSummaries({ ...files, 'journal/2026/2026-10.md': '' }, parseDay('2026-11-15')).months, []);
});

test('actionsOn picks that day\'s action log lines', () => {
  const log = '- 2026-11-14 21:10 -05:00 · bib_add · 加入 JabRef：k\n- 2026-11-15 08:07 -05:00 · mail_draft · 存邮件草稿：Re: x\n';
  assert.deepEqual(actionsOn(log, '2026-11-15'), ['08:07 存邮件草稿：Re: x']);
});

test('journal tools report status and write day, week and month files under the workspace', async () => {
  const files = new Map([
    ['/w/today.md', '# 今日简介 2026-11-15\n- 组会\n\n## 已完成\n- 交了 HW5\n'],
    ['/log.md', '- 2026-11-15 08:07 -05:00 · todo_add · 加入助手待办：A\n'],
    ['/w/journal/2026/2026-W45.md', '# w\n\n## 2026-11-06 周五\n\n- old\n'],
  ]);
  const enoent = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const fs = {
    readFile: async file => { if (!files.has(file)) throw enoent(); return files.get(file); },
    writeFile: async (file, text) => { files.set(file, text); },
    rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    mkdir: async () => {},
    readdir: async dir => { const names = [...files.keys()].filter(file => file.startsWith(`${dir}/`)).map(file => file.slice(dir.length + 1)).filter(name => !name.includes('/')); if (names.length === 0) throw enoent(); return names; },
  };
  const [status, write] = journalTools({ workspace: async exec => exec.agent ? '/w' : undefined, actionLog: '/log.md', fs, now: () => parseDay('2026-11-15') });
  const before = await status.execute({}, { agent: 'a' });
  assert.equal(before.weekFile, 'journal/2026/2026-W46.md');
  assert.equal(before.written, false);
  assert.deepEqual(before.actions, ['08:07 加入助手待办：A']);
  assert.deepEqual(before.note, { done: ['交了 HW5'], open: ['组会'] });
  assert.deepEqual(before.missing.weeks.map(item => item.week), ['2026-W45']);
  assert.deepEqual(before.missing.months, []);

  assert.deepEqual(await write.execute({ period: 'day', text: '# 今天\n- 交了 HW5' }, { agent: 'a' }), { written: true, file: 'journal/2026/2026-W46.md', section: '2026-11-15 周日' });
  assert.match(files.get('/w/journal/2026/2026-W46.md'), /## 2026-11-15 周日\n\n### 今天\n- 交了 HW5/);
  await write.execute({ period: 'week', date: '2026-11-06', text: '上周：old' }, { agent: 'a' });
  assert.match(files.get('/w/journal/2026/2026-W45.md'), /^# 2026 年第 45 周（11-02 至 11-08）\n\n## 本周总结\n\n上周：old\n\n## 2026-11-06 周五\n\n- old\n$/);
  await write.execute({ period: 'month', date: '2026-10-15', text: '十月' }, { agent: 'a' });
  assert.equal(files.get('/w/journal/2026/2026-10.md'), '# 2026 年 10 月\n\n十月\n');
  const after = await status.execute({}, { agent: 'a' });
  assert.equal(after.written, true);
  assert.deepEqual(after.missing.weeks, []);
  await assert.rejects(write.execute({ period: 'day', text: ' ' }, { agent: 'a' }), /text is empty/);
  await assert.rejects(status.execute({}, {}), /no workspace folder/);
});
