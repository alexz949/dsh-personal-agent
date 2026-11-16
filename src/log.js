// A plain-text record of what the assistant changed for the user: every event, reminder, to-do,
// draft, note and JabRef entry it actually created, one line each with the local time. Several of
// these tools act without asking, so the user can always look back at what was done. Lines are
// only appended; a failed write never fails the action itself.
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULTS } from './config.js';
import { describeRepeat } from './when.js';

export const ACTION_LOG = process.env.PERSONAL_AGENT_ACTION_LOG ?? DEFAULTS.actionLog;

const pad = value => String(value).padStart(2, '0');

/** `2026-11-15 05:40 -05:00` in the host's time zone, which is the user's. */
export function stamp(date) {
  const offset = -date.getTimezoneOffset();
  const zone = `${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} ${zone}`;
}

const one = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const people = list => Array.isArray(list) && list.length > 0 ? list.join(', ') : '（未填）';

// What each write tool records, or undefined when nothing was created (declined, skipped, duplicate).
export const DESCRIBE = {
  calendar_create: (args, value) => value?.created && `新建日程：${one(value.event?.title ?? args.title)}（${one(value.event?.start ?? args.start)}，${one(value.event?.calendar ?? '默认日历')}）`,
  reminders_create: (args, value) => value?.created && `新建提醒：${one(value.reminder?.title ?? args.title)}（${one(value.reminder?.list ?? args.list ?? '默认列表')}${value.reminder?.due ? `，${one(value.reminder.due)}` : ''}）`,
  todo_add: (args, value) => value?.created && `加入助手待办：${one(value.reminder?.title ?? args.title)}（${[value.reminder?.list, value.reminder?.due].filter(Boolean).map(one).join('，') || '未设时间'}）`,
  mail_draft: (args, value) => value?.saved && `存邮件草稿：${one(value.subject ?? args.subject)}（发件 ${one(value.from)}，收件 ${people(value.to)}）`,
  mail_reply_draft: (_args, value) => value?.saved && `存回复草稿：${one(value.subject)}（发件 ${one(value.from)}，收件 ${people(value.to)}）`,
  notes_create: (args, value) => value?.created && `新建备忘录：${one(value.folder)}/${one(value.title ?? args.title)}`,
  bib_add: (args, value) => value?.added && `加入 JabRef：${one(value.key)}（${one(value.title ?? args.paper)}）`,
  reminders_complete: (_args, value) => value?.completed && `完成提醒：${one(value.reminder?.title)}（${one(value.reminder?.list)}）`,
  task_create: (_args, value) => value?.created && `新建任务：${one(value.task?.title)}${value.task?.links?.reminder ? '（已加进提醒事项）' : ''}`,
  task_update: (args, value) => value?.updated && args.status && `任务${{ todo: '改为待处理', doing: '开始处理', waiting: '改为等待他人', done: '完成', cancelled: '取消' }[args.status] ?? '更新'}：${one(value.task?.title)}`,
  reminders_update: (_args, value) => value?.updated && `修改提醒：${one(value.before?.title)}（${one(value.before?.due ?? '无时间')} → ${one(value.reminder?.due ?? '无时间')}）`,
  calendar_update: (args, value) => value?.updated && `修改日程：${one(value.before?.title)}（${one(value.before?.start)} → ${one(value.event?.start)}${value.span === 'future' ? '，本次及以后' : ''}${args.repeat !== undefined ? `，重复：${describeRepeat(value.before?.repeat)} → ${describeRepeat(value.event?.repeat)}` : ''}${value.dropped_occurrences?.length ? `，之后 ${value.dropped_occurrences.length} 次不再出现` : ''}）`,
  today_update: (args, value) => value?.updated && `更新今日便签：${(args.changes ?? []).map(change => ({ add: `加上“${one(change.text)}”`, done: `划掉“${one(change.match)}”`, edit: `改“${one(change.match)}”为“${one(change.text)}”`, remove: `去掉“${one(change.match)}”` })[change?.op]).filter(Boolean).join('，')}`,
};

export function actionLogger({ path = ACTION_LOG, now = () => new Date() } = {}) {
  return async (tool, text) => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `- ${stamp(now())} · ${tool} · ${text}\n`, 'utf8');
  };
}

/** Wrap the write tools in a list so each real change is logged; other tools pass through. */
export function withLog(tools, log) {
  return tools.map(tool => {
    const describe = DESCRIBE[tool.name];
    if (describe === undefined) return tool;
    return {
      ...tool,
      async execute(args, exec) {
        const value = await tool.execute(args, exec);
        const text = describe(args, value);
        if (text) await log(tool.name, text).catch(error => process.stderr.write(`action log failed: ${error?.message ?? error}\n`));
        return value;
      },
    };
  });
}
