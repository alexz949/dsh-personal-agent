# Personal Agent for Codex

The same assistant as the DSH plugin, packaged as a Codex plugin. This page records what carries
over from DSH, what does not, and where Codex's own features replace ours.

## What is reused as is

| Piece | How it reaches Codex |
|---|---|
| Apple Calendar, Reminders, Notes and Mail tools (`calendar_*`, `reminders_*`, `notes_*`, `mail_*`, drafts) | the plugin's MCP server ([mcp/server.js](../mcp/server.js)) runs the same tool code from `src/` and the same Swift helper |
| Confirmation cards for creating, changing and deleting events and reminders | an MCP elicitation form; Codex shows it (feature `tool_call_mcp_elicitation`) |
| Tasks (`task_create`, `task_update`, `task_list`) and `tasks.json` | MCP server, same file as DSH, so both apps see the same 记下的事 |
| 今日 note (`today_update`) and the weekly journal (`journal_status`, `journal_write`) | MCP server, writing into the workspace set by `workspace` in the settings file |
| `todo_add`, `reminders_complete`, rescheduling, `calendar_delete`, `notify`, `arxiv_search`, `bib_add` | MCP server |
| Action log (`actions.md`) | written by the same tool wrapper |
| The assistant's rules: personalities, tasks, email as copyable text, calendar and reminder rules, morning and evening checks, journal | Codex skills in [codex/skills](../codex/skills), adapted from the DSH preset prompt |
| The workspace `AGENTS.md` | Codex reads `AGENTS.md` from the session's folder on its own |

## What does not carry over

| Piece | Why |
|---|---|
| The 今日 sticky note, the overview page, 记下的事 list, the 今日 tab, launch splash | DSH client UI plugins; Codex has no slot for them. The assistant reports the same things in chat, and `today.md` / `tasks.json` stay in sync for DSH. |
| DSH schedules (`schedule_create`) and `[SCHEDULE REMINDER]` messages | DSH runtime; use a Codex automation instead (below) |
| Mnemon memory | a DSH plugin; Codex has its own memories (feature `memories`, off by default) |
| `ask_research` subagent on the `personal-research` preset | DSH presets; in Codex the assistant searches with `arxiv_search` and web search itself |

## Where Codex's own feature is better

| DSH plugin piece | Codex instead |
|---|---|
| Playwright MCP, Chrome for Testing, `browser_login`, cookie keeping | Codex's built-in browser (`browser_use`, `in_app_browser`) |
| `ask_computer` on DSH's experimental Computer Use | Codex's built-in computer use (`computer_use`), with a stronger vision model |
| `dsh-tool-office` (Word / PowerPoint / Excel) | the bundled Codex plugins `documents`, `presentations`, `spreadsheets`, `pdf` |
| DSH sandbox for shell commands | Codex's sandbox and approval modes |
| DSH schedules for 8:00 / 22:00 reports | Codex automations (`in_app_local_automation`) running `$personal-agent` with 做早间检查 / 写今日小结 |

## Install (local)

```bash
npm run build
codex plugin marketplace add "$PWD"
codex plugin add personal-agent@dsh-personal-agent
```

Then set `workspace` in `~/.dsh/personal-agent/config.json` to the folder holding `today.md`,
`journal/` and `AGENTS.md`, and start Codex in that folder. Invoke the assistant with
`$personal-agent`.

Codex installs a copy of the plugin (`~/.codex/plugins/cache/...`), so after pulling or editing
this checkout, run `npm run build`, then `codex plugin remove personal-agent@dsh-personal-agent` and
`codex plugin add personal-agent@dsh-personal-agent` again.

Codex asks before each MCP tool call under its usual approval rules; `codex exec` with approval
`never` therefore cannot use the tools. Creating, changing and deleting events and reminders also
shows the plugin's own confirmation form. The MCP config uses `cwd: "."` with a relative script
path: Codex resolves `cwd` against the plugin root, but does not expand `${PLUGIN_ROOT}` in `args`.

For the 8:00 and 22:00 reports, create two Codex automations in the workspace folder that run
`$personal-agent 做早间检查` and `$personal-agent 写今日小结`.
