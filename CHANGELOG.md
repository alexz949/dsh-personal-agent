# Changelog

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
