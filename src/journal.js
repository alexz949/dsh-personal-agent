// The assistant's journal in the workspace's journal/ folder. Each week is one Markdown file with a
// section per day (written at the end of the day) and, once the week is over, a 本周总结 section on
// top. Months get their own summary file, made from that month's weeks; quarters and years only when
// the user asks. Daily sections are never removed: summaries are added on top, not instead.
//
//   journal/2026/2026-W46.md   week: # header, ## 本周总结, ## 2026-11-09 周一 ... ## 2026-11-15 周日
//   journal/2026/2026-11.md    month       journal/2026/2026-Q4.md   quarter       journal/2026/2026.md   year
//
// Paths, ISO week numbers and which summaries are still missing are worked out here, not by the model.
import { readFile, writeFile, rename, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TODAY_FILE, parseBrief, localDay } from './home.js';
import { loadSettings } from './config.js';
import { changedOn } from './tasks.js';

export const name = 'personal-agent-journal';
export const inject = ['tools', 'workingDirectory'];

export const JOURNAL_DIR = 'journal';
export const SUMMARY_HEADING = '## 本周总结';
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad = value => String(value).padStart(2, '0');

/** A YYYY-MM-DD string as a local date at noon (noon keeps day arithmetic clear of DST shifts). */
export function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) throw new Error(`date must be YYYY-MM-DD, got "${value}"`);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (localDay(date) !== match[0]) throw new Error(`no such date: ${value}`);
  return date;
}

const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);

/** ISO 8601 week: weeks start on Monday and belong to the year that holds their Thursday. */
export function isoWeek(date) {
  const day = date.getDay() || 7;
  const monday = addDays(date, 1 - day);
  const thursday = addDays(monday, 3);
  const year = thursday.getFullYear();
  const firstThursday = addDays(new Date(year, 0, 4, 12), 4 - (new Date(year, 0, 4, 12).getDay() || 7));
  const week = 1 + Math.round((thursday - firstThursday) / (7 * 864e5));
  return { year, week, monday, sunday: addDays(monday, 6), id: `${year}-W${pad(week)}` };
}

export function periodOf(period, date) {
  const y = date.getFullYear(), m = date.getMonth() + 1;
  if (period === 'day' || period === 'week') {
    const w = isoWeek(date);
    return { kind: period, id: w.id, file: `${JOURNAL_DIR}/${w.year}/${w.id}.md`, start: localDay(w.monday), end: localDay(w.sunday), title: `# ${w.year} 年第 ${w.week} 周（${localDay(w.monday).slice(5)} 至 ${localDay(w.sunday).slice(5)}）` };
  }
  if (period === 'month') return { kind: period, id: `${y}-${pad(m)}`, file: `${JOURNAL_DIR}/${y}/${y}-${pad(m)}.md`, start: localDay(new Date(y, m - 1, 1, 12)), end: localDay(new Date(y, m, 0, 12)), title: `# ${y} 年 ${m} 月` };
  if (period === 'quarter') {
    const q = Math.ceil(m / 3);
    return { kind: period, id: `${y}-Q${q}`, file: `${JOURNAL_DIR}/${y}/${y}-Q${q}.md`, start: localDay(new Date(y, q * 3 - 3, 1, 12)), end: localDay(new Date(y, q * 3, 0, 12)), title: `# ${y} 年第 ${q} 季度` };
  }
  if (period === 'year') return { kind: period, id: `${y}`, file: `${JOURNAL_DIR}/${y}/${y}.md`, start: `${y}-01-01`, end: `${y}-12-31`, title: `# ${y} 年` };
  throw new Error('period must be day, week, month, quarter or year');
}

/** Headings in the model's text are pushed below the file's own section level. */
function body(text) {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!clean) throw new Error('text is empty');
  return clean.split('\n').map(line => line.replace(/^#{1,2}\s+/, '### ')).join('\n');
}

/** Split a week file into its sections, keyed by heading line. */
function sections(text) {
  const out = [];
  let current;
  for (const line of String(text ?? '').split('\n')) {
    if (/^##\s/.test(line)) { current = { heading: line.trim(), lines: [] }; out.push(current); }
    else if (current) current.lines.push(line);
  }
  return out.map(section => ({ heading: section.heading, text: section.lines.join('\n').trim() }));
}

const dayHeading = date => `## ${localDay(date)} ${WEEKDAYS[date.getDay()]}`;
const dayOfHeading = heading => /^## (\d{4}-\d{2}-\d{2})/.exec(heading)?.[1];

/** Put one section into a week file: a day's entry (replacing that day's earlier entry) or the
 * week summary. Day sections stay in date order under the summary; other sections are kept. */
export function putWeekSection(text, period, heading, content) {
  const all = sections(text).filter(section => section.heading !== heading);
  all.push({ heading, text: content });
  const summary = all.filter(section => section.heading === SUMMARY_HEADING);
  const days = all.filter(section => dayOfHeading(section.heading)).sort((a, b) => dayOfHeading(a.heading).localeCompare(dayOfHeading(b.heading)));
  const other = all.filter(section => section.heading !== SUMMARY_HEADING && !dayOfHeading(section.heading));
  return `${[period.title, ...[...summary, ...days, ...other].map(section => `${section.heading}\n\n${section.text}`)].join('\n\n')}\n`;
}

export function weekDays(text) {
  return sections(text).map(section => dayOfHeading(section.heading)).filter(Boolean);
}

export const hasSummary = text => sections(text).some(section => section.heading === SUMMARY_HEADING);

/** Week files and month files from the last few months that are finished but have no summary yet. */
export function missingSummaries(files, today) {
  const todayKey = localDay(today);
  const weeks = [];
  for (const [file, text] of Object.entries(files)) {
    const match = /(\d{4})-W(\d{2})\.md$/.exec(file);
    if (!match || hasSummary(text) || weekDays(text).length === 0) continue;
    const period = periodOf('week', parseDay(weekDays(text)[0]));
    if (period.end < todayKey) weeks.push({ week: period.id, file: period.file, start: period.start, end: period.end });
  }
  const months = new Map();
  for (const [file, text] of Object.entries(files)) {
    if (!/-W\d{2}\.md$/.test(file)) continue;
    for (const day of weekDays(text)) {
      const month = periodOf('month', parseDay(day));
      if (month.end >= todayKey || month.file in files) continue;
      const entry = months.get(month.id) ?? { month: month.id, file: month.file, weeks: new Set() };
      entry.weeks.add(file);
      months.set(month.id, entry);
    }
  }
  return {
    weeks: weeks.sort((a, b) => a.week.localeCompare(b.week)),
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map(entry => ({ ...entry, weeks: [...entry.weeks].sort() })),
  };
}

/** Today's lines from the action log, newest last. */
export function actionsOn(text, day) {
  return String(text ?? '').split('\n')
    .map(line => /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) \S+ · \S+ · (.+)$/.exec(line))
    .filter(match => match && match[1] === day)
    .map(match => `${match[2]} ${match[3]}`);
}

const missing = error => { if (error?.code === 'ENOENT') return undefined; throw error; };

export function journalTools({ workspace, actionLog, tasksFile, fs = { readFile, writeFile, rename, readdir, mkdir }, now = () => new Date() }) {
  const read = file => fs.readFile(file, 'utf8').catch(missing);
  async function put(file, text) {
    await fs.mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, text, 'utf8');
    await fs.rename(temp, file);
  }
  async function root(exec) {
    const dir = await workspace(exec);
    if (!dir) throw new Error('this conversation has no workspace folder, so there is no journal');
    return dir;
  }
  async function journalFiles(dir, today) {
    const files = {};
    for (const year of [today.getFullYear() - 1, today.getFullYear()]) {
      const names = await fs.readdir(join(dir, JOURNAL_DIR, String(year))).catch(error => { if (error?.code === 'ENOENT') return []; throw error; });
      for (const nameInDir of names) {
        if (!/^\d{4}-(W\d{2}|\d{2}|Q\d)\.md$/.test(nameInDir)) continue;
        const file = `${JOURNAL_DIR}/${year}/${nameInDir}`;
        files[file] = /-W\d{2}\.md$/.test(nameInDir) ? await read(join(dir, file)) ?? '' : '';
      }
    }
    return files;
  }
  const card = (title, text) => ({ card: 'generic', title, kind: 'read', content: [{ type: 'text', text }] });
  return [{
    name: 'journal_status',
    description: 'Look at the journal before writing in it: which file holds a given day (this week\'s file), whether that day already has an entry, that day\'s lines from the action log, the tasks that changed that day, the 今日 note (done and open items), and which finished weeks and months still lack a summary, with the files to read for each. Read-only.',
    parameters: { type: 'object', additionalProperties: false, properties: { date: { type: 'string', description: 'YYYY-MM-DD; defaults to today.' } } },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    presentCall: args => card('查看日记', args.date ?? '今天'),
    async execute(args, exec) {
      const today = now();
      const date = args.date === undefined ? today : parseDay(args.date);
      const day = localDay(date);
      const dir = await root(exec);
      const week = periodOf('day', date);
      const weekText = await read(join(dir, week.file));
      const note = parseBrief(await read(join(dir, TODAY_FILE)) ?? '', date);
      const sameDay = note.date === day;
      return {
        date: day,
        weekday: WEEKDAYS[date.getDay()],
        weekFile: week.file,
        written: weekDays(weekText).includes(day),
        actions: actionsOn(await read(actionLog) ?? '', day),
        tasks: tasksFile ? changedOn(JSON.parse(await read(tasksFile) ?? '{"tasks":[]}').tasks ?? [], day).map(({ title, status, what, at }) => ({ title, status, what, at })) : [],
        note: sameDay ? { done: note.done, open: note.items } : { done: [], open: note.items, from: note.date ?? null },
        missing: missingSummaries(await journalFiles(dir, today), today),
      };
    },
  }, {
    name: 'journal_write',
    description: 'Write in the journal without asking first. period "day": that day\'s entry in its week file (writing the same day again replaces the entry); "week": the 本周总结 at the top of that week\'s file; "month", "quarter", "year": that period\'s summary file. date is any day inside the period (defaults to today). Day entries are never deleted by summaries. Write short Markdown in your own words; never email bodies, grades, codes, links or other private details.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        period: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] },
        date: { type: 'string', description: 'YYYY-MM-DD inside the period; defaults to today.' },
        text: { type: 'string', description: 'The entry or summary as Markdown, without a top heading.' },
      },
      required: ['period', 'text'],
    },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    presentCall: args => ({ ...card({ day: '写今日小结', week: '写本周总结', month: '写月度总结', quarter: '写季度总结', year: '写年度总结' }[args.period] ?? '写日记', args.date ?? '今天'), kind: 'edit' }),
    async execute(args, exec) {
      const date = args.date === undefined ? now() : parseDay(args.date);
      const period = periodOf(args.period, date);
      const content = body(args.text);
      const dir = await root(exec);
      const file = join(dir, period.file);
      if (args.period === 'day' || args.period === 'week') {
        const heading = args.period === 'day' ? dayHeading(date) : SUMMARY_HEADING;
        await put(file, putWeekSection(await read(file) ?? '', period, heading, content));
        return { written: true, file: period.file, section: heading.slice(3) };
      }
      await put(file, `${period.title}\n\n${content}\n`);
      return { written: true, file: period.file };
    },
  }];
}

export function apply(ctx, config) {
  const settings = loadSettings(config);
  const workspace = exec => exec.agent === undefined ? undefined : ctx.workingDirectory.ensure(exec.agent, exec.signal);
  for (const definition of journalTools({ workspace, actionLog: settings.actionLog, tasksFile: settings.tasksFile })) ctx.tools.register(definition);
}
