import test from 'node:test';
import assert from 'node:assert/strict';
import { profileHolder, loginUrl, chromeArgs, browserLoginTool } from '../src/browser.js';

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
  const launched = [];
  const free = browserLoginTool({ profile: '/p', holder: async () => undefined, launch: async args => { launched.push(args); } });
  const value = await free.execute({ url: 'https://mail.example.com/' });
  assert.equal(value.opened, true);
  assert.equal(launched[0].at(-1), 'https://mail.example.com/');
  const busy = browserLoginTool({ profile: '/p', holder: async () => 77, launch: async () => assert.fail('must not launch') });
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
