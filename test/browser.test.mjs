import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { profileHolder, loginUrl, chromeArgs, browserLoginTool, keepSessionCookies, keepSiteCookies, watchLoginWindow, startLoginKeeper, siteOf, loadSites, rememberSites } from '../src/browser.js';

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
    assert.deepEqual(await keepSessionCookies(profile, new Date(now.getTime() - 60000)), { kept: 1, hosts: ['canvas.example.edu'] });
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
    const result = await watchLoginWindow('/p', new Date(0), { holder: async () => holds[Math.min(call++, holds.length - 1)], alive: pid => !dead(pid, call), keep: async () => { kept.push(true); return { kept: 3, hosts: ['canvas.example.edu', '.shib.example.edu'] }; }, remember: async (_profile, hosts) => hosts.map(siteOf), log: async (_tool, text) => { logged.push(text); }, every: 1, unref: false, ...rest });
    return { result, kept, logged };
  };
  const quit = await run([undefined, 500, 500, undefined], { dead: (_pid, call) => call >= 4 });
  assert.deepEqual(quit.result, { kept: 3, sites: ['example.edu', 'example.edu'] });
  assert.deepEqual(quit.logged, ['保留登录：3 个会话 cookie 改为 30 天内有效（example.edu）']);

  const raced = await run([500, 600], { dead: pid => pid === 500 });
  assert.match(raced.result.reason, /pid 600/);
  assert.deepEqual(raced.kept, []);

  const never = await run([undefined], { appear: 5 });
  assert.match(never.result.reason, /never opened/);
  assert.deepEqual(never.kept, []);
});

test('cookie hosts map to their site, and remembered sites are merged into a file in the profile', async () => {
  assert.equal(siteOf('.shib.oit.duke.edu'), 'duke.edu');
  assert.equal(siteOf('canvas.duke.edu'), 'duke.edu');
  assert.equal(siteOf('sso.canvaslms.com'), 'canvaslms.com');
  assert.equal(siteOf('jw.example.edu.cn'), 'example.edu.cn');
  assert.equal(siteOf('localhost'), undefined);
  assert.equal(siteOf("x'; drop table cookies; --.com"), undefined);
  const profile = await mkdtemp(join(tmpdir(), 'pa-sites-'));
  try {
    assert.deepEqual(await loadSites(profile), []);
    assert.deepEqual(await rememberSites(profile, ['go.canvas.duke.edu', '.shib.oit.duke.edu']), ['duke.edu']);
    assert.deepEqual(await rememberSites(profile, ['sso.canvaslms.com']), ['canvaslms.com', 'duke.edu']);
    assert.deepEqual(await loadSites(profile), ['canvaslms.com', 'duke.edu']);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test('keepSiteCookies keeps the session cookies of remembered sites only', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'pa-site-cookies-'));
  try {
    await mkdir(join(profile, 'Default'));
    const db = join(profile, 'Default', 'Cookies');
    execFileSync('/usr/bin/sqlite3', [db, `create table cookies (host_key text, name text, is_persistent integer, has_expires integer, expires_utc integer, last_access_utc integer);
      insert into cookies values ('canvas.duke.edu', 'canvas_session', 0, 0, 0, 1), ('.duke.edu', 'sso', 0, 0, 0, 1), ('notduke.edu', 'other', 0, 0, 0, 1), ('ads.example.com', 'ad', 0, 0, 0, 1);`]);
    assert.equal(await keepSiteCookies(profile, ['duke.edu']), 2);
    const rows = execFileSync('/usr/bin/sqlite3', [db, 'select name, is_persistent from cookies order by name']).toString().trim();
    assert.equal(rows, 'ad|0\ncanvas_session|1\nother|0\nsso|1');
    assert.equal(await keepSiteCookies(profile, []), 0);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test('the login keeper runs when the profile is free at start and again after each browser exit, not while one holds it', async () => {
  const holds = [undefined, undefined, 700, 700, undefined, undefined, 800];
  let call = 0;
  const kept = [];
  const stop = startLoginKeeper('/p', { holder: async () => holds[Math.min(call++, holds.length - 1)], sites: async () => ['duke.edu'], keep: async (_profile, sites) => { kept.push(call); return sites.length; }, every: 1, unref: false });
  await new Promise(resolve => setTimeout(resolve, 50));
  stop();
  assert.deepEqual(kept, [1, 5]);
});
