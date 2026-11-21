// browser_login: the assistant's browser (Playwright MCP) runs headless, so sites that need the user
// to sign in (school portals with two-step login, Gmail) are opened once in a visible Chrome window
// on the same profile. The user signs in there and quits that window; the headless browser then
// reuses the saved login. Chrome allows one process per profile, so this refuses while the
// headless browser (or an earlier login window) still holds it.
import { execFile, spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, readdir, readFile, readlink, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { loadSettings } from './config.js';
import { actionLogger } from './log.js';

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

// The assistant browser is Playwright's own Chrome for Testing, not the user's Google Chrome: a
// separate app with its own Dock icon, so links from other apps never land in it and quitting one
// never quits the other. Its path changes with each Playwright build, so a fixed link
// (settings.browserApp) points at the newest one, for the MCP's --executable-path and for
// browser_login alike. The headless shell is not used: it takes no profile lock, so the plugin could
// not tell when it holds the profile.
const PLAYWRIGHT_CACHE = join(homedir(), 'Library', 'Caches', 'ms-playwright');
const APP_NAMES = ['Google Chrome for Testing.app', 'Chromium.app'];
export const INSTALL_HINT = 'cd ~/.dsh/mcp/playwright && node node_modules/playwright-core/cli.js install chromium';

/** The newest Chrome for Testing (or Chromium) app Playwright has installed, or undefined. */
export async function findChromium({ cache = PLAYWRIGHT_CACHE, list = readdir, exists = async path => { try { await stat(path); return true; } catch { return false; } } } = {}) {
  let builds;
  try { builds = await list(cache); } catch { return undefined; }
  const revisions = builds.map(name => /^chromium-(\d+)$/.exec(name)).filter(Boolean).sort((a, b) => Number(b[1]) - Number(a[1]));
  for (const [build] of revisions) {
    for (const platform of ['chrome-mac-arm64', 'chrome-mac-x64', 'chrome-mac']) {
      for (const app of APP_NAMES) {
        const path = join(cache, build, platform, app);
        if (await exists(path)) return path;
      }
    }
  }
  return undefined;
}

/** Point the fixed app link at the newest Chrome for Testing. Leaves anything that is not a link
 * alone. Returns the app it points to, or undefined when none is installed. */
export async function linkChromium(link, { find = findChromium, read = readlink, remove = unlink, make = symlink, info = lstat } = {}) {
  const target = await find();
  if (!target) return undefined;
  let current;
  try {
    if (!(await info(link)).isSymbolicLink()) return link;
    current = await read(link);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (current === target) return target;
  if (current !== undefined) await remove(link);
  await make(target, link);
  return target;
}

/** Flags matching how Playwright starts the browser, so both read the same saved logins:
 * Playwright encrypts cookies with a mock keychain on macOS. */
export const chromeArgs = (profile, url, app = 'Google Chrome') => ['-na', app, '--args', `--user-data-dir=${profile}`, '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check', ...url ? [url] : []];

const KEEP_DAYS = 30;
const SITES_FILE = 'personal-agent-kept-sites.json';

// Chrome stores times as microseconds since 1601-01-01.
const chromeTime = seconds => `(${seconds} + 11644473600) * 1000000`;
const promote = days => `update cookies set is_persistent = 1, has_expires = 1, expires_utc = ${chromeTime(`strftime('%s', 'now') + ${days * 86400}`)}`;

// Suffixes under which a site takes three labels (canvas.example.edu.cn → example.edu.cn).
const TWO_LABEL_SUFFIXES = new Set(['com.cn', 'edu.cn', 'org.cn', 'net.cn', 'gov.cn', 'ac.cn', 'co.uk', 'ac.uk', 'org.uk', 'co.jp', 'ac.jp', 'com.au', 'edu.au', 'com.hk', 'edu.hk', 'com.tw', 'edu.tw', 'com.sg', 'edu.sg']);

/** The site a cookie host belongs to: ".shib.oit.duke.edu" → "duke.edu". */
export function siteOf(host) {
  const labels = String(host).toLowerCase().replace(/^\./, '').split('.').filter(Boolean);
  if (labels.length < 2 || !labels.every(label => /^[a-z0-9-]+$/.test(label))) return undefined;
  const take = labels.length >= 3 && TWO_LABEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** Turn the session cookies touched since `since` (a Date) into cookies that last KEEP_DAYS days,
 * so a login survives the next browser start: Chrome drops session cookies when it starts, and
 * Playwright's Chrome never restores a session. Values stay encrypted as they were. Run only while
 * no Chrome holds the profile. Returns how many cookies changed and their hosts. */
export async function keepSessionCookies(profile, since, { sqlite = runSqlite, days = KEEP_DAYS } = {}) {
  const recent = `is_persistent = 0 and last_access_utc >= ${chromeTime(Math.floor(since.getTime() / 1000))}`;
  const out = await sqlite(join(profile, 'Default', 'Cookies'), `select distinct host_key from cookies where ${recent}; ${promote(days)} where ${recent}; select changes();`);
  const lines = String(out).trim().split('\n').filter(Boolean);
  return { kept: Number(lines.at(-1)) || 0, hosts: lines.slice(0, -1) };
}

/** Keep the session cookies of sites the user signed in to in a login window. Sites such as Canvas
 * hand out a fresh session cookie on every page, which replaces the one kept at sign-in, so this
 * runs again after every browser exit. Returns how many cookies changed. */
export async function keepSiteCookies(profile, sites, { sqlite = runSqlite, days = KEEP_DAYS } = {}) {
  const safe = sites.filter(site => /^[a-z0-9.-]+$/.test(site));
  if (safe.length === 0) return 0;
  const match = safe.map(site => `host_key = '${site}' or host_key like '%.${site}'`).join(' or ');
  const out = await sqlite(join(profile, 'Default', 'Cookies'), `${promote(days)} where is_persistent = 0 and (${match}); select changes();`);
  return Number(String(out).trim().split('\n').at(-1)) || 0;
}

export async function loadSites(profile, { read = readFile } = {}) {
  try {
    const sites = JSON.parse(await read(join(profile, SITES_FILE), 'utf8'));
    return Array.isArray(sites) ? sites.filter(site => typeof site === 'string') : [];
  } catch {
    return [];
  }
}

export async function rememberSites(profile, hosts, { read = readFile, write = writeFile } = {}) {
  const sites = [...new Set([...await loadSites(profile, { read }), ...hosts.map(siteOf).filter(Boolean)])].sort();
  await write(join(profile, SITES_FILE), `${JSON.stringify(sites, null, 2)}\n`, 'utf8');
  return sites;
}

function runSqlite(file, sql) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/sqlite3', ['-cmd', '.timeout 5000', file, sql], { timeout: 15000 }, (error, stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim())) : resolve(stdout));
  });
}

/** After a sign-in window opens, wait for that Chrome to quit, then keep the logins made in it and
 * remember their sites. Gives up if the window never takes the profile, if another Chrome takes it
 * first, or after `limit` ms. Polls with an unref'd timer so it never keeps DSH running. */
export function watchLoginWindow(profile, since, { holder = profileHolder, keep = keepSessionCookies, remember = rememberSites, log = async () => {}, every = 1000, appear = 30000, limit = 3 * 3600 * 1000, alive = isAlive, unref = true } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    let window;
    const done = value => { clearInterval(timer); resolve(value); };
    const tick = async () => {
      if (tick.busy) return;
      tick.busy = true;
      try {
        const pid = await holder(profile);
        if (window === undefined) {
          if (pid !== undefined) window = pid;
          else if (Date.now() - started > appear) return done({ kept: 0, reason: 'the sign-in window never opened the profile' });
          return;
        }
        if (alive(window)) return Date.now() - started > limit ? done({ kept: 0, reason: 'the sign-in window stayed open too long' }) : undefined;
        if (pid !== undefined) return done({ kept: 0, reason: `another Chrome (pid ${pid}) took the profile first` });
        const { kept, hosts } = await keep(profile, since);
        const sites = hosts.length > 0 ? await remember(profile, hosts) : [];
        if (kept > 0) await log('browser_login', `保留登录：${kept} 个会话 cookie 改为 ${KEEP_DAYS} 天内有效（${hosts.map(siteOf).filter((site, i, all) => site && all.indexOf(site) === i).join('、')}）`).catch(() => {});
        done({ kept, sites });
      } catch (error) {
        done({ kept: 0, reason: error?.message ?? String(error) });
      } finally {
        tick.busy = false;
      }
    };
    const timer = setInterval(tick, every);
    if (unref) timer.unref?.();
  });
}

/** Keep remembered sites signed in for as long as DSH runs: whenever no Chrome holds the profile
 * (at start, and each time the headless browser closes), keep their session cookies again before
 * the next Chrome start would drop them. Returns a function that stops it. */
export function startLoginKeeper(profile, { holder = profileHolder, sites = loadSites, keep = keepSiteCookies, every = 1000, unref = true, report = message => process.stderr.write(`${message}\n`) } = {}) {
  let held = true, busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const pid = await holder(profile);
      if (pid !== undefined) { held = true; return; }
      if (!held) return;
      held = false;
      const known = await sites(profile);
      if (known.length > 0) await keep(profile, known);
    } catch (error) {
      report(`personal-agent: could not keep browser logins: ${error?.message ?? error}`);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, every);
  if (unref) timer.unref?.();
  tick();
  return () => clearInterval(timer);
}

function openChrome(args) {
  // `open -na <app>` starts a new instance of that app with these flags.
  return new Promise((resolve, reject) => {
    const child = spawn('open', args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`could not open the assistant browser (open exited with ${code}); install it with: ${INSTALL_HINT}`)));
  });
}

export function browserLoginTool({ profile, app, holder = profileHolder, launch = openChrome, watch = watchLoginWindow, log, exists = async path => { try { await stat(path); return true; } catch { return false; } } }) {
  return {
    name: 'browser_login',
    description: 'Open the assistant browser\'s profile in a visible window of its own browser (Chrome for Testing, separate from the user\'s Google Chrome) so the user can sign in to a site (a school portal with two-step login, Gmail) that the headless mcp__browser__* tools hit a login page on. Call mcp__browser__browser_close first: the profile can be open in only one browser at a time. Then ask the user to sign in in that window and quit it with ⌘Q (the whole Chrome window, not just the tab) and to tell you when done; after that the mcp__browser__* tools reuse the saved login. Never type passwords or codes yourself.',
    parameters: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', description: 'The sign-in page or the page to reach, as a full https:// address.' } } },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    presentCall: args => ({ card: 'generic', title: '打开助手浏览器登录', kind: 'edit', content: [{ type: 'text', text: String(args.url ?? '') }] }),
    async execute(args) {
      const url = loginUrl(args.url);
      const pid = await holder(profile);
      if (pid !== undefined) return { opened: false, reason: `the assistant browser profile is in use (Chrome pid ${pid}): call mcp__browser__browser_close first, or ask the user to quit an earlier sign-in window with ⌘Q, then try again` };
      if (app && !(await exists(app))) return { opened: false, reason: `the assistant browser (Chrome for Testing) is not installed; ask the user to run: ${INSTALL_HINT}, then restart DSH` };
      const since = new Date(Date.now() - 60000);
      await launch(chromeArgs(profile, url, app));
      // Sites like school portals sign in with session cookies, which Chrome would drop on the next
      // start; once the user quits this window, keep the ones used here.
      watch(profile, since, { holder, log }).then(result => { if (result.reason) process.stderr.write(`browser_login: logins not kept: ${result.reason}\n`); });
      return { opened: true, url: url ?? null, next: 'ask the user to sign in in the new Chrome for Testing window (its own Dock icon, not their usual Chrome), then quit it with ⌘Q and tell you; continue with the mcp__browser__* tools after that. When the window quits, its logins are kept for 30 days, also for sites that would normally sign you out when the browser closes.' };
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

const keepers = new Map();

export function apply(ctx, config) {
  const settings = loadSettings(config);
  // With browserMode "mine" the browser tools drive the user's own Chrome through the Playwright
  // Extension, so there is no assistant profile to sign in to or keep logins for. The preset prompt
  // tells the two modes apart by whether browser_login exists.
  if (settings.browserMode !== 'mine') {
    linkChromium(settings.browserApp).catch(error => process.stderr.write(`personal-agent: could not link the assistant browser: ${error?.message ?? error}\n`));
    ctx.tools.register(browserLoginTool({ profile: settings.browserProfile, app: settings.browserApp, log: actionLogger({ path: settings.actionLog }) }));
    // One keeper per profile, however many times the plugin is applied.
    if (!keepers.has(settings.browserProfile)) keepers.set(settings.browserProfile, startLoginKeeper(settings.browserProfile));
  }
  ctx.tools.register(saveOutputTool({ output: settings.browserOutput, workspace: exec => exec.agent === undefined ? undefined : ctx.workingDirectory.ensure(exec.agent, exec.signal) }));
}
