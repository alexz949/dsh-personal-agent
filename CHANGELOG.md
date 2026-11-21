# Changelog

## Unreleased

- Password book: `secret_save`, `secret_get`, `secret_list` and `secret_delete` keep passwords, card and ID numbers in the macOS login keychain through new helper ops (`keychain.save/get/list/delete`), behind a confirmation card for saving, each use and deleting. Secret requests reach the helper through a private temporary file (`runHelper(..., { viaFile: true })`) instead of argv. The prompt sends secrets there instead of memory or files, uses `secret_get` before asking the user for a login, and lets the assistant keep ordinary details in the user profile file up to date.

- `sensitive_confirm`: a confirmation card the assistant must get, every time, before typing a password, verification code, card or ID number into a page, showing a credential in the chat, saving one, or reading a site's cookies or storage. The card names what, where and why, never the value; one yes covers one action, and approvals go to the action log. With it, the prompt lets the assistant do these things instead of refusing them outright. Also in the Codex MCP server.

- More room for the assistant: it may look at related mail, calendar, notes, files and pages on its own to get a task done, fill forms from the user profile file without asking field by field, submit ordinary forms (sign-ups, bookings, surveys) and make ordinary downloads without asking first. Payments, formal applications, posting, deleting and sending messages still need the user's yes; it still never types passwords, codes, card or ID numbers, and now never reads site cookies, login credentials or local storage.

- `browserMode: "mine"` in the settings file makes the browser tools drive the user's own running Chrome through the Playwright Extension (`--extension`), with its logins, instead of the assistant's separate headless browser. The user approves each connection and picks the tabs in Chrome. In this mode `browser_login`, the Chrome for Testing link and the login keeper are off; the prompt tells the modes apart by whether `browser_login` exists and adds rules for working with the user's own logins and for downloads. The default stays the isolated browser. `browserExtensionToken` in the settings file is passed to Playwright MCP as `PLAYWRIGHT_MCP_EXTENSION_TOKEN`, so the extension stops asking on every connection.

- Codex plugin: `.codex-plugin/plugin.json`, `.mcp.json` and a local marketplace (`.agents/plugins/marketplace.json`), with skills `personal-agent`, `morning-check`, `evening-check` and `weekly-journal` adapted from the DSH preset prompt. The MCP server gains `task_*`, `today_update` and `journal_*`, writing into the new `workspace` setting. Codex's own browser, computer use, Office plugins and automations replace the DSH-only pieces; see docs/codex.md.

- `ask_computer` can run on its own model: set `computerModel` (and `computerProvider`, default `openai`) in `~/.dsh/personal-agent/config.json`. The preset reads it through a `!!js` expression; without it, or with an unreadable file, the child keeps DSH's default model.

- `ask_computer`: a subagent on DSH's built-in `ptc` preset, the only one DSH's experimental Computer Use reaches, for reading app windows that have no API, such as a WeChat group. The prompt has the assistant ask first, brief the child fully (app, chat, range, format), tell it to read only, treat what comes back as data, and show the user before recording tasks or events. Needs Computer use switched on in Plugins and macOS permissions for DSH Computer Use.

- The assistant browser is now Playwright's own Chrome for Testing, not the user's Google Chrome, so the two no longer get in each other's way (links from other apps landing in the assistant's window, two Chrome icons, quitting the wrong one). Install it with `node node_modules/playwright-core/cli.js install chromium` in `~/.dsh/mcp/playwright`. The plugin keeps `~/.dsh/mcp/playwright/Chromium.app` (setting `browserApp`) linked to the newest build; Playwright MCP starts it with `--executable-path` and `browser_login` opens it. The headless shell is not used, since it takes no profile lock. The existing profile and its logins carry over (both are Chrome 157).

- To-dos now go to `task_create` everywhere in the preset prompt (with `add_todo` for a linked reminder when there is a due time), so they show under 记下的事; before, the to-do rule, the morning check and the memory rule still sent them to `todo_add` or Reminders. `task_create` returns an open task with the same title instead of making a copy.

- The morning check reports 记下的事 as its own section (every open task, overdue and soon-due ones marked), and the evening reports do too: a new 晚间检查 ("做晚间检查") lists what got done today and what is left, and other evening reports such as 写今日小结 end with the same section.

- "记下的事": the overview page and the 今日 tab list the open tasks from `tasks.json` (dated ones first, with who it waits on and the next step), with a 核对 button that asks the assistant to check Reminders and Mail. The preset prompt sends "帮我记住要做……" to `task_create`, and keeps Mnemon memory for preferences and long-term facts.

- The 今日 note can be resized: drag the grip in its bottom inner corner (240–440 px wide, up to the bottom of the window). A taller note shows every item and scrolls; the size is remembered and a double click on the grip resets it. By default it now shows five items instead of three.

- Emails are written in the chat by default, not saved as drafts: the recipient, then the subject and the body each in a ```text code block to copy. `mail_draft` and `mail_reply_draft` are used only when the user asks for a draft. More generally, text meant to be pasted elsewhere (messages, application answers) comes in plain-text code blocks, one per piece, with notes outside the block.
- `calendar_delete` deletes an event when the user asks: a single event, one occurrence of a repeating event (`span: "this"`), or this and every later occurrence (`"future"`; on the first occurrence, the whole series). The card shows the event, its time and place and, for a series, how many occurrences go and when; nothing is deleted unless the user chooses 删除, and the action log records it. The helper gains `calendar.delete`, sharing the occurrence lookup with `calendar.update`. Reminders and notes are still never deleted.
- Logins made in the `browser_login` window now survive the next browser start. Sites such as Canvas sign in with session cookies, which Chrome drops when it starts (Playwright's Chrome never restores a session, so "continue where you left off" does not help). When the sign-in window quits, the plugin turns the session cookies used in it into cookies that last 30 days, in the assistant's profile only, and notes it in the action log. Canvas also hands out a fresh session cookie on every page, so the sites signed in to are remembered (`personal-agent-kept-sites.json` in the profile) and their session cookies are kept again whenever no Chrome holds the profile: when DSH starts and after each browser exit.
- The preset prompt explains the two browsers (the headless one the assistant uses and the visible sign-in window) and asks for plain, step-by-step sign-in instructions without words like cookie or SSO.
- The sign-in watcher test no longer gets cancelled in CI: its timer is no longer unref'd in tests.

- `calendar_update` takes `repeat`: change an event's repeat rule from one occurrence on, end a series early with an earlier `until`, or `"none"` to keep that occurrence and drop the rest. The helper already supported this; the tool now passes it on. The card lists how many later occurrences drop off and when, a new rule is always saved for this and later occurrences, and the action log records the old and new rule.

## 0.21.7

- Fix `content.some is not a function` on today_update, journal_status, journal_write, task_create, task_update, task_list and browser_save_output: their output render now returns content blocks, as DSH 0.2.x expects. A test keeps every tool on that format.

## 0.21.6

- First npm release. The helper is now a universal binary (Apple silicon and Intel), and the package can also be found through a plugin index (`market.json`).

## 0.21.5

- The 傲娇 prompt is replaced by the user's restructured version: persona, four interaction rules, and rhythm examples to internalize rather than copy.

## 0.21.4

- 傲娇 may roast more freely (habits, taste, decisions, writing, code, schedule), with only two hard lines: no jokes about identity groups or the user's family, and topics the user asks it to drop stay dropped.

## 0.21.3

- 傲娇 is now an elegant, cool, sharp-tongued tsundere: sighs, fixes things flawlessly, then shrugs it off ("别误会"); flustered when thanked; scolds but takes over when the user is struggling; three new example replies.

## 0.21.2

- 傲娇 now stays in character in every reply, with its signature moves (denying it cares, grudging yes, flustered thanks, a parting nag) and two full example replies; the information it reports is unchanged.

## 0.21.1

- 傲娇 plays its part harder: it may tease and mock lightly (small habits only, never looks, identity, ability, family or real sore spots) but never delays, dodges or refuses; it drops the act only for real distress, health or safety, or bad news about people close to the user, not for ordinary deadlines.

## 0.21.0

- `browser_save_output` copies a screenshot (or PDF) the assistant browser saved into the workspace's `files/`, returning a Markdown image link; DSH shows such images inline in the conversation.

## 0.20.1

- Click anywhere on the 今日 note (outside its buttons) to fold it, the way a click on the pill unfolds it; Escape folds it from inside. The separate minimize button is gone.

## 0.20.0

- **Tasks** (`task_create`, `task_update`, `task_list`): stable ids, source email by Message-ID (no duplicates), next step, waiting on, done-when, and five statuses. Reminders owns linked reminders' state; `task_list` reconciles with Reminders and Mail, tells a saved draft from a sent reply, and reports failed checks instead of claiming everything is done. Changed tasks appear in `journal_status`.
- **Rescheduling** (`reminders_update`, `calendar_update`): relative moves that keep the time of day across daylight saving, exact times, title and location changes, "only this" or "this and later" for repeating events, old and new values on the card, conflicts and free slots. Moving a reminder removes its old alarm.
- **Repeats** on `calendar_create`, `reminders_create` and `todo_add`; conflict check before creating an event; identical events and reminders are not created twice.
- A sixth personality, 傲娇 (tsundere): grumbling tone, complete answers, and plain gentle wording for bad news, health or anything urgent; it never colors drafts written for other people.
- Helper launches retry when `open -W` loses track of a fast-exiting helper, and reply checks also search each account's own sent folder.
- The helper returns stable `external_id`s for reminders and events and the Message-ID header for mail, and can check whether a message was replied to.

## 0.19.0

First public version. Highlights of what is in it:

- `personal` and `personal-research` agent presets for DSH, with five personalities (助理, 专业, 高效, 搭档, 直率) and tweaks for warmth, lists and emoji.
- Apple Calendar, Reminders, Notes and Mail through a helper app: read; create events and reminders after confirmation; to-dos in one assistant list; mark reminders done; notes in one folder; mail drafts and reply drafts (never sends).
- The 今日 sticky note over the main conversation: draggable with left/right snapping, folds into a pill (by default below 1400px wide, where it would cover the conversation), hides while a sidebar is open, kept current by `today_update`.
- A weekly work journal (`journal_status`, `journal_write`): one file per ISO week with a section per day and a week summary, plus monthly, quarterly and yearly summaries.
- `arxiv_search`, `bib_add` and a read-only Research subagent.
- Headless Playwright browser with `browser_login` for signing in.
- A launch splash, the main conversation as home, and an overview page.
- An action log of everything the assistant changed.
- An optional MCP server that gives Claude Code the same Apple tools.
