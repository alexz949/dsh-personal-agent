export const PANEL_ID = 'personal-agent-assistant';
export const PRESET_ID = 'personal';
// The home's workspace is the folder the user picked, kept in this browser's storage.
export const WORKSPACE_KEY = 'personal-agent.workspace';

// Ignore trailing slashes so the same folder still matches however it was added.
const trimSlash = path => path.replace(/\/+$/, '');

export function personalSessions(workspaces, sessions, workspacePath) {
  const workspace = workspacePath ? workspaces.items.find(item => trimSlash(item.path) === trimSlash(workspacePath)) : undefined;
  const archived = new Set(workspaces.archivedSessionIds);
  const recent = workspace ? workspace.sessionIds
    .map(id => sessions.byId[id])
    .filter(item => item && !item.blank && item.origin !== 'subagent'
      && !archived.has(item.id) && item.projectionValues?.agentPreset === PRESET_ID)
    .sort((a, b) => b.updatedAt - a.updatedAt) : [];
  return { workspace, recent };
}

// Delegate creation, blank reuse, draft preservation and navigation cancellation
// to the installed DSH workspace service instead of mutating session state.
export function openPersonalSession(ctx, workspace) {
  if (!workspace) throw new Error('请先在 DSH 中添加个人助手工作区。');
  return ctx.uiWorkspace.openWorkspace(workspace.workspaceId, undefined, { agentPreset: PRESET_ID });
}

// The main conversation is the one the home sends questions to. It is the conversation the user
// chose, kept in this browser's storage; until then, or once that one is gone, the latest one.
export const MAIN_KEY = 'personal-agent.main-session';

export function pickMain(recent, storedId) {
  return recent.find(item => item.id === storedId) ?? recent[0];
}

const isPersonal = item => item && !item.blank && item.origin !== 'subagent' && item.projectionValues?.agentPreset === PRESET_ID;

/** Workspaces to offer on first run, the ones holding the most Personal Agent conversations first. */
export function workspaceChoices(workspaces, sessions) {
  return workspaces.items
    .map(workspace => ({ workspace, conversations: workspace.sessionIds.filter(id => isPersonal(sessions.byId[id])).length }))
    .sort((a, b) => b.conversations - a.conversations);
}

