// Times here are checked in New York, which has a daylight-saving change on 2026-11-01.
process.env.TZ = 'America/New_York';
import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftWhen, readShift, readRepeat, describeRepeat, conflicts, freeSlots } from '../src/when.js';
import { changeTools, appleTools } from '../src/apple.js';

const exec = { agent: {}, signal: new AbortController().signal };

test('postponing keeps the wall-clock time across daylight saving, and dates stay dates', () => {
  assert.equal(shiftWhen('2026-10-31T09:00:00-04:00', { days: 1 }), '2026-11-01T09:00:00-05:00');
  assert.equal(shiftWhen('2026-03-07T21:30:00-05:00', { weeks: 1 }), '2026-03-14T21:30:00-04:00');
  assert.equal(shiftWhen('2026-11-16T09:00:00+08:00', { days: 1 }), '2026-11-16T20:00:00-05:00');
  assert.equal(shiftWhen('2026-11-16', { days: 1 }), '2026-11-17');
  assert.equal(shiftWhen('2026-01-31', { months: 1 }), '2026-02-28');
  assert.equal(shiftWhen('2026-11-16T23:30:00-05:00', { hours: 1 }), '2026-11-17T00:30:00-05:00');
  assert.throws(() => shiftWhen('2026-11-16', { hours: 2 }), /date-only/);
  assert.throws(() => readShift({ days: 0 }), /non-zero/);
  assert.throws(() => readShift({ fortnights: 1 }), /not one of/);
});

test('repeat rules are validated and described', () => {
  assert.deepEqual(readRepeat({ frequency: 'weekly', until: '2026-12-15' }), { frequency: 'weekly', until: '2026-12-15' });
  assert.equal(describeRepeat({ frequency: 'weekly', until: '2026-12-15' }), '每周，到 2026-12-15 为止');
  assert.equal(describeRepeat({ frequency: 'monthly', interval: 2, count: 6 }), '每 2 个月，共 6 次');
  assert.equal(readRepeat('none', { allowNone: true }), 'none');
  assert.throws(() => readRepeat('none'), /only for changing/);
  assert.throws(() => readRepeat({ frequency: 'hourly' }), /frequency/);
  assert.throws(() => readRepeat({ frequency: 'daily', until: '2026-12-15', count: 3 }), /not both/);
});

const DAY = [
  { id: 'e1', title: '组会', start: '2026-11-17T15:00:00-05:00', end: '2026-11-17T16:00:00-05:00', all_day: false, calendar: 'Work' },
  { id: 'e2', title: '假期', start: '2026-11-17', end: '2026-11-17', all_day: true, calendar: 'Home' },
  { id: 'e3', title: 'Office hour', start: '2026-11-17T10:00:00-05:00', end: '2026-11-17T12:00:00-05:00', all_day: false, calendar: 'Work' },
];

test('conflicts ignore all-day events and the event being moved; free slots are nearest first', () => {
  assert.deepEqual(conflicts(DAY, '2026-11-17T15:30:00-05:00', '2026-11-17T16:30:00-05:00').map(event => event.id), ['e1']);
  assert.deepEqual(conflicts(DAY, '2026-11-17T15:30:00-05:00', '2026-11-17T16:30:00-05:00', { ignore: 'e1' }), []);
  assert.deepEqual(conflicts(DAY, '2026-11-17T12:00:00-05:00', '2026-11-17T15:00:00-05:00'), []);
  assert.deepEqual(freeSlots(DAY, '2026-11-17T15:30:00-05:00', '2026-11-17T16:30:00-05:00').map(slot => slot.start.slice(11, 16)), ['14:00', '16:00', '16:30']);
});

function fake(answer, { reminder, events = DAY } = {}) {
  const runs = [], asked = [];
  const questions = () => ({ ask: async request => { asked.push(request); return { answers: [{ id: 'confirm', ...answer }] }; } });
  const run = async request => {
    runs.push(request);
    if (request.op === 'reminders.get') return { reminder };
    if (request.op === 'calendar.events') return { events };
    return { updated: true, request };
  };
  const tools = Object.fromEntries(changeTools({ run, questions }).map(tool => [tool.name, tool]));
  return { tools, runs, asked, writes: () => runs.filter(request => request.op.endsWith('.update')) };
}

const REMINDER = { id: 'r1', external_id: 'x1', title: '交作业 3', list: 'Assistant', due: '2026-11-16T23:59:00-05:00' };

test('reminders_update shows old and new values, postpones from the current due time, and changes nothing when declined', async () => {
  const yes = fake({ selected: ['修改'] }, { reminder: REMINDER });
  await yes.tools.reminders_update.execute({ external_id: 'x1', postpone: { days: 1 } }, exec);
  assert.deepEqual(yes.writes(), [{ op: 'reminders.update', external_id: 'x1', due: '2026-11-17T23:59:00-05:00' }]);
  const card = yes.asked[0].questions[0];
  assert.deepEqual(card.options.map(option => option.label), ['修改', '取消']);
  assert.match(card.detail, /时间：11月16日（周一）23:59 → 11月17日（周二）23:59\n原来时间的提醒会取消。/);

  const no = fake({ selected: ['取消'] }, { reminder: REMINDER });
  const declined = await no.tools.reminders_update.execute({ id: 'r1', due: '2026-11-20' }, exec);
  assert.equal(declined.updated, false);
  assert.deepEqual(no.writes(), []);

  await assert.rejects(fake({}, { reminder: { ...REMINDER, due: undefined } }).tools.reminders_update.execute({ id: 'r1', postpone: { days: 1 } }, exec), /no due time/);
  await assert.rejects(yes.tools.reminders_update.execute({ id: 'r1', due: '2026-11-20', postpone: { days: 1 } }, exec), /only one of/);
  await assert.rejects(yes.tools.reminders_update.execute({ id: 'r1' }, exec), /nothing to change/);
});

test('calendar_update keeps the length, asks for a span on repeating events, and lists conflicts', async () => {
  const office = DAY[2];
  const yes = fake({ selected: ['修改'] });
  const result = await yes.tools.calendar_update.execute({ id: 'e3', occurrence: office.start, start: '2026-11-17T14:30:00-05:00' }, exec);
  assert.deepEqual(yes.writes(), [{ op: 'calendar.update', id: 'e3', occurrence: office.start, start: '2026-11-17T14:30:00-05:00', end: '2026-11-17T16:30:00-05:00' }]);
  assert.deepEqual(result.conflicts.map(event => event.title), ['组会']);
  assert.match(yes.asked[0].questions[0].detail, /与 1 个日程时间重叠：组会/);

  const weekly = [{ ...DAY[0], repeat: { frequency: 'weekly', interval: 1 } }];
  const repeating = fake({ selected: ['修改'] }, { events: weekly });
  await assert.rejects(repeating.tools.calendar_update.execute({ id: 'e1', occurrence: DAY[0].start, postpone: { days: 1 } }, exec), /span/);
  await repeating.tools.calendar_update.execute({ id: 'e1', occurrence: DAY[0].start, postpone: { days: 1 }, span: 'this' }, exec);
  assert.deepEqual(repeating.writes()[0], { op: 'calendar.update', id: 'e1', occurrence: DAY[0].start, span: 'this', start: '2026-11-18T15:00:00-05:00', end: '2026-11-18T16:00:00-05:00' });
  assert.match(repeating.asked[0].questions[0].detail, /范围：仅这一次（每周）/);

  const no = fake({ selected: ['取消'] });
  assert.equal((await no.tools.calendar_update.execute({ id: 'e3', occurrence: office.start, postpone: { weeks: 1 } }, exec)).updated, false);
  assert.deepEqual(no.writes(), []);
  await assert.rejects(no.tools.calendar_update.execute({ id: 'nope', occurrence: office.start, title: 'x' }, exec), /no event with this id/);
});

test('creating with a repeat rule passes it on and shows it on the card; a repeating reminder needs a due time', async () => {
  const runs = [], asked = [];
  const tools = Object.fromEntries(appleTools({ run: async request => { runs.push(request); return request.op === 'calendar.events' ? { events: DAY } : { created: true }; }, questions: () => ({ ask: async request => { asked.push(request); return { answers: [{ id: 'confirm', selected: ['创建'] }] }; } }) }).map(tool => [tool.name, tool]));
  const made = await tools.calendar_create.execute({ title: '读书会', start: '2026-11-17T15:30-05:00', end: '2026-11-17T16:30-05:00', repeat: { frequency: 'weekly', count: 4 } }, exec);
  assert.deepEqual(runs.at(-1).repeat, { frequency: 'weekly', count: 4 });
  assert.match(asked[0].questions[0].detail, /重复：每周，共 4 次/);
  assert.match(asked[0].questions[0].detail, /⚠️ 与 1 个日程时间重叠：组会/);
  assert.deepEqual(made.conflicts.map(event => event.title), ['组会']);
  await assert.rejects(tools.reminders_create.execute({ title: '喝水', repeat: { frequency: 'daily' } }, exec), /needs a due date/);
});
