# DSH Personal Agent

A personal assistant plugin for DeepSeek Harness (DSH) on macOS. It adds a **Personal** agent preset that works with your Apple Calendar, Reminders, Notes and Mail, keeps a 今日 (today) sticky note and a weekly work journal, and makes DSH open on your main conversation.

[中文说明](README.zh-CN.md) · [Security](SECURITY.md)

| 今日 note over the main conversation | Overview page |
|---|---|
| ![The 今日 sticky note pinned over a conversation](docs/screenshots/sticky-note.jpg) | ![The overview page with today's points, conversations and quick questions](docs/screenshots/overview.jpg) |

<sub>Screenshots use made-up sample data.</sub>

> **Status:** early, macOS only. The persona and the interface are in Chinese for now (an English version is on the roadmap); the tools themselves work in any language.

## What it does

- **Apple apps through a small helper app.**
  - Read your calendar and reminders. New events and reminders are created only after you confirm a card in DSH.
  - Add to-dos to one "assistant" list in Reminders, and mark reminders done (never deletes).
  - Search, read and create notes in one assistant folder.
  - Read mail that Apple Mail has synced, and save drafts and reply drafts. It **never sends** mail.
- **今日 sticky note.**
  - A small note pinned over the main conversation with today's top items and quick questions.
  - Drag it to either side; it snaps to the nearer edge and remembers where you put it.
  - Click the note to fold it into a small pill, and click the pill to open it again.
  - Drag the grip in its bottom inner corner to make it wider or taller; a taller note shows every item and scrolls. It remembers the size, and a double click on the grip goes back to the default. Without a chosen height it shows the first five items.
  - It steps aside while the left sidebar is open, and comes back when you collapse it.
  - The assistant crosses items off and adds new ones as the day goes (`today_update`).
- **A notebook and a password book.**
  - It keeps your ordinary details (account names, login email, student ID, address, phone) up to date in your profile file when they change or you ask, and tells you what it changed.
  - Passwords, card and ID numbers go into the macOS keychain instead (`secret_save`), never into memory or files. Using one (`secret_get`) asks you each time, naming the site and the field it goes into; Chrome's own autofill is used first when it has the password.
- **Tasks with one consistent state.**
  - Say "帮我记住……" (remember that I need to…) and the assistant records it as a task. The overview page and the 今日 tab show these under 记下的事, soonest due first, with the next step and who it waits on.
  - Each task gets a stable id and keeps where it came from (an email's Message-ID), the next step, who it waits on and when it counts as done. The same email never makes a second task.
  - Ownership is split: Reminders owns a linked reminder's done state and due time, Calendar owns events, the plugin's `tasks.json` keeps only links and context, and the 今日 note is a view.
  - `task_list` checks Reminders and Mail first, so a reminder ticked off or a reply sent directly in those apps shows up. It tells "draft saved" apart from "reply sent", and when a check fails it says so instead of reporting everything done.
- **Rescheduling and repeats.**
  - Move reminders and events (`reminders_update`, `calendar_update`), including "remind me tomorrow" or "push it a week" as relative moves that keep the time of day across daylight-saving changes. A moved reminder no longer rings at its old time.
  - Daily, weekly, monthly or yearly repeats with an end date or a count; for a repeating event you choose "only this one" or "this and later ones".
  - End a repeating event early, or keep one occurrence and stop the rest (`calendar_update` with `repeat`). The card says how many later occurrences drop off.
  - Delete an event when you ask for it (`calendar_delete`): a single event, one week of a repeating event, or this and all later occurrences. The card shows the event and, for a series, how many occurrences go. Deleted events cannot be restored from Calendar.
  - Every change shows the old and new values on a confirmation card, with overlapping events and free slots that day. The same request sent twice does not create a second event or reminder.
- **Weekly journal.**
  - One Markdown file per week (`journal/2026/2026-W46.md`) with a section per day.
  - A 本周总结 (week summary) is added on top once the week is over, plus a monthly summary. Quarterly and yearly summaries are written when you ask.
  - Day entries are never deleted.
- **Personalities.**
  - Six built-in speaking styles: 助理 (assistant, default), 专业 (professional), 高效 (efficient), 搭档 (friendly partner), 直率 (candid) and 傲娇 (an elegant, cool, sharp-tongued tsundere, for fun: it sighs at you, fixes everything flawlessly, then says "don't get the wrong idea"; it drops the act only for real distress, health or bad news).
  - Three tweaks: warmth, lists and emoji.
  - Set a default in your workspace's `AGENTS.md`, or switch mid-conversation.
- **Research helpers.**
  - `arxiv_search`.
  - `bib_add`, which appends a paper to your BibTeX/JabRef library.
  - A read-only Research subagent (`ask_research`) that the main agent delegates paper searches to.
- **Action log.** Every event, reminder, to-do, draft, note, BibTeX entry, completed reminder and note change is appended to a plain-text log you can read back.
- **A home that DSH opens on.**
  - A launch splash, then your main conversation with the left sidebar collapsed.
  - An 助理 (overview) page with today's points, recent conversations and recent actions.

It also uses DSH's own tools: files, web search, bash in the DSH sandbox, schedules, Office files, skills and memory (with the Mnemon plugin). It can optionally drive a headless Chrome through Microsoft's Playwright MCP, with a visible window only when you need to sign in.

## Codex

The same assistant also installs as a Codex plugin, sharing its tasks, 今日 note, journal and action log with DSH. See [docs/codex.md](docs/codex.md) for what carries over, what Codex does better itself (browser, computer use, Office files, automations) and how to install it.

## Requirements

- macOS 14 or later.
- DeepSeek Harness desktop `0.2.2-rc.3` or a later `0.2.x`.
- To build from source: Node.js 20+ and the Xcode command line tools (`xcode-select --install`) for the Swift helper.

## Install

### From source

```bash
git clone https://github.com/alexz949/dsh-personal-agent.git
cd dsh-personal-agent
npm run build
npm test
```

Then link the folder into your DSH desktop profile and restart DSH (⌘Q, then open it again):

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add link:$PWD
```

With a link, updating is `git pull && npm run build`, then restart DSH. `dsh plugin` forwards its arguments to pnpm in the profile folder.

### From npm

In DSH, open **Plugins → Add plugin** and enter `dsh-personal-agent`, or run:

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add dsh-personal-agent
```

Restart DSH afterwards. The package includes a prebuilt universal helper (Apple silicon and Intel).

### From a plugin index

Add `https://raw.githubusercontent.com/alexz949/dsh-personal-agent/main/market.json` as an index source under **Plugins → Discover** (DSH's experimental custom plugin market), then install from there.

## First run

1. **Set up a workspace.** Copy [`template/`](template) somewhere private and fill in `shared/USER_PROFILE.md` and the "This user's setup" section of `agents/life/AGENTS.md` (mail accounts, folders, default personality). Your notes, journal and profile must never go into a public repository.
2. **Add it to DSH.** Add `agents/life` as a DSH workspace and start a conversation with the **Personal** preset. The home asks which workspace to use the first time.
3. **Allow permissions.** The first Calendar, Reminders, Notes or Mail request opens **Personal Agent Helper**, and macOS asks for permission. Allow it.
   - macOS ties the permission to the helper's code signature. Rebuilding the helper after changing `helper/` may ask again.
4. **Optional: Reminders list.** Create a list named `Assistant` in Reminders for `todo_add`, or set another name (see Settings).

## Settings

Optional, in `~/.dsh/personal-agent/config.json`. You can override the path with `PERSONAL_AGENT_CONFIG`.

```json
{
  "todoList": "Assistant",
  "notesFolder": "Assistant",
  "bibLibrary": "~/Documents/JabRef/library.bib",
  "actionLog": "~/.dsh/personal-agent/actions.md",
  "browserProfile": "~/.dsh/mcp/playwright/profile",
  "tasksFile": "~/.dsh/personal-agent/tasks.json",
  "computerModel": "gpt-6.1-terra",
  "computerProvider": "openai",
  "browserMode": "background"
}
```

`bib_add` is offered only when `bibLibrary` is set. `computerModel` (with `computerProvider`, default `openai`) picks the model `ask_computer`'s child uses for screen work, so a stronger vision model can drive the screen while Personal Agent keeps its own; the model must exist on that provider route in your DSH profile (for OpenAI, the `@deepseek-ai/dsh-llm-pi-ai` row), with its API key set in DSH. Leave it out to use DSH's default model. Restart DSH after changing it.

### Browser automation (optional)

The preset starts Playwright MCP from `~/.dsh/mcp/playwright`, using `/usr/local/bin/node`:

```bash
mkdir -p ~/.dsh/mcp/playwright && cd ~/.dsh/mcp/playwright && npm install @playwright/mcp
node node_modules/playwright-core/cli.js install chromium
```

The second line downloads Playwright's own **Chrome for Testing** (about 250 MB). The assistant uses it instead of your Google Chrome: it is a separate app with its own Dock icon, so links from other apps never open in it and quitting it never quits your Chrome. The plugin keeps `~/.dsh/mcp/playwright/Chromium.app` linked to the newest installed build (setting `browserApp`), and both the background browser and the sign-in window start from that link. Run the install line again after updating `@playwright/mcp`.

On Apple Silicon with Homebrew, Node is usually `/opt/homebrew/bin/node`. Change `command` in the `mcp-browser` row of `cordis.patch.yml`. If it is not installed, the other tools keep working.

#### Your own Chrome instead (`browserMode: "mine"`)

By default the assistant has its own browser, described below. If you would rather have it work in the Chrome you already use, with the sites you are signed in to there:

1. Install the [Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm) in your Chrome.
2. Put `"browserMode": "mine"` in `~/.dsh/personal-agent/config.json` and restart DSH.

Playwright MCP then starts with `--extension`. The first time the assistant uses the browser in a session, Chrome shows a page where you approve the connection and pick the tabs it may control; it can reach only those tabs and the ones it opens itself. There is no separate profile, so `browser_login` and the login keeping below are switched off. The assistant acts with your own logins in this mode: it asks before submitting, paying, posting, deleting or sending, never types passwords, names the file and source before a download, and does not open what it downloads. To skip the approval page on every connection, click the extension's icon, copy the `PLAYWRIGHT_MCP_EXTENSION_TOKEN` value from its Manage clients page, and put it in the settings file as `"browserExtensionToken": "..."` (then restart DSH). The preset passes it to Playwright MCP as an environment variable. It is a local secret: anything that has it can open tabs in your Chrome without asking, so keep the settings file private (`chmod 600`) and rotate the token on that page if it leaks.

#### The assistant's own browser (default)

The browser runs **headless**, so no window opens while the assistant works. It uses its own profile in `~/.dsh/mcp/playwright/profile` and never sees your everyday Chrome logins.

When a site needs you to sign in (for example a two-step school login), the assistant closes the background browser and calls `browser_login`. That opens the same profile in a visible Chrome for Testing window. Sign in, quit that window with ⌘Q, and the background browser reuses the saved login from then on. Many school portals sign in with session cookies, which Chrome drops on its next start; when the window quits, the plugin turns the session cookies used there into cookies that last 30 days (in the assistant's profile only, logged in the action log). It remembers those sites and does this again whenever the background browser closes, since sites like Canvas replace their session cookie on every page. The site can still end the session on its side, and two-step login may ask again. You can also start this from **登录助手浏览器** at the bottom of the overview page. The profile path can be changed with `browserProfile` in the settings file.

To read pages the assistant links to without leaving DSH, set DSH's chat link preference to open links in the in-app sidebar. DSH's own sidebar browser is for you only: the model cannot see or control it.

## Tools

| Tool | What it does | Asks first? |
|---|---|---|
| `calendar_events`, `reminders_list`, `notes_search`, `notes_read`, `mail_accounts`, `mail_list`, `mail_read` | read | no |
| `calendar_create`, `reminders_create` | create an event / reminder (optionally repeating; shows conflicts) | **yes** (DSH card) |
| `calendar_delete` | delete an event, one occurrence, or this and later occurrences | **yes** (the event and how many occurrences go) |
| `reminders_update`, `calendar_update` | change or move a reminder / event, change its repeat rule or end a series early | **yes** (old and new values, and what drops off) |
| `task_create`, `task_update`, `task_list` | record and track tasks linked to reminders and emails | no |
| `todo_add` | add a to-do to the assistant list | no |
| `reminders_complete` | mark a reminder done | no for the assistant list, **yes** for others |
| `mail_draft`, `mail_reply_draft` | save a draft in Mail (never sends) | no |
| `notes_create` | new note in the assistant folder | no |
| `today_update` | change the 今日 note (`today.md`) | no |
| `journal_status`, `journal_write` | read / write the weekly journal | no |
| `bib_add` | append a paper to your BibTeX file | no |
| `arxiv_search` | search arXiv | no |
| `secret_list`, `secret_save`, `secret_get`, `secret_delete` | the password book: passwords, card and ID numbers you ask it to keep, in the macOS login keychain (service `io.github.alexz949.personal-agent`, visible in Keychain Access). Listing shows sites and usernames only | **yes** to save, use or delete, every time |
| `sensitive_confirm` | the card the assistant must get before typing a password, verification code, card or ID number, showing or saving a credential, or reading a site's cookies or storage; names what and where, never the value, and one yes covers one action | **yes** (that is its job) |
| `ask_computer` | hands screen work (reading a WeChat or QQ window, say) to a child on DSH's built-in `ptc` preset, which drives Mac apps through DSH's experimental Computer Use. Needs **Computer use** switched on under Plugins → More and macOS permissions for DSH Computer Use. The assistant asks you first, tells the child to read only (no typing, sending, paying or deleting), and shows what it found before recording anything | yes (in chat), plus DSH's own per-app consent |
| `notify` | macOS notification banner | no |
| `browser_login` | open the assistant browser's profile in a visible Chrome window for signing in | no |
| `browser_save_output` | copy a browser screenshot into the workspace's `files/` so it shows inline in the chat | no |

## Claude Code (optional)

`mcp/server.js` is a stdio MCP server that gives Claude Code the same Apple, notification, arXiv and BibTeX tools. Confirmation cards become MCP elicitations, or the host's permission prompt with `--confirm=permission`.

## How it plugs into DSH

- `cordis.patch.yml` adds the `personal` and `personal-research` agent presets and the client bundle.
- Host tools are ordinary DSH tool modules: `lib/apple.js`, `today.js`, `journal.js` and others.
- The client (`lib/client.js`) uses DSH's public client services where they exist: layout, workspaces, sessions, workspace files, right-sidebar tabs and the `shell.overlay` slot.
- A few internal pieces are used with fallbacks when they are missing:
  - Collapsing the left sidebar on older builds.
  - Sending a question straight into a conversation (`sessions.binding(...).session.prompt`).
  - Filling a conversation's draft.

  A future DSH release may change them.

## Development

```bash
npm run build   # writes lib/ and, on macOS, rebuilds the helper only when helper/ changed
npm test        # node --test; uses no network and none of your settings
```

## License

[MIT](LICENSE)
