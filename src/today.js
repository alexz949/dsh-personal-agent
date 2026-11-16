// today_update: keeps the 今日 note (today.md in the conversation's workspace) current during the
// day, one item at a time, so the model never rewrites the whole file by hand.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { TODAY_FILE, updateBrief } from './home.js';
import { loadSettings } from './config.js';
import { actionLogger, withLog } from './log.js';

export const name = 'personal-agent-today';
export const inject = ['tools', 'workingDirectory'];

const CHANGE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { type: 'string', enum: ['add', 'done', 'edit', 'remove'], description: 'add a new item; done = it is finished (moves under 已完成); edit = reword it; remove = it no longer applies.' },
    text: { type: 'string', description: 'For add and edit: one short sentence in your own words.' },
    match: { type: 'string', description: 'For done, edit and remove: the item number (1 = first) or a piece of its text.' },
    first: { type: 'boolean', description: 'For add: put it first because it is now the most urgent.' },
  },
  required: ['op'],
};

export function todayTool({ workspace, read = readFile, write = writeFile, move = rename, now = () => new Date() }) {
  return {
    name: 'today_update',
    description: `Update the user's 今日 sticky note (${TODAY_FILE} in this workspace) without asking first. Use it during the day whenever something on it gets done (op done), stops applying (remove), changes (edit), or a new thing for today comes up that the user should keep in view, such as a deadline, a meeting or a reply they owe (add; first: true when it is now the most urgent). Keep each item one short sentence; at most 8 open items. Never put email bodies, grades, codes, links or other private details on it. A note from an earlier day is carried over to today automatically. The morning check still writes the whole note with write.`,
    parameters: { type: 'object', additionalProperties: false, properties: { changes: { type: 'array', minItems: 1, items: CHANGE } }, required: ['changes'] },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    presentCall: args => ({ card: 'generic', title: '更新今日便签', kind: 'edit', content: [{ type: 'text', text: (args.changes ?? []).map(describe).join('\n') }] }),
    async execute(args, exec) {
      const dir = await workspace(exec);
      if (!dir) throw new Error('this conversation has no workspace folder, so there is no 今日 note to update');
      const file = join(dir, TODAY_FILE);
      const current = await read(file, 'utf8').catch(error => { if (error?.code === 'ENOENT') return ''; throw error; });
      const result = updateBrief(current, args.changes, now());
      const changed = result.text !== current;
      if (changed) {
        const temp = `${file}.${process.pid}.tmp`;
        await write(temp, result.text, 'utf8');
        await move(temp, file);
      }
      return { updated: changed, items: result.items, done: result.done, ...result.skipped.length ? { skipped: result.skipped } : {} };
    },
  };
}

function describe(change) {
  const label = { add: '加上', done: '划掉', edit: '改成', remove: '去掉' }[change?.op] ?? change?.op;
  return change?.op === 'add' || change?.op === 'edit' ? `${label}：${change.text ?? ''}${change.op === 'edit' ? `（原：${change.match ?? ''}）` : ''}` : `${label}：${change?.match ?? ''}`;
}

export function apply(ctx, config) {
  const settings = loadSettings(config);
  const tool = todayTool({ workspace: exec => exec.agent === undefined ? undefined : ctx.workingDirectory.ensure(exec.agent, exec.signal) });
  for (const definition of withLog([tool], actionLogger({ path: settings.actionLog }))) ctx.tools.register(definition);
}
