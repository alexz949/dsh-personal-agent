import { execFile } from 'node:child_process';

// Preset tool: post a macOS banner so reminders and finished work reach the user outside the DSH window.
export const name = 'personal-agent-notify';
export const inject = ['tools'];

const OSASCRIPT = '/usr/bin/osascript';
// The text reaches AppleScript as argv, so quotes in it cannot change the script.
const SCRIPT = ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv) sound name "default"', 'end run'];
const LIMITS = { title: 60, message: 240 };

export const notifyArgs = (title, message) => [...SCRIPT.flatMap(line => ['-e', line]), title, message];

const clip = (value, max) => value.length > max ? `${value.slice(0, max - 1)}…` : value;

function osascript(args, signal) {
  return new Promise((resolve, reject) => {
    execFile(OSASCRIPT, args, { timeout: 10e3, signal }, error => error ? reject(error) : resolve());
  });
}

export function notifyTool(run = osascript, platform = process.platform) {
  return {
    name: 'notify',
    description: 'Show a macOS notification banner with a sound on this Mac. Use it when a scheduled reminder arrives or when the user asks to be notified. It reaches the user only while this Mac is on and DSH is running; success means macOS accepted the banner, not that the user saw it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message: { type: 'string', description: 'Notification body in the user\'s language: one short sentence.' },
        title: { type: 'string', description: 'Optional short title. Defaults to Personal Agent.' },
      },
      required: ['message'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { title: { type: 'string' }, message: { type: 'string' } },
        required: ['title', 'message'],
      },
      render: (_args, value) => [{ type: 'text', text: `macOS notification sent: ${value.title} — ${value.message}` }],
    },
    async execute(args, exec) {
      if (platform !== 'darwin') throw new Error('notify is only available on macOS');
      const message = typeof args.message === 'string' ? args.message.trim() : '';
      if (message === '') throw new Error('message must be a non-empty string');
      const title = typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : 'Personal Agent';
      const sent = { title: clip(title, LIMITS.title), message: clip(message, LIMITS.message) };
      await run(notifyArgs(sent.title, sent.message), exec.signal);
      return sent;
    },
    presentCall: args => ({ card: 'generic', title: 'Mac 通知', kind: 'other', content: [{ type: 'text', text: String(args.message ?? '') }] }),
  };
}

export function apply(ctx) {
  ctx.tools.register(notifyTool());
}
