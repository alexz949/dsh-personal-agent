const React = require('react');
const h = React.createElement;

const ICONS = {
  assistant: ['M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z', 'm12 6 1.2 3.3 3.3 1.2-3.3 1.2L12 15l-1.2-3.3-3.3-1.2 3.3-1.2Z'],
  plus: ['M12 5v14', 'M5 12h14'],
  chat: ['M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-5 3.5Z'],
  history: ['M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5', 'M3.5 4v4.5H8', 'M12 7.5V12l3 2'],
  chevron: ['m9.5 6 6 6-6 6'],
  alert: ['M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z', 'M12 8v4.5', 'M12 16h.01'],
  folder: ['M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2.5h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z'],
  copy: ['M10 9h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z', 'M15 9V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  sun: ['M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z', 'M12 3v1.5', 'M12 19.5V21', 'm5.6 5.6 1.1 1.1', 'm17.3 17.3 1.1 1.1', 'M3 12h1.5', 'M19.5 12H21', 'm5.6 18.4 1.1-1.1', 'm17.3 6.7 1.1-1.1'],
  calendar: ['M5 5.5h14a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z', 'M4 10h16', 'M8.5 3.5v3', 'M15.5 3.5v3'],
  bell: ['M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14Z', 'M10 20.5a2 2 0 0 0 4 0'],
  mail: ['M4.5 6h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z', 'm4 7 8 6 8-6'],
  note: ['M6 3.5h8.5L19 8v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z', 'M14 3.5V8h5', 'M8.5 13h7', 'M8.5 16.5h5'],
  book: ['M5 4.5h5.5A2.5 2.5 0 0 1 13 7v13a2 2 0 0 0-2-2H5Z', 'M19 4.5h-5.5A2.5 2.5 0 0 0 11 7', 'M13 20a2 2 0 0 1 2-2h4V4.5'],
  send: ['M12 19V5', 'm6 11 6-6 6 6'],
  pin: ['M9 4.5h6l-1 5 3.5 3.5v1.5h-11V13L10 9.5Z', 'M12 14.5V20'],
};

// One icon per kind of recorded action.
const ACTION_ICONS = { calendar_create: 'calendar', reminders_create: 'bell', todo_add: 'check', mail_draft: 'mail', mail_reply_draft: 'mail', notes_create: 'note', bib_add: 'book' };

function icon(name, size = 16) {
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    ...ICONS[name].map(d => h('path', { d })));
}

function AssistantIcon({ size = 18 }) {
  return icon('assistant', size);
}

function useSource(source) {
  return React.useSyncExternalStore(
    React.useCallback(listener => source.subscribe(listener), [source]),
    React.useCallback(() => source.getSnapshot(), [source]));
}

const titleOf = item => item.title || '未命名对话';

function UpdatedAt({ item, now }) {
  return item.running
    ? h('span', { className: 'pa-live' }, '进行中')
    : h('span', { className: 'pa-time' }, formatUpdatedAt(item.updatedAt, now));
}

// First run, or after 更换: pick the folder the home belongs to.
function WorkspaceSetup({ choices, choose }) {
  const nameOf = path => path.replace(/\/+$/, '').split('/').pop() || path;
  return h('div', { className: 'pa-callout', role: 'status' },
    h('p', { className: 'pa-callout-title' }, icon('folder', 15), '选择个人助手的工作区'),
    h('p', null, '首页会读这个文件夹里的 today.md，并列出在这里用 Personal Agent 的对话。之后可以随时在首页底部更换。'),
    choices.length === 0
      ? h('p', { className: 'pa-setup-note' }, '还没有工作区。先点右上角“工作区”，在侧边栏“添加工作区”加一个文件夹。')
      : h('ul', { className: 'pa-ws-list' }, choices.map(({ workspace, conversations }) => h('li', { key: workspace.workspaceId },
        h('button', { className: 'pa-ws', onClick: () => choose(workspace.path), title: workspace.path },
          h('span', { className: 'pa-ws-text' }, h('span', { className: 'pa-ws-name' }, nameOf(workspace.path)), h('span', { className: 'pa-ws-path' }, workspace.path)),
          h('span', { className: 'pa-time' }, conversations > 0 ? `${conversations} 个助手对话` : ''),
          h('span', { className: 'pa-chevron' }, icon('chevron')))))));
}

// The main conversation first, then a few others; any of them can become the main one.
function Conversations({ main, others, busy, now, resume, setMain, newChat }) {
  return h('section', { className: 'pa-section', 'aria-label': '对话' },
    h('header', { className: 'pa-section-head' },
      h('h2', null, '对话'),
      h('button', { className: 'pa-head-action', disabled: busy, onClick: newChat, title: '单独开一个新对话，不进主对话' }, icon('plus', 13), '新对话')),
    !main ? h('p', { className: 'pa-section-empty' }, '还没有助手对话。在上面问第一件事，它会成为你的主对话。') : h('ul', { className: 'pa-list' },
      h('li', { key: main.id },
        h('button', { className: 'pa-row pa-row-main', disabled: busy, onClick: () => resume(main.id), title: '首页的提问都进这个对话' },
          h('span', { className: 'pa-tag' }, '主对话'),
          h('span', { className: 'pa-row-title' }, titleOf(main)),
          h(UpdatedAt, { item: main, now }))),
      others.slice(0, 4).map(item => h('li', { key: item.id },
        h('button', { className: 'pa-row', onClick: () => resume(item.id) },
          h('span', { className: 'pa-row-title' }, titleOf(item)),
          h(UpdatedAt, { item, now })),
        h('button', { className: 'pa-pin', title: '设为主对话', 'aria-label': `把“${titleOf(item)}”设为主对话`, onClick: () => setMain(item.id) }, icon('pin', 14))))));
}

function Loading() {
  return h('div', { className: 'pa-skeleton' },
    h('span', { className: 'pa-sr', role: 'status' }, '正在读取工作区和会话…'),
    h('div', { className: 'pa-skel pa-skel-card', 'aria-hidden': true }),
    ...[0, 1, 2].map(() => h('div', { className: 'pa-skel pa-skel-row', 'aria-hidden': true })));
}

// Read one text file through a Personal session (the file service addresses files by session) and
// read it again every minute, when the window regains focus, and shortly after refreshKey changes
// (a Personal conversation finished a turn or got a new message), so the assistant's changes to the
// 今日 note show up right away. A missing file is an ordinary state, not an error.
function useTextFile(ctx, sessionId, path, refreshKey) {
  const [state, setState] = React.useState({ status: 'loading' });
  const reload = React.useRef(undefined);
  React.useEffect(() => {
    if (refreshKey === undefined || reload.current === undefined) return undefined;
    const timer = setTimeout(() => reload.current?.(), 1200);
    return () => clearTimeout(timer);
  }, [refreshKey]);
  React.useEffect(() => {
    if (!sessionId || !path) { setState({ status: 'nosession' }); return undefined; }
    const controller = new AbortController();
    let running = false;
    async function load() {
      if (running) return;
      running = true;
      try {
        const result = await ctx.remote.workspaceFiles.read(sessionId, path, { limit: 2000 }, controller.signal);
        if (controller.signal.aborted) return;
        if (result.ok) setState({ status: 'ok', text: result.value.text });
        else setState({ status: /not-?found|absent|enoent/i.test(`${result.error?.code} ${result.error?.message}`) ? 'missing' : 'error' });
      } catch (reason) {
        if (!controller.signal.aborted) { console.error(reason); setState({ status: 'error' }); }
      } finally { running = false; }
    }
    load();
    reload.current = load;
    const timer = setInterval(load, 60e3);
    window.addEventListener('focus', load);
    return () => { reload.current = undefined; controller.abort(); clearInterval(timer); window.removeEventListener('focus', load); };
  }, [ctx, sessionId, path]);
  return state;
}

// Today's points under the composer: the most urgent first, three shown until expanded.
function Today({ brief, status, ask }) {
  const [open, setOpen] = React.useState(false);
  const items = brief?.items ?? [];
  const shown = open ? items : items.slice(0, 3);
  let body;
  if (status === 'loading') body = h('div', { className: 'pa-skel pa-skel-row', 'aria-hidden': true });
  else if (status === 'error') body = h('p', { className: 'pa-section-empty' }, '暂时读不到今日要点。');
  else if (items.length === 0) body = h('p', { className: 'pa-section-empty' }, '还没有今天的要点。',
    h('button', { className: 'pa-link', onClick: () => ask('做早间检查') }, '做一次早间检查'));
  else body = h(React.Fragment, null,
    h('ul', { className: 'pa-points' }, shown.map((item, i) => h('li', { key: i, className: i === 0 ? 'pa-point-first' : undefined }, item))),
    items.length > 3 && h('button', { className: 'pa-link pa-more', onClick: () => setOpen(!open) }, open ? '收起' : `还有 ${items.length - 3} 条`),
    brief.stale && h('p', { className: 'pa-section-note' }, `这是 ${brief.date} 的要点。`,
      h('button', { className: 'pa-link', onClick: () => ask('做早间检查') }, '更新')));
  return h('section', { className: 'pa-section', 'aria-label': '今日要点' },
    h('header', { className: 'pa-section-head' },
      h('h2', null, icon('sun', 14), '今日要点'),
      brief?.date && !brief.stale && h('span', { className: 'pa-time' }, brief.date.slice(5).replace('-', '/'))),
    body);
}

// Recent actions stay folded away behind one line until asked for.
function Actions({ file }) {
  const [open, setOpen] = React.useState(false);
  const actions = file.status === 'ok' ? parseActions(file.text, 5) : [];
  if (actions.length === 0) return null;
  return h('section', { className: 'pa-actions', 'aria-label': '最近替你做的事' },
    h('button', { className: 'pa-disclosure', 'aria-expanded': open, onClick: () => setOpen(!open) },
      icon('history', 13), '最近替你做的事', h('span', { className: open ? 'pa-chevron pa-chevron-open' : 'pa-chevron' }, icon('chevron', 13))),
    open && h('ul', { className: 'pa-actions-log' }, actions.map((item, i) => h('li', { key: i, title: item.text },
      h('span', { className: 'pa-action-icon' }, icon(ACTION_ICONS[item.tool] ?? 'check', 13)),
      h('span', { className: 'pa-action-text' }, item.text),
      h('span', { className: 'pa-time' }, item.when)))));
}

// The composer in the middle of the home, sized like DSH's own conversation composer so the
// question box stays in roughly the same place when the conversation opens.
function Composer({ disabled, ask, hasMain }) {
  const [text, setText] = React.useState('');
  const field = React.useRef(null);
  function grow() {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }
  function submit(event) {
    event?.preventDefault();
    ask(text.trim());
    setText('');
    requestAnimationFrame(grow);
  }
  const empty = text.trim() === '';
  return h('div', { className: 'pa-compose' },
    h('form', { className: 'pa-ask', onSubmit: submit },
      h('textarea', {
        ref: field, value: text, rows: 1, disabled, 'aria-label': '问 Personal Agent',
        placeholder: hasMain ? '问点什么，或者交给我一件事' : '问点什么，或者交给我一件事',
        onChange: event => { setText(event.target.value); grow(); },
        onKeyDown: event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event); },
      }),
      h('button', { type: 'submit', className: empty ? 'pa-send pa-send-idle' : 'pa-send', disabled, title: empty ? (hasMain ? '打开主对话' : '新对话') : '发送', 'aria-label': empty ? (hasMain ? '打开主对话' : '新对话') : '发送' },
        icon(empty && !hasMain ? 'plus' : 'send', 16))),
    h('div', { className: 'pa-chips' }, QUICK_ASKS.map(item => h('button', { key: item, type: 'button', className: 'pa-chip', disabled, onClick: () => ask(item) }, item))));
}

// The main conversation's id lives in this browser's storage, which can be unavailable.
function readStored(key) {
  try { return localStorage.getItem(key) || undefined; } catch { return undefined; }
}

function writeStored(key, value) {
  try { if (value === undefined) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* the choice just lasts for this session */ }
}

// Send a question straight into an existing conversation, through the session object that DSH's own
// conversation view uses for conversation.send: binding.session.prompt(content, 'queue'). Queue mode
// waits for a busy conversation to finish instead of interrupting it. These are internal pieces, so
// this reports false when they are missing or the session refuses the prompt.
async function sendToSession(ctx, sessionId, prompt) {
  for (let tries = 0; tries < 20; tries++) {
    const session = typeof ctx.sessions.binding === 'function' ? ctx.sessions.binding(sessionId)?.session : undefined;
    if (typeof session?.prompt === 'function') {
      try {
        const result = await session.prompt([{ type: 'text', text: prompt }], 'queue');
        return result?.ok !== false;
      } catch (reason) { console.error(reason); return false; }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

// Put a question into an existing conversation's input box, the way DSH's own workspace view
// prepares drafts. These are internal pieces (session binding, conversation input), so this waits
// briefly for the opened conversation and reports false when they are missing or input is blocked.
async function fillDraft(ctx, sessionId, prompt) {
  for (let tries = 0; tries < 20; tries++) {
    const binding = typeof ctx.sessions.binding === 'function' ? ctx.sessions.binding(sessionId) : undefined;
    const input = typeof ctx.get === 'function' ? ctx.get('conversation')?.input : undefined;
    if (binding !== undefined && typeof input?.requestDraftInitialization === 'function') {
      return input.requestDraftInitialization(binding, { prompt, whenDraftExists: 'replace' }) !== 'blocked';
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

// The left sidebar is collapsed and reopened with the same action as DSH's own Mod+B. That action
// sits on the layout service's store rather than its documented methods, so each step checks it
// exists and does nothing otherwise. The frame marks a collapsed sidebar with data-sidebar-collapsed.
function sidebarState() {
  if (typeof document === 'undefined' || !document.querySelector('[class*="_sidebarCol"]')) return undefined;
  if (document.querySelector('[data-sidebar-drawer]')) return 'drawer';
  return document.querySelector('[data-sidebar-collapsed]') ? 'collapsed' : 'open';
}

function toggleSidebar(ctx) {
  // Newer DSH builds expose toggleSidebar on the layout service itself; older ones only on its store.
  const target = typeof ctx.layout?.toggleSidebar === 'function' ? ctx.layout : ctx.layout?.panels;
  if (typeof target?.toggleSidebar !== 'function') return false;
  target.toggleSidebar();
  return true;
}

// Leaving the home fades it out while the conversation rises in, with the browser's view
// transitions. The html class scopes the animation to these moves only; without support, or with
// reduced motion, the view just switches. The callback waits a moment so the transition captures
// the conversation after DSH has rendered it.
function smoothly(update) {
  const root = typeof document === 'undefined' ? undefined : document.documentElement;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof document?.startViewTransition !== 'function' || reduced) { update(); return; }
  root.classList.add('pa-vt');
  const transition = document.startViewTransition(async () => {
    update();
    await new Promise(resolve => setTimeout(resolve, 60));
  });
  transition.finished.finally(() => root.classList.remove('pa-vt'));
}

function showWorkspaces(ctx) {
  smoothly(() => {
    ctx.layout.selectPanel(null);
    if (sidebarState() === 'collapsed') toggleSidebar(ctx);
  });
}

// On launch, wait for the frame to render, then collapse a wide-window sidebar once. Narrow windows
// already collapse it themselves.
function collapseOnLaunch(ctx, tries = 30) {
  const state = sidebarState();
  if (state === undefined) return tries > 0 ? setTimeout(() => collapseOnLaunch(ctx, tries - 1), 100) : undefined;
  if (state === 'open' && window.innerWidth >= 1024) toggleSidebar(ctx);
  return undefined;
}

// What the overview page and the 今日 tab share: the chosen workspace, its Personal Agent
// conversations, the main conversation, today's points and the action log.
function usePersonal(ctx) {
  const workspaces = useSource(ctx.workspaces.list);
  const sessions = useSource(ctx.sessions.list);
  const [storedWorkspace, setStoredWorkspace] = React.useState(() => readStored(WORKSPACE_KEY));
  function chooseWorkspace(path) { writeStored(WORKSPACE_KEY, path); setStoredWorkspace(path); }
  const { workspace, recent } = personalSessions(workspaces, sessions, storedWorkspace);
  const ready = workspaces.phase === 'ready' && sessions.phase === 'ready';
  const failed = workspaces.phase === 'error' || sessions.phase === 'error';
  const reader = recent[0]?.id;
  // Changes when a Personal conversation starts or ends a turn or gets a new message.
  const activity = recent.map(item => `${item.id}:${item.running ? 1 : 0}:${item.updatedAt ?? ''}`).join('|');
  const today = useTextFile(ctx, reader, workspace && `${workspace.path.replace(/\/+$/, '')}/${TODAY_FILE}`, activity);
  const actions = useTextFile(ctx, reader, actionsPathFor(workspace?.path), activity);
  const brief = today.status === 'ok' ? parseBrief(today.text) : undefined;
  const points = brief && !brief.stale ? brief.items.length : 0;
  const [storedMain, setStoredMain] = React.useState(() => readStored(MAIN_KEY));
  const main = pickMain(recent, storedMain);
  const others = recent.filter(item => item !== main);
  React.useEffect(() => {
    if (main && main.id !== storedMain) { writeStored(MAIN_KEY, main.id); setStoredMain(main.id); }
  }, [main?.id, storedMain]);
  function setMain(id) { writeStored(MAIN_KEY, id); setStoredMain(id); }
  return { workspaces, sessions, ready, failed, workspace, recent, main, others, setMain, chooseWorkspace, today, actions, brief, points };
}

function AssistantPanel({ ctx }) {
  const { workspaces, sessions, ready, failed, workspace, main, others, setMain, chooseWorkspace, today, actions, brief, points } = usePersonal(ctx);
  const creating = React.useRef(false);
  const now = Date.now();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  // A question is sent straight into the main conversation, which opens to show the answer. If it
  // cannot be sent, it waits in that conversation's input box instead; without a main conversation,
  // when asked for a fresh one, or when neither works, a new Personal conversation opens with it in
  // the input box, so the question is never lost.
  // DSH already toasts failed session creation; only log here to avoid a second message.
  async function ask(prompt, { fresh = false } = {}) {
    if (creating.current) return;
    creating.current = true;
    setBusy(true);
    setError('');
    try {
      if (main && !fresh) {
        smoothly(() => ctx.uiWorkspace.openSession(main.id));
        if (!prompt || await sendToSession(ctx, main.id, prompt) || await fillDraft(ctx, main.id, prompt)) return;
      }
      if (prompt) await ctx.uiWorkspace.startSession(workspace.workspaceId, { agentPreset: PRESET_ID, prompt, whenDraftExists: 'replace' });
      else await openPersonalSession(ctx, workspace);
    } catch (reason) { console.error(reason); }
    finally { creating.current = false; setBusy(false); }
  }
  function resume(id) {
    try { smoothly(() => ctx.uiWorkspace.openSession(id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  let below;
  if (failed) below = h('div', { className: 'pa-callout', role: 'status' },
    h('p', { className: 'pa-callout-title' }, icon('alert'), '暂时无法读取会话'),
    h('p', null, '请检查 DSH 连接后重试。'));
  else if (!ready) below = h(Loading);
  else if (!workspace) below = h(WorkspaceSetup, { choices: workspaceChoices(workspaces, sessions), choose: chooseWorkspace });
  else below = h(React.Fragment, null,
    h('div', { className: 'pa-below' },
      h(Today, { brief, status: today.status, ask }),
      h(Conversations, { main, others, busy, now, resume, setMain, newChat: () => ask('', { fresh: true }) })),
    h(Actions, { file: actions }),
    h('footer', { className: 'pa-footer', title: workspace.path },
      icon('folder', 12), workspace.path.replace(/\/+$/, '').split('/').pop(),
      h('button', { className: 'pa-link', onClick: () => chooseWorkspace(undefined) }, '更换'),
      h('span', { className: 'pa-footer-sep', 'aria-hidden': true }, '·'),
      h('button', { className: 'pa-link', disabled: busy, title: '助手的浏览器在后台运行；要登录网站时，在这里打开一个可见窗口', onClick: () => ask('打开助手浏览器，让我登录一下') }, '登录助手浏览器')));
  // As on DSH's own pages, the top strip moves the window on macOS.
  return h('section', { className: 'pa-assistant', 'aria-label': '个人助理' },
    h('div', { className: 'pa-topbar', 'data-window-drag': true },
      h('button', { className: 'pa-dev', title: '回到 DSH 的工作区和会话列表', onClick: () => showWorkspaces(ctx) }, icon('folder', 13), '工作区')),
    h('div', { className: 'pa-home' },
      h('div', { className: 'pa-stage' },
        h('h1', null, `${greeting(new Date(now).getHours())}，想做点什么？`),
        h('p', { className: 'pa-sub' }, formatToday(new Date(now)), points > 0 && ` · 今天有 ${points} 件事要留意`),
        ready && workspace && h(Composer, { disabled: busy, ask, hasMain: main !== undefined }),
        error && h('p', { role: 'alert', className: 'pa-error' }, icon('alert'), error)),
      below));
}

// The 今日 tab in the main conversation's right sidebar: the conversation itself is the home, as
// OpenClaw does it, and today's points, the conversations and recent actions sit beside it.
const TODAY_TAB_ID = 'dsh-personal-agent/today';
const TODAY_KIND = 'personal-today';

function TodayTab({ ctx }) {
  const { ready, failed, workspace, main, others, setMain, today, actions, brief, points } = usePersonal(ctx);
  const [busy, setBusy] = React.useState(false);
  const now = Date.now();
  const overview = () => ctx.layout.selectPanel(PANEL_ID);
  function resume(id) {
    try { ctx.uiWorkspace.openSession(id); } catch (reason) { console.error(reason); }
  }
  // Quick asks go straight into the main conversation, opening it first when another one is shown.
  async function ask(prompt) {
    if (!main || busy) return;
    setBusy(true);
    try {
      if (ctx.sidebarRight?.mounted?.getSnapshot?.() !== main.id) ctx.uiWorkspace.openSession(main.id);
      if (!await sendToSession(ctx, main.id, prompt)) await fillDraft(ctx, main.id, prompt);
    } catch (reason) { console.error(reason); }
    finally { setBusy(false); }
  }
  function newChat() {
    if (workspace) openPersonalSession(ctx, workspace).catch(reason => console.error(reason));
  }
  let body;
  if (failed) body = h('p', { className: 'pa-section-empty' }, '暂时无法读取会话，请检查 DSH 连接。');
  else if (!ready) body = h(Loading);
  else if (!workspace) body = h('p', { className: 'pa-section-empty' }, '还没有选择个人助手的工作区。', h('button', { className: 'pa-link', onClick: overview }, '去选择'));
  else body = h(React.Fragment, null,
    h('div', { className: 'pa-chips' }, QUICK_ASKS.map(item => h('button', { key: item, className: 'pa-chip', disabled: busy || !main, onClick: () => ask(item) }, item))),
    h(Today, { brief, status: today.status, ask }),
    h(Conversations, { main, others, busy, now, resume, setMain, newChat }),
    h(Actions, { file: actions }));
  return h('section', { className: 'pa-tab', 'aria-label': '今日' },
    h('header', { className: 'pa-tab-head' },
      h('div', null,
        h('h2', null, `${greeting(new Date(now).getHours())}`),
        h('p', null, formatToday(new Date(now)), points > 0 && ` · ${points} 件事要留意`)),
      h('button', { className: 'pa-head-action', onClick: overview, title: '打开个人助手总览' }, '总览')),
    body);
}

// A launch splash over the whole window (DSH's shell.overlay layer) hides the steps of arranging the
// layout: collapsing the sidebar, opening the main conversation, opening the 今日 tab. Once they
// are done it fades out in one go. It always leaves within a few seconds, whatever happens.
const splash = (() => {
  let phase = 'shown';
  const listeners = new Set();
  const set = next => { if (phase === 'gone' || phase === next) return; phase = next; listeners.forEach(listener => listener()); };
  return {
    getSnapshot: () => phase,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    leave: () => {
      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) { set('gone'); return; }
      set('leaving');
      setTimeout(() => set('gone'), 420);
    },
  };
})();

function Splash() {
  const phase = React.useSyncExternalStore(splash.subscribe, splash.getSnapshot);
  if (phase === 'gone') return null;
  return h('div', { className: phase === 'leaving' ? 'pa-splash pa-splash-leaving' : 'pa-splash', 'aria-hidden': true, 'data-window-drag': true },
    h('div', { className: 'pa-splash-mark' }, icon('assistant', 26)),
    h('p', null, `${greeting(new Date().getHours())}`));
}

// The 今日 sticky note pinned over the main conversation, so the conversation keeps its full width.
// It shows only while the main conversation is on screen, folds into a small tab (remembered;
// folded by default below 1400px, where it would cover the conversation column), and can be dragged anywhere: on release it snaps to the
// nearer side, left or right, keeping its height. It steps aside while the left sidebar is open,
// and on the right also while the right sidebar is open.
const STICKY_KEY = 'personal-agent.sticky';
const STICKY_POS_KEY = 'personal-agent.sticky.pos';
const STICKY_GAP = 20;

function readStickyPos() {
  try {
    const value = JSON.parse(readStored(STICKY_POS_KEY) ?? 'null');
    if (value && (value.side === 'left' || value.side === 'right')) return { side: value.side, top: Number.isFinite(value.top) ? value.top : null };
  } catch { /* fall back to the default spot */ }
  return { side: 'right', top: null };
}

// Where a released note lands: the nearer side, its top kept inside the frame.
function snapSticky({ x, y, width, height, frameWidth, frameHeight, minTop, leftInset }) {
  const side = x + width / 2 < frameWidth / 2 ? 'left' : 'right';
  const top = Math.round(Math.max(minTop, Math.min(y, frameHeight - height - 12)));
  return { side, top, x: side === 'left' ? leftInset + STICKY_GAP : frameWidth - width - STICKY_GAP };
}

// The right edge of DSH's left sidebar (0 when it is collapsed or missing), so a note on the left
// doesn't cover it.
const leftEdge = {
  subscribe(listener) {
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(listener) : undefined;
    observer?.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-sidebar-collapsed'] });
    window.addEventListener('resize', listener);
    document.addEventListener('transitionend', listener);
    return () => { observer?.disconnect(); window.removeEventListener('resize', listener); document.removeEventListener('transitionend', listener); };
  },
  getSnapshot() {
    const column = typeof document === 'undefined' ? null : document.querySelector('[class*="_sidebarCol"]');
    if (!column || document.querySelector('[data-sidebar-collapsed]')) return 0;
    return Math.max(0, Math.round(column.getBoundingClientRect().right));
  },
};

// Pointer dragging for the note. A press that moves less than 4px stays a click.
function useStickyDrag(leftInset, commit) {
  const [drag, setDrag] = React.useState(null);
  const start = React.useRef(null);
  const moved = React.useRef(false);
  const place = (event, s) => ({ x: event.clientX - s.dx - s.frame.left, y: event.clientY - s.dy - s.frame.top });
  function onPointerDown(event) {
    moved.current = false;
    if (event.button !== 0 || event.target.closest?.('button:not([data-drag]), a')) return;
    const note = event.currentTarget;
    const box = note.getBoundingClientRect(), frame = (note.offsetParent ?? document.body).getBoundingClientRect();
    const clearance = parseFloat(getComputedStyle(note).getPropertyValue('--dsh-frame-top-clearance')) || 48;
    start.current = { dx: event.clientX - box.left, dy: event.clientY - box.top, x0: event.clientX, y0: event.clientY, frame, width: box.width, height: box.height, minTop: clearance + 8 };
    note.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    const s = start.current;
    if (!s || (!moved.current && Math.hypot(event.clientX - s.x0, event.clientY - s.y0) < 4)) return;
    moved.current = true;
    setDrag({ ...place(event, s), mode: 'dragging' });
  }
  function onPointerUp(event) {
    const s = start.current;
    start.current = null;
    if (!s || !moved.current) return;
    const spot = snapSticky({ ...place(event, s), width: s.width, height: s.height, frameWidth: s.frame.width, frameHeight: s.frame.height, minTop: s.minTop, leftInset });
    setDrag({ x: spot.x, y: spot.top, mode: 'snapping' });
    setTimeout(() => { moved.current = false; commit({ side: spot.side, top: spot.top }); setDrag(null); }, 240);
  }
  // A click that ends a drag shouldn't also fold or unfold the note.
  const wasDrag = () => { const value = moved.current; moved.current = false; return value; };
  return { drag, wasDrag, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

function useStore(store) {
  const subscribe = React.useCallback(listener => typeof store?.subscribe === 'function' ? store.subscribe(listener) : () => {}, [store]);
  const get = React.useCallback(() => typeof store?.getSnapshot === 'function' ? store.getSnapshot() : undefined, [store]);
  return React.useSyncExternalStore(subscribe, get);
}

const windowWidth = {
  subscribe: listener => { window.addEventListener('resize', listener); return () => window.removeEventListener('resize', listener); },
  getSnapshot: () => window.innerWidth,
};

function StickyNote({ ctx }) {
  const onScreen = useStore(ctx.sidebarRight?.mounted);
  const width = useStore(windowWidth);
  const { ready, workspace, main, today, brief, points } = usePersonal(ctx);
  const [stored, setStored] = React.useState(() => readStored(STICKY_KEY));
  const [busy, setBusy] = React.useState(false);
  const [pos, setPos] = React.useState(readStickyPos);
  const inset = useStore(leftEdge) ?? 0;
  const { drag, wasDrag, handlers } = useStickyDrag(inset, next => { writeStored(STICKY_POS_KEY, JSON.stringify(next)); setPos(next); });
  // Steps aside while the left sidebar (workspaces and conversations) is open, and comes back when
  // it is collapsed again. A note being dragged stays until it is dropped.
  if (!ready || !workspace || !main || onScreen !== main.id || (inset > 0 && !drag)) return null;
  const folded = stored ? stored === 'folded' : width < 1400;
  const fold = next => { if (wasDrag()) return; writeStored(STICKY_KEY, next); setStored(next); };
  const top = pos.top == null ? undefined : Math.min(pos.top, (window.innerHeight ?? 800) - 80);
  const style = drag ? { left: drag.x, top: drag.y, right: 'auto' }
    : pos.side === 'left' ? { left: inset + STICKY_GAP, right: 'auto', top } : { top };
  const place = `pa-side-${drag ? 'moving' : pos.side}${drag ? ` pa-sticky-${drag.mode}` : ''}`;
  async function ask(prompt) {
    if (busy) return;
    setBusy(true);
    try { if (!await sendToSession(ctx, main.id, prompt)) await fillDraft(ctx, main.id, prompt); }
    catch (reason) { console.error(reason); }
    finally { setBusy(false); }
  }
  if (folded) return h('button', { className: `pa-sticky-pill ${place}`, style, 'data-drag': true, ...handlers, onClick: () => fold('open'), title: '展开今日便签（可拖动）' },
    icon('sun', 13), '今日', points > 0 && h('span', { className: 'pa-sticky-count' }, points));
  const items = brief?.items ?? [];
  const finished = brief && !brief.stale ? brief.done.length : 0;
  let body;
  if (today.status === 'loading') body = h('div', { className: 'pa-skel pa-skel-row', 'aria-hidden': true });
  else if (items.length === 0 && finished > 0) body = h('p', { className: 'pa-sticky-empty' }, `今天的 ${finished} 件事都办完了。`);
  else if (items.length === 0) body = h('p', { className: 'pa-sticky-empty' }, '还没有今天的要点。', h('button', { className: 'pa-link', disabled: busy, onClick: () => ask('做早间检查') }, '做早间检查'));
  else body = h(React.Fragment, null,
    h('ul', { className: 'pa-points' }, items.slice(0, 3).map((item, i) => h('li', { key: i, className: i === 0 ? 'pa-point-first' : undefined }, item))),
    (items.length > 3 || brief.stale) && h('p', { className: 'pa-sticky-empty' },
      brief.stale ? `这是 ${brief.date} 的要点。` : `还有 ${items.length - 3} 条${finished ? `，已划掉 ${finished} 件` : ''}，`,
      h('button', { className: 'pa-link', onClick: () => ctx.layout.selectPanel(PANEL_ID) }, brief.stale ? '去总览更新' : '在总览里看')),
    items.length <= 3 && !brief.stale && finished > 0 && h('p', { className: 'pa-sticky-empty' }, `已划掉 ${finished} 件。`));
  // A click anywhere on the note that is not a button or link (and not the end of a drag) folds it
  // back into the pill, the way a click on the pill unfolds it; Escape does the same from inside.
  const foldOnClick = event => { if (!event.target.closest?.('button, a')) fold('folded'); };
  const foldOnEscape = event => { if (event.key === 'Escape') { event.stopPropagation(); fold('folded'); } };
  return h('aside', { className: `pa-sticky ${place}`, style, ...handlers, onClick: foldOnClick, onKeyDown: foldOnEscape, 'aria-label': '今日便签', title: '点击收起 · 拖动可移到左边或右边' },
    h('span', { className: 'pa-sticky-pin', 'aria-hidden': true }),
    h('header', { className: 'pa-sticky-head' },
      h('h2', null, icon('sun', 13), '今日', brief?.date && !brief.stale && h('span', { className: 'pa-time' }, brief.date.slice(5).replace('-', '/'))),
      h('button', { className: 'pa-sticky-icon', onClick: () => ctx.layout.selectPanel(PANEL_ID), title: '打开总览' }, icon('chevron', 13)),
    ),
    body,
    h('div', { className: 'pa-sticky-asks' }, QUICK_ASKS.map(item => h('button', { key: item, className: 'pa-chip', disabled: busy, onClick: () => ask(item) }, item))));
}

// Wait for a condition DSH reaches asynchronously, checking every 100 ms.
async function until(check, timeoutMs) {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 100))) {
    const value = check();
    if (value !== undefined) return value;
  }
  return undefined;
}

// On launch: open the main conversation, where the 今日 sticky note appears. Without a chosen
// workspace or any Personal conversation yet, open the overview page instead, where both get set up.
async function startup(ctx) {
  const lists = await until(() => {
    const workspaces = ctx.workspaces.list.getSnapshot(), sessions = ctx.sessions.list.getSnapshot();
    return workspaces.phase === 'ready' && sessions.phase === 'ready' ? { workspaces, sessions } : undefined;
  }, 8000);
  collapseOnLaunch(ctx);
  const { workspace, recent } = lists ? personalSessions(lists.workspaces, lists.sessions, readStored(WORKSPACE_KEY)) : {};
  const main = workspace ? pickMain(recent, readStored(MAIN_KEY)) : undefined;
  if (!main) { ctx.layout.selectPanel(PANEL_ID); return; }
  ctx.uiWorkspace.openSession(main.id);
  // Let the conversation render under the splash.
  await until(() => ctx.sidebarRight?.mounted?.getSnapshot?.() === main.id || undefined, 3000);
  await new Promise(resolve => setTimeout(resolve, 300));
}

exports.inject = ['slots', 'uiWorkspace', 'workspaces', 'sessions', 'layout', 'remote', 'remote.workspaceFiles', 'sidebarRight', 'sidebarRightTabs'];
exports.apply = function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, 'personal-agent: panel styles');
  // The 今日 tab type, through the right sidebar's public registry. A failed registration leaves the
  // rest of the plugin working; launch then falls back to the overview page.
  ctx.effect(() => {
    try {
      return ctx.sidebarRightTabs.register({
        id: TODAY_TAB_ID,
        kind: TODAY_KIND,
        title: () => '今日',
        guide: [{ id: 'today', title: '今日', description: '今日要点、对话和最近替你做的事' }],
      });
    } catch (reason) { console.error('personal-agent: 今日 tab not registered', reason); return undefined; }
  }, 'personal-agent: today tab type');
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TODAY_TAB_ID, inject: () => ({ ctx }) }, TodayTab));
  ctx.slots.inject('shell.overlay', () => {
    const stopSticky = ctx.slots.register({ name: 'shell.overlay', id: 'personal-agent-sticky', inject: () => ({ ctx }) }, StickyNote);
    const stopSplash = ctx.slots.register({ name: 'shell.overlay', id: 'personal-agent-splash' }, Splash);
    return () => { stopSplash(); stopSticky(); };
  });
  ctx.slots.inject('main', () => ctx.slots.inject('sidebar.panellist', () => {
    const stopPanel = ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({ ctx }) }, AssistantPanel);
    let stopButton;
    try {
      stopButton = ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 15, label: '助理' }, AssistantIcon);
    } catch (error) { stopPanel(); throw error; }
    // DSH opens on the main conversation with the 今日 tab, or on the overview page until one exists.
    const opening = setTimeout(() => { startup(ctx).catch(reason => console.error(reason)).finally(() => splash.leave()); }, 0);
    const failsafe = setTimeout(() => splash.leave(), 4500);
    return () => { clearTimeout(opening); clearTimeout(failsafe); splash.leave(); stopButton(); stopPanel(); };
  }));
};
