// User settings for the tools: the preset row's config wins, then the user's settings file
// (~/.dsh/personal-agent/config.json), then these defaults. Nothing personal lives in the plugin.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SETTINGS_DIR = join(homedir(), '.dsh', 'personal-agent');
export const SETTINGS_FILE = process.env.PERSONAL_AGENT_CONFIG ?? join(SETTINGS_DIR, 'config.json');

export const DEFAULTS = Object.freeze({
  // Apple Reminders list that todo_add writes to, created by the user beforehand.
  todoList: 'Assistant',
  // Apple Notes folder that notes_create writes to, created on first use.
  notesFolder: 'Assistant',
  // BibTeX file that bib_add appends to; bib_add is not offered until one is set.
  bibLibrary: undefined,
  // The model for ask_computer's screen work (and its provider route, default openai), e.g.
  // gpt-6.1-terra; read by the preset's !!js expression. Unset keeps DSH's default model.
  computerModel: undefined,
  computerProvider: undefined,
  // Where the action log goes.
  actionLog: join(SETTINGS_DIR, 'actions.md'),
  // Tasks: links between the user's tasks and their reminders, events and emails, plus context.
  tasksFile: join(SETTINGS_DIR, 'tasks.json'),
  // The assistant browser's Chrome profile, shared by the headless Playwright MCP and browser_login.
  browserProfile: join(homedir(), '.dsh', 'mcp', 'playwright', 'profile'),
  // The assistant browser app (Playwright's Chrome for Testing), a link kept pointing at the newest
  // installed build. Playwright MCP starts it through --executable-path, browser_login through open.
  browserApp: join(homedir(), '.dsh', 'mcp', 'playwright', 'Chromium.app'),
  // Where the assistant browser saves screenshots and other files (Playwright MCP's --output-dir).
  browserOutput: join(homedir(), '.dsh', 'mcp', 'playwright', 'output'),
});

const expand = value => typeof value === 'string' && value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;

/** Keep only known settings that are non-empty strings, with `~/` expanded. */
function known(values) {
  if (values === null || typeof values !== 'object') return {};
  return Object.fromEntries(Object.keys(DEFAULTS)
    .filter(key => typeof values[key] === 'string' && values[key].trim() !== '')
    .map(key => [key, expand(values[key].trim())]));
}

export function loadSettings(overrides = {}, file = SETTINGS_FILE) {
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch (error) {
    if (error?.code !== 'ENOENT') process.stderr.write(`personal-agent: ignoring unreadable settings ${file}: ${error?.message ?? error}\n`);
  }
  return { ...DEFAULTS, ...known(saved), ...known(overrides) };
}
