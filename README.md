# chifu-wizard

One-command setup for [chifu](https://marshell.dev) — the dependency-security
layer for AI coding agents. The wizard installs the `chifu` CLI, teaches your
coding agent (Claude Code, Cursor, Windsurf) to check changed dependencies for
known CVEs and fix them, and optionally saves your API key.

## Quick start

You don't need Bun first — the bootstrap scripts install it for you.

**macOS / Linux**

```sh
curl -fsSL https://marshell.dev/install.sh | sh
```

**Windows (PowerShell)**

```powershell
irm https://marshell.dev/install.ps1 | iex
```

Already have Bun (or Node)? Run the wizard directly:

```sh
bunx @marshell/chifu-wizard
# or
npx @marshell/chifu-wizard
```

## What it does

1. **Installs the chifu CLI.** Detects whether `chifu` is on your PATH; if not,
   installs it globally with `npm i -g @marshell/chifu` (falling back to `bun add -g
   chifu`) and tells you which one it used. The CLI also works via `bunx @marshell/chifu`
   with no global install, so this step is optional.
2. **Wires up your AI coding agents.** For each agent it finds:
   - **Claude Code** (`~/.claude` or `claude` on PATH) → installs the skill at
     `~/.claude/skills/chifu-dep-guard/SKILL.md`.
   - **Cursor** (`~/.cursor`) → writes a rule at
     `~/.cursor/rules/chifu-dep-guard.mdc` that points the agent at the chifu
     CLI.
   - **Windsurf** (best-effort, optional) → writes a rule under
     `~/.codeium/windsurf/`.
3. **Saves an optional API key.** Paste a `chf_…` key to sync scan results to
   your dashboard, or skip it — `chifu check` works fully anonymously.
4. **Sets an optional custom backend URL** (defaults to
   `https://api.marshell.dev`).
5. **Prints a short how-to.**

The chifu skill is bundled with the wizard (`assets/SKILL.md`), so it works
offline and is fully self-contained.

## Using it after setup

Open your AI coding agent in a project, add or upgrade a dependency, and ask it
to check your dependencies for vulnerabilities. The agent runs `chifu check
--json`, reads the findings, upgrades the vulnerable packages, and handles any
breaking changes — before you merge.

You can also run it yourself anytime:

```sh
chifu check                 # human-readable report for the current project
chifu check --json          # machine-readable (what the agent uses)
chifu check --fail-on-findings   # non-zero exit for CI gates
```

## Non-interactive / CI

Every prompt has a flag so the wizard can run unattended:

```sh
bunx @marshell/chifu-wizard --yes
```

| Flag | Effect |
|---|---|
| `-y`, `--yes` | Accept all defaults, no prompts |
| `--no-interactive`, `--ci` | Same as `--yes` |
| `--skip-cli` | Don't install the chifu CLI |
| `--skip-agents` | Don't touch any agent config |
| `--api-key <key>` | Save this `chf_…` key (also reads `CHIFU_API_KEY`) |
| `--api-url <url>` | Use a custom backend (also reads `CHIFU_API_URL`) |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show the version |

In a piped install one-liner, forward args after `-s --`:

```sh
curl -fsSL https://marshell.dev/install.sh | sh -s -- --yes
```

On Windows, set `$ChifuWizardArgs` before piping:

```powershell
$ChifuWizardArgs = '--yes'; irm https://marshell.dev/install.ps1 | iex
```

## Where things get written

| What | Location |
|---|---|
| chifu config / API key | `~/.config/chifu/config.json` (or `%APPDATA%\chifu` on Windows), mode `600` |
| Claude Code skill | `~/.claude/skills/chifu-dep-guard/SKILL.md` |
| Cursor rule | `~/.cursor/rules/chifu-dep-guard.mdc` |
| Windsurf rule | `~/.codeium/windsurf/memories/chifu-dep-guard.md` |

## License

MIT © Marshell
