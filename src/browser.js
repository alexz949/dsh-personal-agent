// browser_login: the assistant's browser (Playwright MCP) runs headless, so sites that need the user
// to sign in (school portals with two-step login, Gmail) are opened once in a visible Chrome window
// on the same profile. The user signs in there and quits that window; the headless browser then
// reuses the saved login. Chrome allows one process per profile, so this refuses while the
// headless browser (or an earlier login window) still holds it.
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readlink, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { loadSettings } from './config.js';

export const name = 'personal-agent-browser';
export const inject = ['tools', 'workingDirectory'];

const isAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; } };

/** The pid of the Chrome that holds the profile, from its SingletonLock link ("<host>-<pid>"). */
export async function profileHolder(profile, { link = readlink, alive = isAlive } = {}) {
  let target;
  try { target = await link(join(profile, 'SingletonLock')); } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EINVAL') return undefined;
    throw error;
  }
  const pid = Number(/-(\d+)$/.exec(String(target))?.[1]);
  return Number.isSafeInteger(pid) && pid > 0 && alive(pid) ? pid : undefined;
}

export function loginUrl(value) {
  if (value === undefined || String(value).trim() === '') return undefined;
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('url must be a full http(s) address'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('url must be a full http(s) address');
  return url.href;
}

/** Chrome flags matching how Playwright starts it, so both read the same saved logins: Playwright
 * encrypts cookies with a mock keychain on macOS. */
export const chromeArgs = (profile, url) => ['-na', 'Google Chrome', '--args', `--user-data-dir=${profile}`, '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check', ...url ? [url] : []];

function openChrome(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('open', args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`could not open Google Chrome (open exited with ${code}); is Chrome installed in /Applications?`)));
  });
}

export function browserLoginTool({ profile, holder = profileHolder, launch = openChrome }) {
  return {
    name: 'browser_login',
    description: 'Open the assistant browser\'s profile in a visible Google Chrome window so the user can sign in to a site (a school portal with two-step login, Gmail) that the headless mcp__browser__* tools hit a login page on. Call mcp__browser__browser_close first: the profile can be open in only one browser at a time. Then ask the user to sign in in that window and quit it with ⌘Q (the whole Chrome window, not just the tab) and to tell you when done; after that the mcp__browser__* tools reuse the saved login. Never type passwords or codes yourself.',
    parameters: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', description: 'The sign-in page or the page to reach, as a full https:// address.' } } },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    presentCall: args => ({ card: 'generic', title: '打开助手浏览器登录', kind: 'edit', content: [{ type: 'text', text: String(args.url ?? '') }] }),
    async execute(args) {
      const url = loginUrl(args.url);
      const pid = await holder(profile);
      if (pid !== undefined) return { opened: false, reason: `the assistant browser profile is in use (Chrome pid ${pid}): call mcp__browser__browser_close first, or ask the user to quit an earlier sign-in window with ⌘Q, then try again` };
      await launch(chromeArgs(profile, url));
      return { opened: true, url: url ?? null, next: 'ask the user to sign in in the new Chrome window, then quit it with ⌘Q and tell you; continue with the mcp__browser__* tools after that' };
    },
  };
}

const SAVABLE = /\.(png|jpe?g|webp|gif|pdf)$/i;

/** Copy a file the assistant browser saved (a screenshot, a PDF) into the workspace's files/
 * folder, so the conversation can show it: DSH renders Markdown images inline. */
export function saveOutputTool({ output, workspace, copy = copyFile, mkdirp = mkdir, info = stat }) {
  return {
    name: 'browser_save_output',
    description: 'Copy a file that the assistant browser saved, such as a screenshot from mcp__browser__browser_take_screenshot (give it a filename like "page.png"), into this workspace\'s files/ folder, and get back a Markdown image link to put in your reply: DSH shows images inline in the conversation. Only PNG, JPEG, WebP, GIF and PDF files from the browser\'s output folder.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        file: { type: 'string', description: 'The file name the browser saved, e.g. "page.png".' },
        name: { type: 'string', description: 'Optional new file name in files/.' },
      },
      required: ['file'],
    },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    presentCall: args => ({ card: 'generic', title: '保存浏览器截图', kind: 'edit', content: [{ type: 'text', text: String(args.name ?? args.file ?? '') }] }),
    async execute(args, exec) {
      const raw = String(args.file ?? '').trim(), wanted = String(args.name ?? raw).trim();
      // Plain file names only: nothing outside the browser output folder, nothing outside files/.
      if (!raw || /[\\/]/.test(raw) || raw.startsWith('.') || !SAVABLE.test(raw)) throw new Error('file must be a PNG, JPEG, WebP, GIF or PDF file name from the browser output folder');
      if (/[\\/]/.test(wanted) || wanted.startsWith('.') || !SAVABLE.test(wanted)) throw new Error('name must be a plain file name ending in .png, .jpg, .jpeg, .webp, .gif or .pdf');
      const file = basename(raw), name = basename(wanted);
      const dir = await workspace(exec);
      if (!dir) throw new Error('this conversation has no workspace folder to save into');
      const from = join(output, file);
      try { if (!(await info(from)).isFile()) throw new Error(); } catch { throw new Error(`no file named ${file} in the browser output folder; take the screenshot with that filename first`); }
      await mkdirp(join(dir, 'files'), { recursive: true });
      await copy(from, join(dir, 'files', name));
      const path = `files/${name}`;
      return { saved: true, path, markdown: /\.pdf$/i.test(name) ? `[${name}](${path})` : `![${name}](${path})` };
    },
  };
}

export function apply(ctx, config) {
  const settings = loadSettings(config);
  ctx.tools.register(browserLoginTool({ profile: settings.browserProfile }));
  ctx.tools.register(saveOutputTool({ output: settings.browserOutput, workspace: exec => exec.agent === undefined ? undefined : ctx.workingDirectory.ensure(exec.agent, exec.signal) }));
}
