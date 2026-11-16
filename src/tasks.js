// Tasks: one stable record per thing the user has to get done, linked to where it lives in Apple's
// apps. Data ownership is split on purpose:
//   - Reminders owns a linked reminder's state (done, due time); Calendar owns events.
//   - This store (tasks.json) owns only the links and the context: where the task came from (the
//     email's Message-ID), the next step, who it waits on, and when it counts as done.
//   - The 今日 note is a view the assistant updates; it is never read back as state.
// task_list checks the linked apps before answering, so a reminder ticked off in Reminders or a
// reply sent from Mail shows up here, and a failed check is reported as such instead of looking
// like "all done".
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runHelper, parseMailId, normalizeWhen } from './apple.js';
import { loadSettings } from './config.js';
import { actionLogger, withLog } from './log.js';

export const name = 'personal-agent-tasks';
export const inject = ['tools'];

export const STATUSES = ['todo', 'doing', 'waiting', 'done', 'cancelled'];
const OPEN = new Set(['todo', 'doing', 'waiting']);
const LABEL = { todo: '待处理', doing: '进行中', waiting: '等待他人', done: '已完成', cancelled: '已取消' };

const text = value => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
const oneLine = value => String(value ?? '').replace(/\s+/g, ' ').trim();

// ---- the store: a JSON file written atomically, with writes queued inside this process.

const queues = new Map();

export function taskStore(path, { read = readFile, write = writeFile, move = rename, mkdirp = mkdir } = {}) {
  async function load() {
    const raw = await read(path, 'utf8').catch(error => { if (error?.code === 'ENOENT') return ''; throw error; });
    if (raw.trim() === '') return { version: 1, tasks: [] };
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.tasks)) throw new Error(`${path} is not a task file`);
    return data;
  }
  async function save(data) {
    await mkdirp(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await write(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await move(temp, path);
  }
  /** Run fn(data) with exclusive access and save afterwards, unless fn returns `changed: false`
   * (that key is not passed on). */
  function update(fn) {
    const previous = queues.get(path) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const data = await load();
      const { changed, ...result } = await fn(data) ?? {};
      if (changed !== false) await save(data);
      return result;
    });
    queues.set(path, next);
    return next;
  }
  return { load, update };
}

// ---- pure helpers

export const newTaskId = () => `t-${randomUUID().slice(0, 8)}`;

export function findTask(tasks, id) {
  const task = tasks.find(item => item.id === id);
  if (!task) throw new Error(`no task with id ${id}; use task_list to see the ids`);
  return task;
}

/** What the model sees: the task without bulky history, plus a few derived flags. */
export function taskView(task) {
  const { history = [], ...rest } = task;
  return { ...rest, status_label: LABEL[task.status], last_change: history.at(-1) ?? null };
}

/** Two due values name the same time: equal days, or equal instants whatever the offset. */
export function sameWhen(a, b) {
  if ((a ?? null) === (b ?? null)) return true;
  if (!a || !b || a.length === 10 || b.length === 10) return false;
  return Date.parse(a) === Date.parse(b);
}

function note(task, what, at) {
  task.history = [...task.history ?? [], { at, what }].slice(-30);
  task.updated = at;
}

export function changedOn(tasks, day) {
  return tasks.flatMap(task => (task.history ?? []).filter(entry => entry.at.startsWith(day)).map(entry => ({ id: task.id, title: task.title, status: task.status, what: entry.what, at: entry.at })));
}

/** Check one open task against Reminders and Mail. Returns what changed and any problem; never
 * marks a task done because a check failed. */
export async function reconcile(task, { run, signal, at, todoList }) {
  const changes = [], problems = [];
  const reminder = task.links?.reminder;
  if (reminder?.external_id) {
    try {
      const { reminder: now } = await run({ op: 'reminders.get', external_id: reminder.external_id }, signal);
      if (now.completed && OPEN.has(task.status)) {
        task.status = 'done';
        changes.push('提醒事项里已完成');
      }
      if (!sameWhen(now.due, task.due) && !now.completed) {
        changes.push(`截止时间按提醒事项改为 ${now.due ?? '无'}`);
        task.due = now.due ?? null;
      }
      if (now.title && now.title !== reminder.title) task.links.reminder.title = now.title;
    } catch (error) {
      problems.push(error?.code === 'not_found' ? '关联的提醒找不到了（可能已在提醒事项里删除）' : `没能检查提醒事项：${error?.message ?? error}`);
    }
  }
  const source = task.source;
  const expectsReply = source?.kind === 'mail' && (task.links?.draft || task.done_when === 'replied') && !task.links?.reply;
  if (expectsReply && OPEN.has(task.status)) {
    try {
      const status = await run({ op: 'mail.reply_status', subject: source.subject, to: source.from, ...source.message_id ? { message_id: source.message_id } : {}, ...source.account ? { account: source.account } : {}, ...source.received ? { since: source.received } : {} }, signal);
      if (status.replied) {
        task.links = { ...task.links, reply: { sent_at: status.sent_at, match: status.match } };
        if (task.done_when === 'replied') {
          task.status = 'done';
          changes.push(`已回复（${status.sent_at}）`);
          // Done by the reply: tick off its assistant to-do too, so it does not ring later.
          if (reminder?.external_id && reminder.list === todoList) {
            try { await run({ op: 'reminders.complete', external_id: reminder.external_id, list: todoList }, signal); changes.push('已勾掉关联的待办'); }
            catch (error) { problems.push(`已回复，但没能勾掉关联的待办：${error?.message ?? error}`); }
          }
        }
        else { task.status = 'waiting'; task.waiting_on = task.waiting_on ?? source.from; changes.push(`已回复（${status.sent_at}），改为等待对方`); }
        task.draft_state = 'sent';
      } else if (status.drafts > 0) {
        task.draft_state = 'saved';
      } else if (task.links?.draft) {
        task.draft_state = 'missing';
        problems.push('草稿不在“草稿”邮箱里，也没找到已发送的回复（可能在别的设备上发出还没同步，或草稿被删了）');
      }
    } catch (error) {
      problems.push(`没能检查邮件：${error?.message ?? error}`);
    }
  }
  for (const change of changes) note(task, change, at);
  return { changes, problems };
}

// ---- tools

const STATUS = { type: 'string', enum: STATUSES };

export function taskTools({ store, run = runHelper, todoList, now = () => new Date() }) {
  const stamp = () => now().toISOString();
  const card = (title, kind, body) => ({ card: 'generic', title, kind, content: [{ type: 'text', text: body }] });
  const output = { schema: { type: 'object' }, render: (_args, value) => JSON.stringify(value, null, 2) };
  return [{
    name: 'task_create',
    description: `Record a task the user has to get done, with a stable id, without asking first. Pass mail_id (from mail_list) when it comes from an email: the same email never makes a second task, and the existing one is returned instead. Pass reminder_id (from reminders_list) to attach an existing reminder, or add_todo: true to also put it in the user's "${todoList}" Reminders list (then Reminders owns its done state and due time). done_when "replied" means it is done once the user has replied to that email; otherwise write the completion condition in a few words. waiting_on names who the user is waiting for.`,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Short, in your own words.' },
        mail_id: { type: 'string' },
        reminder_id: { type: 'string' },
        add_todo: { type: 'boolean' },
        due: { type: 'string', description: 'YYYY-MM-DD or ISO 8601 with offset.' },
        next: { type: 'string', description: 'The next concrete step.' },
        done_when: { type: 'string' },
        waiting_on: { type: 'string' },
        status: STATUS,
      },
      required: ['title'],
    },
    output,
    presentCall: args => card('记下任务', 'edit', String(args.title ?? '')),
    async execute(args, exec) {
      const title = text(args.title);
      if (!title) throw new Error('title must be a non-empty string');
      const due = args.due === undefined ? undefined : normalizeWhen(args.due, 'due');
      let source = { kind: 'chat' };
      if (args.mail_id !== undefined) {
        const meta = await run({ op: 'mail.meta', ...parseMailId(args.mail_id) }, exec.signal);
        source = { kind: 'mail', message_id: meta.message_id ?? null, account: meta.account, mailbox: meta.mailbox, subject: meta.subject, from: meta.from, received: meta.received };
      }
      let reminder;
      if (args.reminder_id !== undefined) {
        const { reminder: found } = await run({ op: 'reminders.get', id: String(args.reminder_id) }, exec.signal);
        reminder = { external_id: found.external_id, list: found.list, title: found.title };
      }
      return store.update(async data => {
        const same = data.tasks.find(task => (source.message_id && task.source?.message_id === source.message_id) || (reminder && task.links?.reminder?.external_id === reminder.external_id));
        if (same) return { changed: false, created: false, reason: 'a task for this email or reminder already exists', task: taskView(same) };
        if (args.add_todo === true && !reminder) {
          const made = await run({ op: 'reminders.create', title, list: todoList, ...due ? { due } : {}, notes: source.kind === 'mail' ? `来自邮件：${oneLine(source.from)} · ${oneLine(source.subject)}` : undefined }, exec.signal);
          reminder = { external_id: made.reminder.external_id, list: made.reminder.list, title: made.reminder.title };
        }
        const at = stamp();
        const task = {
          id: newTaskId(), title, status: args.status ?? (text(args.waiting_on) ? 'waiting' : 'todo'),
          ...due ? { due } : {}, ...text(args.next) ? { next: text(args.next) } : {}, ...text(args.done_when) ? { done_when: text(args.done_when) } : {},
          ...text(args.waiting_on) ? { waiting_on: text(args.waiting_on) } : {},
          source, links: reminder ? { reminder } : {}, created: at, updated: at, history: [],
        };
        note(task, '新建', at);
        data.tasks.push(task);
        return { created: true, task: taskView(task) };
      });
    },
  }, {
    name: 'task_update',
    description: `Change a task without asking first: status (todo, doing, waiting, done, cancelled), title, due, next step, completion condition or who it waits on. After saving a reply draft for a task's email, pass draft_subject: the task then tracks "draft saved, waiting for the user to send it" and task_list later sees when the reply is actually sent. Marking a task done or cancelled also completes its linked reminder when that reminder is in the "${todoList}" list; a reminder in another list is left alone and reported. Use reminders_update to move a linked reminder's time.`,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string' },
        status: STATUS,
        title: { type: 'string' },
        due: { type: 'string' },
        next: { type: 'string' },
        done_when: { type: 'string' },
        waiting_on: { type: 'string' },
        draft_subject: { type: 'string' },
        note: { type: 'string', description: 'A short note for the task history.' },
      },
      required: ['id'],
    },
    output,
    presentCall: args => card('更新任务', 'edit', [args.status && LABEL[args.status], args.title, args.next, args.draft_subject && `草稿：${args.draft_subject}`].filter(Boolean).join(' · ') || String(args.id ?? '')),
    async execute(args, exec) {
      const due = args.due === undefined ? undefined : normalizeWhen(args.due, 'due');
      return store.update(async data => {
        const task = findTask(data.tasks, String(args.id));
        const at = stamp(), what = [];
        let reminder;
        if (text(args.title)) { task.title = text(args.title); what.push('改了标题'); }
        if (due) { task.due = due; what.push(`截止 ${due}`); }
        for (const field of ['next', 'done_when', 'waiting_on']) if (args[field] !== undefined) task[field] = text(args[field]) ?? undefined;
        if (text(args.draft_subject)) {
          task.links = { ...task.links, draft: { subject: text(args.draft_subject), saved_at: at } };
          task.draft_state = 'saved';
          if (args.status === undefined && task.status === 'todo') task.status = 'doing';
          if (args.next === undefined) task.next = '检查草稿并发送';
          what.push('草稿已保存');
        }
        if (args.status && args.status !== task.status) {
          task.status = args.status;
          what.push(LABEL[args.status]);
          const linked = task.links?.reminder;
          if ((args.status === 'done' || args.status === 'cancelled') && linked?.external_id) {
            if (linked.list === todoList) {
              try { await run({ op: 'reminders.complete', external_id: linked.external_id, list: todoList }, exec.signal); reminder = 'completed'; }
              catch (error) { reminder = `not completed: ${error?.message ?? error}`; }
            } else reminder = `left open: it is in the "${linked.list}" list; use reminders_complete if the user wants it ticked off`;
          }
        }
        if (text(args.note)) what.push(text(args.note));
        if (what.length) note(task, what.join('，'), at);
        return { updated: true, task: taskView(task), ...reminder ? { reminder } : {} };
      });
    },
  }, {
    name: 'task_list',
    description: 'List tasks, after checking linked reminders in Reminders and replies in Mail, so changes the user made directly in those apps show up. Returns sync.ok false with the problems when a check failed; then never tell the user everything is done or that nothing needs attention, say what could not be checked. status "open" (default) lists to-do, in-progress and waiting tasks plus tasks finished today; "all" lists everything.',
    parameters: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', enum: ['open', 'all', ...STATUSES] } } },
    output,
    presentCall: args => card('查看任务', 'read', args.status ?? 'open'),
    async execute(args, exec) {
      const today = now().toISOString().slice(0, 10);
      return store.update(async data => {
        const at = stamp(), changed = [], problems = [];
        for (const task of data.tasks.filter(item => OPEN.has(item.status))) {
          const result = await reconcile(task, { run, signal: exec.signal, at, todoList });
          for (const change of result.changes) changed.push({ id: task.id, title: task.title, change });
          for (const problem of result.problems) problems.push({ id: task.id, title: task.title, problem });
        }
        const want = args.status ?? 'open';
        const shown = data.tasks.filter(task => want === 'all' || (want === 'open' ? OPEN.has(task.status) || (task.updated ?? '').startsWith(today) : task.status === want));
        return { changed: changed.length > 0, tasks: shown.map(taskView), sync: { ok: problems.length === 0, checked: data.tasks.filter(item => OPEN.has(item.status) || changed.some(c => c.id === item.id)).length, changed, problems } };
      });
    },
  }];
}

export function apply(ctx, config) {
  const settings = loadSettings(config);
  const tools = taskTools({ store: taskStore(settings.tasksFile), todoList: settings.todoList });
  for (const definition of withLog(tools, actionLogger({ path: settings.actionLog }))) ctx.tools.register(definition);
}
