import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { profileHolder, loginUrl, chromeArgs, browserLoginTool, keepSessionCookies, watchLoginWindow } from '../src/browser.js';

test('the profile holder comes from a live SingletonLock', async () => {
  const link = target => async () => target;
  assert.equal(await profileHolder('/p', { link: link('mac.local-4242'), alive: pid => pid === 4242 }), 4242);
  assert.equal(await profileHolder('/p', { link: link('mac.local-4242'), alive: () => false }), undefined);
  assert.equal(await profileHolder('/p', { link: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } }), undefined);
});

test('only full http(s) addresses are opened', () => {
  assert.equal(loginUrl('https://canvas.example.edu/login'), 'https://canvas.example.edu/login');
  assert.equal(loginUrl(undefined), undefined);
  for (const bad of ['canvas.example.edu', 'file:///etc/passwd', 'javascript:alert(1)']) assert.throws(() => loginUrl(bad), /full http\(s\) address/);
  assert.deepEqual(chromeArgs('/p', 'https://a.example/'), ['-na', 'Google Chrome', '--args', '--user-data-dir=/p', '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check', 'https://a.example/']);
});

test('browser_login opens Chrome on the shared profile, or says to close the headless browser first', async () => {
  const launched = [], watched = [];
  const free = browserLoginTool({ profile: '/p', holder: async () => undefined, launch: async args => { launched.push(args); }, watch: async (profile, since) => { watched.push([profile, since]); return { kept: 2 }; } });
  const value = await free.execute({ url: 'https://mail.example.com/' });
  assert.equal(value.opened, true);
  assert.equal(launched[0].at(-1), 'https://mail.example.com/');
  assert.equal(watched[0][0], '/p');
  assert.ok(Date.now() - watched[0][1].getTime() >= 60000, 'cookies from just before the window opened count too');
  const busy = browserLoginTool({ profile: '/p', holder: async () => 77, launch: async () => assert.fail('must not launch'), watch: () => assert.fail('must not watch') });
  assert.match((await busy.execute({})).reason, /browser_close first/);
});

test('browser_save_output copies a browser screenshot into files/ and returns an image link', async () => {
  const { saveOutputTool } = await import('../src/browser.js');
  const copies = [];
  const tool = saveOutputTool({ output: '/out', workspace: async exec => exec.agent ? '/w' : undefined, copy: async (from, to) => { copies.push([from, to]); }, mkdirp: async () => {}, info: async file => ({ isFile: () => file === '/out/page.png' }) });
  assert.deepEqual(await tool.execute({ file: 'page.png', name: 'screenshot-2026-11-16.png' }, { agent: 'a' }), { saved: true, path: 'files/screenshot-2026-11-16.png', markdown: '![screenshot-2026-11-16.png](files/screenshot-2026-11-16.png)' });
  assert.deepEqual(copies, [['/out/page.png', '/w/files/screenshot-2026-11-16.png']]);
  await assert.rejects(tool.execute({ file: '../profile/Cookies.png' }, { agent: 'a' }), /file name from the browser output folder/);
  await assert.rejects(tool.execute({ file: 'notes.txt' }, { agent: 'a' }), /PNG, JPEG/);
  await assert.rejects(tool.execute({ file: 'missing.png' }, { agent: 'a' }), /no file named missing.png/);
  await assert.rejects(tool.execute({ file: 'page.png' }, {}), /no workspace folder/);
});

test('keepSessionCookies makes recent session cookies last 30 days and leaves the rest alone', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'pa-cookies-'));
  try {
    await mkdir(join(profile, 'Default'));
    const db = join(profile, 'Default', 'Cookies');
    const chrome = date => (Math.floor(date.getTime() / 1000) + 11644473600) * 1e6;
    const now = new Date(), old = new Date(now.getTime() - 86400000);
    execFileSync('/usr/bin/sqlite3', [db, `create table cookies (host_key text, name text, is_persistent integer, has_expires integer, expires_utc integer, last_access_utc integer);
      insert into cookies values ('canvas.example.edu', 'canvas_session', 0, 0, 0, ${chrome(now)}), ('old.example.com', 'stale', 0, 0, 0, ${chrome(old)}), ('news.example.com', 'kept', 1, 1, 42, ${chrome(now)});`]);
    assert.equal(await keepSessionCookies(profile, new Date(now.getTime() - 60000)), 1);
    const rows = execFileSync('/usr/bin/sqlite3', [db, 'select name, is_persistent, has_expires, expires_utc from cookies order by name']).toString().trim().split('\n').map(row => row.split('|'));
    const byName = Object.fromEntries(rows.map(([name, ...rest]) => [name, rest.map(Number)]));
    assert.deepEqual(byName.canvas_session.slice(0, 2), [1, 1]);
    const days = (byName.canvas_session[2] / 1e6 - 11644473600 - now.getTime() / 1000) / 86400;
    assert.ok(days > 29.9 && days < 30.1, `expires in ${days} days`);
    assert.deepEqual(byName.stale, [0, 0, 0]);
    assert.deepEqual(byName.kept, [1, 1, 42]);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test('the sign-in watcher keeps logins only after that window quits and before another Chrome takes the profile', async () => {
  const run = async (holds, { dead = () => true, ...rest } = {}) => {
    const kept = [], logged = [];
    let call = 0;
    const result = await watchLoginWindow('/p', new Date(0), { holder: async () => holds[Math.min(call++, holds.length - 1)], alive: pid => !dead(pid, call), keep: async () => { kept.push(true); return 3; }, log: async (_tool, text) => { logged.push(text); }, every: 1, ...rest });
    return { result, kept, logged };
  };
  const quit = await run([undefined, 500, 500, undefined], { dead: (_pid, call) => call >= 4 });
  assert.deepEqual(quit.result, { kept: 3 });
  assert.deepEqual(quit.logged, ['保留登录：3 个会话 cookie 改为 30 天内有效']);

  const raced = await run([500, 600], { dead: pid => pid === 500 });
  assert.match(raced.result.reason, /pid 600/);
  assert.deepEqual(raced.kept, []);

  const never = await run([undefined], { appear: 5 });
  assert.match(never.result.reason, /never opened/);
  assert.deepEqual(never.kept, []);
});
