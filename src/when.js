// Time arithmetic for rescheduling, repeat rules and calendar conflicts. Everything is computed in
// the host's time zone, which is the user's: "postpone a day" keeps the wall-clock time across a
// daylight-saving change, and day-only values stay day-only.

const pad = value => String(value).padStart(2, '0');

/** A local date and time as ISO 8601 with this zone's offset at that moment. */
export function localIso(date) {
  const offset = -date.getTimezoneOffset();
  const zone = `${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${zone}`;
}

export const localDayOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const UNITS = ['minutes', 'hours', 'days', 'weeks', 'months'];

/** Validates {minutes, hours, days, weeks, months} (whole numbers, at least one non-zero). */
export function readShift(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') throw new Error('postpone must be an object like { days: 1 }');
  const shift = {};
  for (const [key, amount] of Object.entries(value)) {
    if (!UNITS.includes(key)) throw new Error(`postpone.${key} is not one of ${UNITS.join(', ')}`);
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > 1000) throw new Error(`postpone.${key} must be a whole number`);
    if (amount !== 0) shift[key] = amount;
  }
  if (Object.keys(shift).length === 0) throw new Error('postpone needs at least one non-zero amount');
  return shift;
}

/** Move a YYYY-MM-DD or ISO time by a shift, keeping local wall-clock time. */
export function shiftWhen(text, shift) {
  const dayOnly = text.length === 10;
  const base = dayOnly ? new Date(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)), 12) : new Date(text);
  if (Number.isNaN(base.getTime())) throw new Error(`cannot read the time ${text}`);
  if (dayOnly && (shift.minutes || shift.hours)) throw new Error('a date-only time can only move by days, weeks or months');
  // Months first, clamped to the month's last day (Jan 31 + 1 month = Feb 28), then the rest.
  const month = base.getMonth() + (shift.months ?? 0);
  const lastDay = new Date(base.getFullYear(), month + 1, 0).getDate();
  const moved = new Date(base.getFullYear(), month, Math.min(base.getDate(), lastDay) + (shift.days ?? 0) + 7 * (shift.weeks ?? 0), base.getHours() + (shift.hours ?? 0), base.getMinutes() + (shift.minutes ?? 0), base.getSeconds());
  return dayOnly ? localDayOf(moved) : localIso(moved);
}

/** Validates a repeat rule: { frequency, interval?, until? | count? } or "none". */
export function readRepeat(value, { allowNone = false } = {}) {
  if (value === undefined) return undefined;
  if (value === 'none') { if (allowNone) return 'none'; throw new Error('repeat "none" is only for changing an existing item'); }
  if (value === null || typeof value !== 'object') throw new Error('repeat must be { frequency: "daily" | "weekly" | "monthly" | "yearly", interval?, until? }');
  const { frequency, interval, until, count } = value;
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(frequency)) throw new Error('repeat.frequency must be daily, weekly, monthly or yearly');
  if (interval !== undefined && (!Number.isSafeInteger(interval) || interval < 1 || interval > 99)) throw new Error('repeat.interval must be 1 to 99');
  if (until !== undefined && count !== undefined) throw new Error('repeat takes until or count, not both');
  if (until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(until))) throw new Error('repeat.until must be YYYY-MM-DD');
  if (count !== undefined && (!Number.isSafeInteger(count) || count < 1 || count > 999)) throw new Error('repeat.count must be 1 to 999');
  return { frequency, ...interval ? { interval } : {}, ...until ? { until } : {}, ...count ? { count } : {} };
}

export function describeRepeat(rule) {
  if (!rule) return '不重复';
  if (rule === 'none') return '取消重复';
  const unit = { daily: '天', weekly: '周', monthly: '个月', yearly: '年' }[rule.frequency] ?? rule.frequency;
  const every = (rule.interval ?? 1) === 1 ? `每${unit === '个月' ? '月' : unit}` : `每 ${rule.interval} ${unit}`;
  return `${every}${rule.until ? `，到 ${rule.until} 为止` : ''}${rule.count ? `，共 ${rule.count} 次` : ''}`;
}

const instant = (value, end = false) => {
  if (value.length !== 10) return Date.parse(value);
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d + (end ? 1 : 0)).getTime();
};

/** Timed events (not all-day ones) that overlap [start, end), excluding the event being moved. */
export function conflicts(events, start, end, { ignore } = {}) {
  const from = instant(start), to = instant(end, end.length === 10);
  return events.filter(event => !event.all_day && event.id !== ignore && instant(event.start) < to && instant(event.end) > from);
}

/** Up to three free slots of the same length on the start's day, between 08:00 and 22:00, nearest
 * to the requested start, on half-hour steps. */
export function freeSlots(events, start, end, { ignore, from = 8, to = 22, limit = 3 } = {}) {
  if (start.length === 10) return [];
  const begin = new Date(start), length = Date.parse(end) - Date.parse(start);
  if (!(length > 0)) return [];
  const busy = events.filter(event => !event.all_day && event.id !== ignore).map(event => [instant(event.start), instant(event.end)]);
  const slots = [];
  for (let minutes = from * 60; minutes + length / 60000 <= to * 60; minutes += 30) {
    const slot = new Date(begin.getFullYear(), begin.getMonth(), begin.getDate(), 0, minutes).getTime();
    if (busy.every(([a, b]) => b <= slot || a >= slot + length)) slots.push(slot);
  }
  return slots.sort((a, b) => Math.abs(a - begin) - Math.abs(b - begin)).slice(0, limit).sort((a, b) => a - b)
    .map(slot => ({ start: localIso(new Date(slot)), end: localIso(new Date(slot + length)) }));
}
