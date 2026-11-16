import { readFile, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('./', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const [selection, format, home, client, css] = await Promise.all([read('src/selection.js'), read('src/format.js'), read('src/home.js'), read('src/client.js'), read('src/style.css')]);
const helpers = [selection, format, home].map(source => source.replace(/^export /gm, '')).join('\n');
await mkdir(new URL('lib/', root), { recursive: true });
await writeFile(new URL('lib/client.js', root), `window.__ModuleLoader__.load({id:"dsh-personal-agent",factory:(require)=>{\nconst exports = {};\n${helpers}\nconst CSS = ${JSON.stringify(css)};\n${client}\nreturn exports;\n}});\n`);
await writeFile(new URL('lib/index.js', root), '// The host row enrolls the client UI. The preset is composed by cordis.patch.yml.\nexport function apply() {}\n');
// The preset loads these tools by package subpath; they run in the DSH host as is.
await Promise.all(['notify', 'apple', 'arxiv', 'bib', 'log', 'config', 'home', 'today', 'journal', 'browser', 'tasks', 'when'].map(name => copyFile(new URL(`src/${name}.js`, root), new URL(`lib/${name}.js`, root))));

// macOS grants Calendar, Reminders and Notes access to the helper's exact code signature, so it is
// rebuilt only when its sources change; an unchanged helper keeps the user's permission grants.
const app = new URL('helper/PersonalAgentHelper.app/', root);
const [swift, plist] = await Promise.all([read('helper/main.swift'), read('helper/Info.plist')]);
// "universal" is part of the stamp so helpers built for one architecture are rebuilt once.
const digest = createHash('sha256').update(swift).update(plist).update('universal').digest('hex');
const stamp = new URL('helper/.build-sha256', root);
const built = await readFile(stamp, 'utf8').catch(() => '');
if (process.platform === 'darwin' && built.trim() !== digest) {
  const path = url => fileURLToPath(url);
  await rm(app, { recursive: true, force: true });
  await mkdir(new URL('Contents/MacOS/', app), { recursive: true });
  await copyFile(new URL('helper/Info.plist', root), new URL('Contents/Info.plist', app));
  // One universal binary for Apple silicon and Intel Macs, so the published package runs on both.
  const binary = path(new URL('Contents/MacOS/PersonalAgentHelper', app));
  const slices = ['arm64', 'x86_64'].map(arch => {
    const out = `${binary}-${arch}`;
    execFileSync('swiftc', ['-O', '-swift-version', '5', '-target', `${arch}-apple-macos14.0`, path(new URL('helper/main.swift', root)), '-o', out], { stdio: 'inherit' });
    return out;
  });
  execFileSync('lipo', ['-create', ...slices, '-output', binary], { stdio: 'inherit' });
  await Promise.all(slices.map(slice => rm(slice, { force: true })));
  execFileSync('codesign', ['--force', '--sign', '-', path(app)], { stdio: 'inherit' });
  await writeFile(stamp, `${digest}\n`);
}
