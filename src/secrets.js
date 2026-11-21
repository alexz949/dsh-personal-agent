// The assistant's password book: passwords (and card or ID numbers) the user asks it to keep, stored
// in the macOS login keychain through the helper, so they are encrypted at rest and never land in
// memory, notes or workspace files. Saving, using and deleting each go through a confirmation card;
// listing shows only sites and usernames. Requests carrying a secret reach the helper through a
// private temporary file, never the process list. Nothing here writes a secret to the action log.
import { confirm, runHelper } from './apple.js';
import { loadSettings } from './config.js';
import { actionLogger, withLog } from './log.js';

export const name = 'personal-agent-secrets';
export const inject = ['tools'];

const text = value => typeof value === 'string' && value.trim() !== '' ? value.trim().replace(/\s+/g, ' ') : undefined;
const json = value => [{ type: 'text', text: JSON.stringify(value) }];
const output = { schema: { type: 'object' }, render: (_args, value) => json(value) };
const card = (title, kind, content) => ({ card: 'generic', title, kind, content: [{ type: 'text', text: content }] });
const KEY = {
  site: { type: 'string', description: 'The site or service, e.g. "Canvas (canvas.duke.edu)", "招商银行卡", "身份证".' },
  username: { type: 'string', description: 'The account or username on that site; for a card or ID number, what it is, e.g. "尾号 1234".' },
};

function key(args) {
  const site = text(args.site), username = text(args.username);
  if (!site || !username) throw new Error('site and username must be non-empty');
  return { site, username };
}

const declined = (decision, extra) => ({ ...extra, ...decision.feedback ? { user_feedback: decision.feedback } : { reason: 'the user did not allow it; do not do it, and do not try another way' } });

export function secretTools({ run = runHelper, questions = () => undefined } = {}) {
  return [
    {
      name: 'secret_list',
      description: 'List the password book: which sites and usernames have a password (or card or ID number) saved in the macOS keychain. Shows no passwords. Check here before asking the user for a login.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output,
      presentCall: () => card('查看密码本', 'read', ''),
      async execute(_args, exec) {
        return run({ op: 'keychain.list' }, exec.signal);
      },
    },
    {
      name: 'secret_save',
      description: 'Save a password, card number or ID number in the password book (the macOS keychain), when the user asks you to remember it. The user confirms first on a card that names the site and username, not the value. Saving the same site and username again replaces the old one. Never save secrets anywhere else: not in memory, notes, the profile file or any workspace file.',
      parameters: { type: 'object', additionalProperties: false, properties: { ...KEY, password: { type: 'string', description: 'The secret itself, exactly as the user gave it.' } }, required: ['site', 'username', 'password'] },
      output,
      presentCall: args => card('存进密码本', 'edit', `${args.site ?? ''} · ${args.username ?? ''}`),
      async execute(args, exec) {
        const { site, username } = key(args);
        if (typeof args.password !== 'string' || args.password === '') throw new Error('password must be a non-empty string');
        const decision = await confirm(questions(), exec, '密码本', `把「${site}」的密码存进钥匙串？`, [
          `网站：${site}`,
          `账号：${username}`,
          '密码本身不显示在这张卡片上，存在 macOS 钥匙串里（加密），不会写进记忆或文件。',
          '同一个网站和账号已经存过的，会换成这次的。',
        ], { label: '存进去', description: '存进钥匙串' }, '不存');
        if (!decision.approved) return declined(decision, { saved: false, site, username });
        return run({ op: 'keychain.save', site, username, password: args.password }, exec.signal, { viaFile: true });
      },
    },
    {
      name: 'secret_get',
      description: 'Take a saved password (or card or ID number) out of the password book to type it into one field. The user confirms first on a card that names the site, the username and where it will be typed. Use the value only for that field: never show it in the chat, write it down or send it anywhere else. One approval covers one use.',
      parameters: { type: 'object', additionalProperties: false, properties: { ...KEY, where: { type: 'string', description: 'The page and field it goes into, e.g. "Duke 登录页的密码栏".' }, why: { type: 'string', description: 'Why it is needed, in one short sentence.' } }, required: ['site', 'username', 'where'] },
      output: { schema: { type: 'object' }, render: (_args, value) => json(value) },
      presentCall: args => card('从密码本取出', 'edit', `${args.site ?? ''} · ${args.username ?? ''} → ${args.where ?? ''}`),
      async execute(args, exec) {
        const { site, username } = key(args);
        const where = text(args.where), why = text(args.why);
        if (!where) throw new Error('where must name the page and field it goes into');
        const decision = await confirm(questions(), exec, '密码本', `取出「${site}」的密码，填到「${where}」？`, [
          `网站：${site}`,
          `账号：${username}`,
          `填到：${where}`,
          why && `用途：${why}`,
          '这次允许只管这一次填写。',
        ], { label: '允许', description: '允许这一次取出并填写' }, '不允许');
        if (!decision.approved) return declined(decision, { taken: false, site, username });
        const found = await run({ op: 'keychain.get', site, username }, exec.signal, { viaFile: true });
        return { taken: true, site, username, where, password: found.password, use: `type it into ${where} only; never repeat it in the chat or save it anywhere` };
      },
    },
    {
      name: 'secret_delete',
      description: 'Delete a saved entry from the password book when the user asks. The user confirms first on a card.',
      parameters: { type: 'object', additionalProperties: false, properties: KEY, required: ['site', 'username'] },
      output,
      presentCall: args => card('从密码本删除', 'edit', `${args.site ?? ''} · ${args.username ?? ''}`),
      async execute(args, exec) {
        const { site, username } = key(args);
        const decision = await confirm(questions(), exec, '密码本', `从钥匙串删除「${site}」的这条密码？`, [`网站：${site}`, `账号：${username}`, '删除后不能恢复。'], { label: '删除', description: '从钥匙串删除' }, '保留');
        if (!decision.approved) return declined(decision, { deleted: false, site, username });
        return run({ op: 'keychain.delete', site, username }, exec.signal);
      },
    },
  ];
}

export function apply(ctx, config) {
  const settings = loadSettings(config);
  const tools = secretTools({ questions: () => ctx.get('userQuestions') });
  for (const definition of withLog(tools, actionLogger({ path: settings.actionLog }))) ctx.tools.register(definition);
}
