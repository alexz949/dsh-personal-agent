# Personal Agent workspace template

Folder layout and starting instructions for the DSH Personal Agent plugin: a Life assistant as the entry point, with School, PhD-application and Research areas it reads, and a read-only Research subagent.

```
agents/life/       open DSH here; AGENTS.md says who you are and how you work
agents/school/     coursework rules and notes
agents/phd/        application rules, deadlines, advisors, materials
agents/research/   watchlist and paper rubric for the Research subagent
shared/USER_PROFILE.md   your background, read by every assistant
scripts/           state.py (shared task store), scholar.py (Google Scholar compare, read-only)
```

1. Copy this folder somewhere private; your notes and profile never belong in a public repository.
2. Fill in `shared/USER_PROFILE.md` and the "This user's setup" section of `agents/life/AGENTS.md`.
3. In DSH, add `agents/life` as a workspace and pick it on the Personal home.

Run `python3 -m unittest discover -s tests` to check the scripts. Nothing here needs network access or keys.
