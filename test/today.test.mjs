import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBrief, updateBrief } from '../src/home.js';
import { todayTool } from '../src/today.js';

const now = new Date(2026, 10, 15, 14, 0);
const brief = '# 今日简介 2026-11-15\n- HW5 今晚 23:59 截止\n- 下午 3:00 组会\n- 推荐人 9 天没回复\n';

test('parseBrief separates finished items under 已完成', () => {
  const parsed = parseBrief(`${brief}\n## 已完成\n- 交了报销单\n`, now);
  assert.deepEqual([...parsed.items], ['HW5 今晚 23:59 截止', '下午 3:00 组会', '推荐人 9 天没回复']);
  assert.deepEqual([...parsed.done], ['交了报销单']);
  assert.equal(parsed.stale, false);
});

test('updateBrief adds, finishes, edits and removes items', () => {
  const result = updateBrief(brief, [
    { op: 'done', match: 'HW5' },
    { op: 'add', text: '周五前确认推荐信', first: true },
    { op: 'edit', match: '组会', text: '下午 4:00 组会（改时间了）' },
    { op: 'remove', match: '3' },
  ], now);
  assert.deepEqual(result.items, ['周五前确认推荐信', '下午 4:00 组会（改时间了）']);
  assert.deepEqual(result.done, ['HW5 今晚 23:59 截止']);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.text, '# 今日简介 2026-11-15\n- 周五前确认推荐信\n- 下午 4:00 组会（改时间了）\n\n## 已完成\n- HW5 今晚 23:59 截止\n');
});

test('updateBrief reports what it could not apply and keeps 8 open items at most', () => {
  const result = updateBrief(brief, [{ op: 'done', match: '不存在' }, { op: 'add', text: '下午 3:00 组会' }, { op: 'paint' },
    ...Array.from({ length: 6 }, (_, i) => ({ op: 'add', text: `事项 ${i + 1}` }))], now);
  assert.equal(result.items.length, 8);
  assert.deepEqual(result.skipped.map(item => item.reason), ['no open item matches "不存在"', 'already on the note', 'op must be add, done, edit or remove', 'the note holds at most 8 open items']);
});

test('updateBrief carries an old brief over to today without its finished items', () => {
  const result = updateBrief('# 今日简介 2026-11-14\n- 旧的事\n\n## 已完成\n- 昨天做完的\n', [{ op: 'add', text: '新的事' }], now);
  assert.equal(result.text, '# 今日简介 2026-11-15\n- 旧的事\n- 新的事\n');
  assert.equal(updateBrief('', [{ op: 'add', text: '第一件' }], now).text, '# 今日简介 2026-11-15\n- 第一件\n');
});

test('today_update writes today.md in the conversation workspace through a temp file', async () => {
  const files = new Map([['/w/today.md', brief]]);
  const moves = [];
  const tool = todayTool({
    workspace: async exec => exec.agent === 'a' ? '/w' : undefined,
    read: async file => { if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(file); },
    write: async (file, text) => { files.set(file, text); },
    move: async (from, to) => { moves.push([from, to]); files.set(to, files.get(from)); files.delete(from); },
    now: () => now,
  });
  const value = await tool.execute({ changes: [{ op: 'done', match: '1' }] }, { agent: 'a' });
  assert.equal(value.updated, true);
  assert.deepEqual(value.done, ['HW5 今晚 23:59 截止']);
  assert.equal(moves.length, 1);
  assert.match(files.get('/w/today.md'), /## 已完成\n- HW5/);
  assert.equal((await tool.execute({ changes: [{ op: 'add', text: '下午 3:00 组会' }] }, { agent: 'a' })).updated, false);
  await assert.rejects(tool.execute({ changes: [{ op: 'add', text: 'x' }] }, {}), /no workspace folder/);
  assert.equal(tool.presentCall({ changes: [{ op: 'done', match: 'HW5' }, { op: 'add', text: '新事' }] }).content[0].text, '划掉：HW5\n加上：新事');
});

test('note changes go to the action log', async () => {
  const { DESCRIBE } = await import('../src/log.js');
  assert.equal(DESCRIBE.today_update({ changes: [{ op: 'done', match: 'HW5' }, { op: 'add', text: '周五前确认推荐信' }] }, { updated: true }), '更新今日便签：划掉“HW5”，加上“周五前确认推荐信”');
  assert.equal(DESCRIBE.today_update({ changes: [] }, { updated: false }), false);
});
