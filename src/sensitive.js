// sensitive_confirm: the confirmation card the assistant must get before it handles a secret: typing
// a password, verification code, card or ID number into a page; showing a credential in the chat;
// saving one; or reading a site's cookies, login data or local storage. The card names what, where
// and why, never the value itself. One yes covers one action. Approvals go to the action log.
import { confirm } from './apple.js';
import { loadSettings } from './config.js';
import { actionLogger, withLog } from './log.js';

export const name = 'personal-agent-sensitive';
export const inject = ['tools'];

const ACTIONS = {
  type_secret: { verb: '填入', question: ({ what, where }) => `在「${where}」填入${what}？`, yes: '允许这一次填入' },
  show_secret: { verb: '显示', question: ({ what }) => `在对话里显示${what}？`, yes: '允许这一次显示' },
  save_secret: { verb: '记下', question: ({ what, where }) => `把${what}记到「${where}」？`, yes: '允许这一次记下' },
  read_site_data: { verb: '读取', question: ({ where }) => `读取「${where}」的 cookie、登录信息或本地存储？`, yes: '允许这一次读取' },
};

const text = value => typeof value === 'string' && value.trim() !== '' ? value.trim().replace(/\s+/g, ' ') : undefined;

export function sensitiveTool({ questions = () => undefined } = {}) {
  return {
    name: 'sensitive_confirm',
    description: 'Ask the user on a confirmation card before handling a secret, and act only if this returns approved: true. Call it every time, right before: typing a password, verification code, bank card number or ID number into a page (type_secret); showing a password, key or token in the chat (show_secret); saving a credential to memory, notes or a file (save_secret); reading a site\'s cookies, login data or local storage (read_site_data). One approval covers that one action only. Never put the secret value itself in what, where or why.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: Object.keys(ACTIONS) },
        what: { type: 'string', description: 'Which secret, in a few words, without its value, e.g. "Canvas 密码", "邮件里的 6 位验证码", "身份证号".' },
        where: { type: 'string', description: 'The site and field, or where it will be shown or saved, e.g. "Duke 登录页的密码栏", "Mnemon 记忆".' },
        why: { type: 'string', description: 'Why it is needed, in one short sentence.' },
      },
      required: ['action', 'what', 'where'],
    },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    presentCall: args => ({ card: 'generic', title: '敏感操作确认', kind: 'edit', content: [{ type: 'text', text: [args.what, args.where].filter(Boolean).join(' · ') }] }),
    async execute(args, exec) {
      const kind = ACTIONS[args.action];
      if (!kind) throw new Error(`action must be one of ${Object.keys(ACTIONS).join(', ')}`);
      const what = text(args.what), where = text(args.where), why = text(args.why);
      if (!what || !where) throw new Error('what and where must say which secret and where it goes, without its value');
      const decision = await confirm(questions(), exec, '敏感操作', kind.question({ what, where }), [
        `内容：${what}`,
        `位置：${where}`,
        why && `用途：${why}`,
        args.action === 'type_secret' && '具体的值不会显示在这张卡片上。',
        '这次允许只管这一次操作。',
      ], { label: '允许', description: kind.yes }, '不允许');
      return decision.approved
        ? { approved: true, action: args.action, what, where }
        : { approved: false, action: args.action, what, where, ...decision.feedback ? { user_feedback: decision.feedback } : { reason: 'the user did not allow it; do not do it, and do not try another way' } };
    },
  };
}

export function apply(ctx, config) {
  const settings = loadSettings(config);
  const tool = sensitiveTool({ questions: () => ctx.get('userQuestions') });
  for (const definition of withLog([tool], actionLogger({ path: settings.actionLog }))) ctx.tools.register(definition);
}
