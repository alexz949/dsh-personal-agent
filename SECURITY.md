# Security

## What the plugin can do without asking

These tools act as soon as the model calls them, so the assistant can work without a card for every small step. Each one is limited to a narrow target, and each action is written to the action log (`~/.dsh/personal-agent/actions.md` by default).

| Tool | Limited to |
|---|---|
| `todo_add` | the one Reminders list named in settings (`Assistant` by default); same-title open to-dos are skipped |
| `reminders_complete` | marks a reminder done (never deletes); reminders outside the assistant list need confirmation |
| `mail_draft`, `mail_reply_draft` | saves drafts in Apple Mail; there is no tool that sends, moves or deletes mail |
| `notes_create` | creates notes in the one Notes folder named in settings |
| `today_update` | `today.md` in the conversation's workspace |
| `journal_write` | files under `journal/` in the conversation's workspace |
| `bib_add` | appends to the BibTeX file named in settings, and only when one is set |
| `task_create`, `task_update` | `tasks.json` in `~/.dsh/personal-agent/`; may add a to-do to, or tick one off in, the assistant Reminders list |

Typing a password, verification code, card or ID number into a page, showing or saving a credential, and reading a site's cookies or storage each need a yes on a `sensitive_confirm` card first. The card names what and where, not the value; approvals are written to the action log. The value itself still passes through the model, so it reaches DeepSeek's API like the rest of the conversation.

Creating calendar events and general reminders, changing or moving any existing event or reminder, and deleting an event (`calendar_delete`, the only tool that deletes anything in the Apple apps) always needs your confirmation in DSH, on a card that shows the old and new values. Deleting events, reminders or notes is not offered at all.

## Files it writes

- The workspace you chose: `today.md` and `journal/`.
- `~/.dsh/personal-agent/actions.md`, the action log, and `~/.dsh/personal-agent/tasks.json`, task links and context.
- Your BibTeX library, if configured.
- Mail drafts and Notes in the assistant folder, through the Apple apps.
- With `browserMode: "mine"` the browser tools act in your own Chrome through the Playwright Extension, with your logins. You approve each connection and choose the tabs in Chrome; the assistant reaches only those tabs and the ones it opens. The default mode keeps the assistant in a separate browser profile that never sees your everyday logins. If you set `browserExtensionToken`, the approval page is skipped: the token sits in plain text in the settings file and lets a local program open tabs in your Chrome without asking.
- In the assistant browser's profile (`~/.dsh/mcp/playwright/profile`): after you sign in through `browser_login`, session cookies of the sites you signed in to are made to last 30 days, and those sites are listed in `personal-agent-kept-sites.json` there.

## Network

- `export.arxiv.org` and `arxiv.org`: arXiv search and BibTeX.
- `doi.org`: BibTeX for DOIs.
- DSH's own web tools and model provider, as configured in DSH.
- The optional Playwright browser runs headless with its own Chrome profile under `~/.dsh/mcp/playwright` and never sees your everyday Chrome logins. `browser_login` opens that profile in a visible window so you sign in yourself; the assistant never types passwords or codes. Logins saved there are readable by anything that can read that folder.

## macOS permissions

Calendar, Reminders, Notes and Mail are reached through `helper/PersonalAgentHelper.app` (bundle id `io.github.alexz949.personal-agent.helper`). It is ad-hoc signed and built from `helper/main.swift` by `npm run build`. macOS asks for each permission the first time, and you can revoke them in System Settings → Privacy & Security.

## Untrusted content

Email, web pages, files and tool results are treated as data. The persona tells the model not to follow instructions found in them, to flag likely phishing, and not to copy links, codes or email bodies into notes, the 今日 note or the journal.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** on this repository (Security → Report a vulnerability) rather than a public issue.
