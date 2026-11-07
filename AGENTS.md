# pi-claude-oauth-adapter (Dom's fork) — agent notes

- **What runs:** `~/.pi/agent/settings.json` installs this fork from GitHub **pinned by commit** (`git:github.com/dominic-codespoti/pi-claude-oauth-adapter@<sha>`), not from this checkout. A change goes live only after it is pushed, the pin is bumped, `pi update --extensions` runs, and pi-ui restarts. Keep the package listed before `pi-fork-compaction`.
- **Branches:** `fix/xml-system-prompt-sections` is the deployed branch; `upstream` is minzique/pi-claude-oauth-adapter. No upstream PR has been opened yet.
- **Why the fork exists:** upstream stripped AGENTS.md (`<project_context>`) along with Pi's `<docs>` block from Claude prompts. The fork strips only the docs block, detects the Pi 1.3+ docs section, and keeps cache-stable prompt bytes.
- **Check before committing:** `npm run check` (tsc + vitest, offline). `~/.pi/agent/tests/claude-adapter.test.ts` runs the installed adapter against the real SDK prompt (`npm test` in `~/.pi/agent`); run it after bumping the pin.
- Never print `~/.pi/agent/auth.json` or OAuth tokens. Quota and usage endpoints: vault `a. Agent/Ops/Pi-UI.md`. Package-order and pin history: `Ops/Tooling.md`.
