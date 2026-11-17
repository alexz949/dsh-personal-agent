// What the Personal home shows: today's brief, which the morning check writes as a short Markdown
// list, and the latest lines of the action log. Both are read as plain text files.
export const TODAY_FILE = 'today.md';

/** The action log's default place, ~/.dsh/personal-agent/actions.md, found from the workspace path
 * because the page cannot ask for the home folder; macOS home folders are /Users/<name>. */
export function actionsPathFor(workspacePath) {
  const home = /^(\/Users\/[^/]+)\//.exec(workspacePath ?? '')?.[1];
  return home ? `${home}/.dsh/personal-agent/actions.md` : undefined;
}
/** The task file's default place, next to the action log: ~/.dsh/personal-agent/tasks.json. */
export function tasksPathFor(workspacePath) {
  const home = /^(\/Users\/[^/]+)\//.exec(workspacePath ?? '')?.[1];
  return home ? `${home}/.dsh/personal-agent/tasks.json` : undefined;
}

const OPEN_TASKS = new Set(['todo', 'doing', 'waiting']);

/** Open tasks from tasks.json for "记下的事": dated ones first, soonest first, then the newest. An
 * unreadable file gives undefined, so the page can say so instead of showing an empty list. */
export function parseOpenTasks(text) {
  if (String(text ?? '').trim() === '') return [];
  let data;
  try { data = JSON.parse(text); } catch { return undefined; }
  if (!Array.isArray(data?.tasks)) return undefined;
  const line = value => typeof value === 'string' && value.trim() !== '' ? value.replace(/\s+/g, ' ').trim() : undefined;
  return data.tasks
    .filter(task => task && OPEN_TASKS.has(task.status) && line(task.title))
    .map(task => ({ id: task.id, title: line(task.title), status: task.status, next: line(task.next), waiting_on: line(task.waiting_on), due: line(task.due), created: String(task.created ?? ''), mail: task.source?.kind === 'mail' }))
    .sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || (a.due && b.due ? Date.parse(a.due.length === 10 ? `${a.due}T23:59:59` : a.due) - Date.parse(b.due.length === 10 ? `${b.due}T23:59:59` : b.due) : b.created.localeCompare(a.created)));
}

// The 今日 note's size: dragged from its bottom corner within these bounds, and remembered. Without
// a chosen height it fits its content and shows the first STICKY_POINTS items.
export const STICKY_SIZE = { width: 272, minWidth: 240, maxWidth: 440, minHeight: 150 };
export const STICKY_POINTS = 5;

export function clampStickySize(size, maxHeight = Infinity) {
  const width = Math.round(Math.min(STICKY_SIZE.maxWidth, Math.max(STICKY_SIZE.minWidth, Number(size?.width) || STICKY_SIZE.width)));
  const wanted = Number(size?.height);
  if (size?.height == null || !Number.isFinite(wanted)) return { width, height: null };
  const top = Math.max(STICKY_SIZE.minHeight, maxHeight);
  return { width, height: Math.round(Math.min(top, Math.max(STICKY_SIZE.minHeight, wanted))) };
}

export const QUICK_ASKS = ['做早间检查', '看看谁还没回我', '这周有哪些截止？'];

const padDay = value => String(value).padStart(2, '0');
export const localDay = date => `${date.getFullYear()}-${padDay(date.getMonth() + 1)}-${padDay(date.getDate())}`;

/** `# 今日简介 2026-11-16` then `- ` lines; items under a later `## 已完成` heading are finished ones.
 * The brief is stale when its date is not today. */
export function parseBrief(text, now = new Date()) {
  const lines = String(text ?? '').split('\n');
  const date = /(\d{4}-\d{2}-\d{2})/.exec(lines.find(line => line.startsWith('#')) ?? '')?.[1];
  const split = lines.findIndex(line => /^##\s/.test(line));
  const listed = part => part.map(line => /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(line)?.[1].trim()).filter(Boolean);
  const items = listed(split < 0 ? lines : lines.slice(0, split)).slice(0, 8);
  const done = split < 0 ? [] : listed(lines.slice(split + 1));
  return { date, items, done, stale: date !== undefined && date !== localDay(now) };
}

export const BRIEF_LIMIT = 8;
const DONE_HEADING = '## 已完成';

/** Find an item by its 1-based number ("2") or by a piece of its text. */
function findItem(items, match) {
  const key = String(match ?? '').trim();
  if (!key) return -1;
  if (/^\d+$/.test(key)) { const index = Number(key) - 1; return index < items.length ? index : -1; }
  const exact = items.findIndex(item => item === key);
  return exact >= 0 ? exact : items.findIndex(item => item.includes(key));
}

const oneLine = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Apply add / done / edit / remove changes to today's brief. A brief from an earlier day is carried
 * over to today with its open items and without its finished ones. Returns the new text, the
 * resulting brief and what could not be applied. */
export function updateBrief(text, changes, now = new Date()) {
  const brief = parseBrief(text, now);
  let items = [...brief.items];
  let done = brief.stale ? [] : [...brief.done];
  const skipped = [];
  for (const change of changes ?? []) {
    const op = change?.op;
    if (op === 'add') {
      const item = oneLine(change.text);
      if (!item) { skipped.push({ change, reason: 'empty text' }); continue; }
      if (items.includes(item)) { skipped.push({ change, reason: 'already on the note' }); continue; }
      if (change.first === true) items.unshift(item); else items.push(item);
      continue;
    }
    const index = findItem(items, change?.match);
    if (op === 'done' || op === 'remove' || op === 'edit') {
      if (index < 0) { skipped.push({ change, reason: `no open item matches "${oneLine(change?.match)}"` }); continue; }
      if (op === 'edit') {
        const item = oneLine(change.text);
        if (!item) { skipped.push({ change, reason: 'empty text' }); continue; }
        items[index] = item;
      } else {
        const [item] = items.splice(index, 1);
        if (op === 'done') done.push(item);
      }
      continue;
    }
    skipped.push({ change, reason: 'op must be add, done, edit or remove' });
  }
  if (items.length > BRIEF_LIMIT) {
    for (const item of items.slice(BRIEF_LIMIT)) skipped.push({ change: { op: 'add', text: item }, reason: `the note holds at most ${BRIEF_LIMIT} open items` });
    items = items.slice(0, BRIEF_LIMIT);
  }
  done = done.slice(-BRIEF_LIMIT);
  const out = [`# 今日简介 ${localDay(now)}`, ...items.map(item => `- ${item}`)];
  if (done.length) out.push('', DONE_HEADING, ...done.map(item => `- ${item}`));
  return { text: `${out.join('\n')}\n`, items, done, skipped };
}

/** The newest action log lines first, as `{ when, tool, text }`. */
export function parseActions(text, limit = 5) {
  return String(text ?? '').split('\n')
    .map(line => /^- (\d{4})-(\d{2}-\d{2} \d{2}:\d{2}) \S+ · (\S+) · (.+)$/.exec(line))
    .filter(Boolean)
    .map(([, , when, tool, what]) => ({ when, tool, text: what }))
    .reverse()
    .slice(0, limit);
}
