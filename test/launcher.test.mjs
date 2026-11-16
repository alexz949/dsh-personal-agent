import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { personalSessions, openPersonalSession, pickMain, workspaceChoices } from '../src/selection.js';

const WORKSPACE_PATH = '/Users/someone/assistant';
import { formatToday, formatUpdatedAt, greeting } from '../src/format.js';
import { actionsPathFor, parseActions, parseBrief } from '../src/home.js';
import { notifyTool, notifyArgs } from '../src/notify.js';

test('recent sessions exclude other presets, workspaces, archived, blank and subagent sessions', () => {
  const row = (id, extra = {}) => ({ id, updatedAt: 1, projectionValues: { agentPreset: 'personal' }, ...extra });
  const rows = [row('old'), row('new', { updatedAt: 5 }), row('standard', { projectionValues: { agentPreset: 'standard' } }), row('unknown', { projectionValues: {} }), row('blank', { blank: true }), row('child', { origin: 'subagent' }), row('archived'), row('other')];
  const ws = { items: [{ workspaceId: 'pa', path: WORKSPACE_PATH, sessionIds: rows.filter(r => r.id !== 'other').map(r => r.id) }], archivedSessionIds: ['archived'] };
  const sessions = { byId: Object.fromEntries(rows.map(row => [row.id, row])) };
  assert.deepEqual(personalSessions(ws, sessions, WORKSPACE_PATH).recent.map(r => r.id), ['new', 'old']);
  assert.equal(personalSessions(ws, sessions, undefined).workspace, undefined);
  assert.equal(personalSessions({ items: [], archivedSessionIds: [] }, sessions, WORKSPACE_PATH).workspace, undefined);
  const slashed = { ...ws, items: [{ ...ws.items[0], path: `${WORKSPACE_PATH}/` }] };
  assert.equal(personalSessions(slashed, sessions, WORKSPACE_PATH).workspace?.workspaceId, 'pa');
  const two = { items: [{ workspaceId: 'x', path: '/x', sessionIds: ['standard'] }, ws.items[0]], archivedSessionIds: [] };
  assert.deepEqual(workspaceChoices(two, sessions).map(c => [c.workspace.workspaceId, c.conversations]), [['pa', 3], ['x', 0]]);
});

test('new conversation uses the existing workspace and Personal preset without sending a prompt', async () => {
  let args;
  const ctx = { uiWorkspace: { openWorkspace: async (...input) => { args = input; } } };
  await openPersonalSession(ctx, { workspaceId: 'pa' });
  assert.deepEqual(args, ['pa', undefined, { agentPreset: 'personal' }]);
  assert.throws(() => openPersonalSession(ctx, undefined), /工作区/);
});

test('recent session times read like the DSH sidebar', () => {
  const now = new Date(2026, 9, 26, 15, 30).getTime();
  const at = (...parts) => new Date(...parts).getTime();
  assert.equal(formatUpdatedAt(now - 20e3, now), '刚刚');
  assert.equal(formatUpdatedAt(now + 5e3, now), '刚刚');
  assert.equal(formatUpdatedAt(now - 47 * 60e3, now), '47 分钟前');
  assert.equal(formatUpdatedAt(at(2026, 9, 26, 9, 5), now), '09:05');
  assert.equal(formatUpdatedAt(at(2026, 9, 25, 23, 59), now), '昨天');
  assert.equal(formatUpdatedAt(at(2026, 9, 21, 8, 0), now), '周三');
  assert.equal(formatUpdatedAt(at(2026, 9, 14, 8, 0), now), '10月14日');
  assert.equal(formatUpdatedAt(at(2025, 11, 31, 8, 0), now), '2025/12/31');
  assert.deepEqual([4, 5, 11, 13, 18].map(greeting), ['晚上好', '早上好', '中午好', '下午好', '晚上好']);
});

test('built client registers the overview panel, its sidebar entry, the 今日 tab, the sticky note and the splash, and releases them on unload', async () => {
  let bundle;
  const document = { querySelector: () => null, createElement: () => ({ remove() {} }), head: { appendChild() {} } };
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), { setTimeout, clearTimeout, document, window: { innerWidth: 1200, __ModuleLoader__: { load: value => { bundle = value; } } } });
  assert.equal(bundle.id, 'dsh-personal-agent');
  const plugin = bundle.factory(id => { assert.equal(id, 'react'); return { createElement() {} }; });
  assert.deepEqual([...plugin.inject], ['slots', 'uiWorkspace', 'workspaces', 'sessions', 'layout', 'remote', 'remote.workspaceFiles', 'sidebarRight', 'sidebarRightTabs']);
  const entries = [], removed = [], cleanups = [], types = [];
  plugin.apply({
    effect(callback) { const dispose = callback(); if (typeof dispose === 'function') cleanups.push(dispose); },
    sidebarRightTabs: { register: definition => { types.push(definition); return () => removed.push('tab type'); } },
    layout: { selectPanel() {} },
    workspaces: { list: { getSnapshot: () => ({ phase: 'ready', items: [], archivedSessionIds: [] }) } },
    sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: {} }) } },
    slots: {
      inject(name, callback) { const dispose = callback(); if (dispose) cleanups.push(dispose); },
      register(options) { entries.push(options); return () => removed.push(options.name); },
    },
  });
  assert.equal(types[0].kind, 'personal-today');
  assert.equal(types[0].title(), '今日');
  assert.deepEqual(entries.map(entry => entry.name), ['sidebar.right.pane.tab', 'shell.overlay', 'shell.overlay', 'main', 'sidebar.panellist']);
  assert.deepEqual(entries.filter(entry => entry.name === 'shell.overlay').map(entry => entry.id), ['personal-agent-sticky', 'personal-agent-splash']);
  assert.equal(entries[0].key, types[0].id);
  assert.equal(entries[3].key, entries[4].id);
  assert.equal(entries[4].label, '助理');
  cleanups.forEach(dispose => dispose());
  assert.deepEqual(removed.sort(), ['main', 'shell.overlay', 'shell.overlay', 'sidebar.panellist', 'sidebar.right.pane.tab', 'tab type'].sort());
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-api-workspace-files'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'));
});
test('notify passes user text to osascript as argv and reports what was sent', async () => {
  const calls = [];
  const tool = notifyTool(async (args, signal) => { calls.push({ args, signal }); }, 'darwin');
  const signal = new AbortController().signal;
  const quoted = '喝水 "now" & end run';
  assert.deepEqual(await tool.execute({ message: `  ${quoted}  ` }, { signal }), { title: 'Personal Agent', message: quoted });
  assert.deepEqual(calls[0].args.slice(-2), ['Personal Agent', quoted]);
  assert.ok(calls[0].args.slice(0, -2).every((arg, i) => i % 2 === 0 ? arg === '-e' : !arg.includes(quoted)));
  assert.equal(calls[0].signal, signal);
  const long = await tool.execute({ title: 't'.repeat(80), message: 'm'.repeat(300) }, { signal });
  assert.equal(long.title.length, 60);
  assert.equal(long.message.length, 240);
  await assert.rejects(tool.execute({ message: '   ' }, { signal }), /non-empty/);
  await assert.rejects(notifyTool(async () => {}, 'linux').execute({ message: 'hi' }, { signal }), /macOS/);
  assert.equal(calls.length, 2);
  assert.deepEqual(notifyArgs('a', 'b').slice(-2), ['a', 'b']);
});

test('built notify module registers one tool through the preset subpath', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.exports['./notify'], './lib/notify.js');
  const plugin = await import('../lib/notify.js');
  assert.deepEqual(plugin.inject, ['tools']);
  const registered = [];
  plugin.apply({ tools: { register: tool => registered.push(tool) } });
  assert.deepEqual(registered.map(tool => tool.name), ['notify']);
  assert.deepEqual(registered[0].parameters.required, ['message']);
});

test('the home reads today\'s brief and the newest actions', () => {
  const now = new Date(2026, 10, 16, 8, 30);
  const brief = parseBrief('# 今日简介 2026-11-16\n\n结论：今天主要是 HW5。\n- HW5 今晚 23:59 截止\n* 下午 3 点组会\n2. 推荐人 A 还没回\n', now);
  assert.deepEqual(brief, { date: '2026-11-16', items: ['HW5 今晚 23:59 截止', '下午 3 点组会', '推荐人 A 还没回'], done: [], stale: false });
  assert.equal(parseBrief('# 今日简介 2026-11-15\n- x', now).stale, true);
  assert.deepEqual(parseBrief('', now), { date: undefined, items: [], done: [], stale: false });
  const log = '- 2026-11-15 05:40 -05:00 · todo_add · 加入助手待办：A\nnoise\n- 2026-11-16 08:06 -05:00 · bib_add · 加入 JabRef：k（T）\n';
  assert.deepEqual(parseActions(log), [{ when: '11-16 08:06', tool: 'bib_add', text: '加入 JabRef：k（T）' }, { when: '11-15 05:40', tool: 'todo_add', text: '加入助手待办：A' }]);
  assert.equal(parseActions(log, 1).length, 1);
  assert.equal(formatToday(now), '11月16日 周一');
  assert.equal(actionsPathFor('/Users/ada/notes/life'), '/Users/ada/.dsh/personal-agent/actions.md');
  assert.equal(actionsPathFor('/Volumes/x/life'), undefined);
});

test('launch opens the main conversation (where the sticky note shows), or the overview without one, and collapses a wide sidebar', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const ws = '/Users/someone/assistant';
  async function launch({ width, stored = true, sessions = ['m'] }) {
    let bundle;
    const dom = { collapsed: false };
    const storage = new Map(stored ? [['personal-agent.workspace', ws], ['personal-agent.main-session', 'm']] : []);
    const document = { querySelector: selector => selector.includes('_sidebarCol') ? {} : selector === '[data-sidebar-collapsed]' ? (dom.collapsed ? {} : null) : null, createElement: () => ({}), head: { appendChild() {} } };
    vm.runInNewContext(source, { setTimeout, clearTimeout, document, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, window: { innerWidth: width, __ModuleLoader__: { load: value => { bundle = value; } } } });
    const calls = [];
    let onScreen;
    const byId = Object.fromEntries(sessions.map(id => [id, { id, title: id, updatedAt: 1, projectionValues: { agentPreset: 'personal' } }]));
    const ctx = {
      effect() {},
      layout: { selectPanel: id => calls.push(['panel', id]), panels: { toggleSidebar: () => { calls.push(['toggle sidebar']); dom.collapsed = !dom.collapsed; } } },
      workspaces: { list: { getSnapshot: () => ({ phase: 'ready', items: [{ workspaceId: 'w', path: ws, sessionIds: sessions }], archivedSessionIds: [] }) } },
      sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId }) } },
      uiWorkspace: { openSession: id => { calls.push(['open', id]); setTimeout(() => { onScreen = id; }, 150); } },
      sidebarRight: { mounted: { getSnapshot: () => onScreen, subscribe: () => () => {} }, openTab: kind => calls.push(['tab', kind]) },
      sidebarRightTabs: { register: () => () => {} },
      slots: { inject: (_name, callback) => callback(), register: (options, component) => { if (options.name === 'shell.overlay') splash = component; return () => {}; } },
    };
    let splash;
    const React = { createElement: (type, props, ...children) => ({ type, props, children }), useSyncExternalStore: (_subscribe, get) => get() };
    bundle.factory(() => React).apply(ctx);
    assert.notEqual(splash(), null, 'the splash covers the window during launch');
    await new Promise(resolve => setTimeout(resolve, 1300));
    assert.equal(splash(), null, 'the splash is gone once the layout is arranged');
    return calls;
  }
  assert.deepEqual(await launch({ width: 1440 }), [['toggle sidebar'], ['open', 'm']]);
  assert.deepEqual(await launch({ width: 900 }), [['open', 'm']]);
  assert.deepEqual(await launch({ width: 1440, stored: false }), [['toggle sidebar'], ['panel', 'personal-agent-assistant']]);
  assert.deepEqual(await launch({ width: 900, sessions: [] }), [['panel', 'personal-agent-assistant']]);
});
test('the main conversation is the chosen one, or the latest when none is chosen or it is gone', () => {
  const recent = [{ id: 'new' }, { id: 'old' }];
  assert.equal(pickMain(recent, 'old').id, 'old');
  assert.equal(pickMain(recent, undefined).id, 'new');
  assert.equal(pickMain(recent, 'archived').id, 'new');
  assert.equal(pickMain([], 'old'), undefined);
});

