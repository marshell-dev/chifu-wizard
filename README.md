# chifu-wizard

The installer for **[chifu](https://marshell.dev)** — the dependency-security
layer for AI coding agents. One command installs the `chifu` CLI, teaches your
coding agent to check changed dependencies for known CVEs (and fix them), and
signs you in so your checks sync to your dashboard. CLI + agent skill, no MCP.

## Install

**macOS / Linux**

```sh
curl -fsSL https://marshell.dev/install.sh | sh
```

**Windows (PowerShell)**

```powershell
irm https://marshell.dev/install.ps1 | iex
```

The one-liners install Bun if it's missing, then run the wizard. Already have
Bun or Node? Skip the bootstrap and run the wizard directly:

```sh
bunx @marshell/chifu-wizard
# or
npx @marshell/chifu-wizard
```

Pass a key up front to skip the prompt:

```sh
bunx @marshell/chifu-wizard --api-key chf_xxx
```

## What it does

1. **Installs the chifu CLI.** If `chifu` isn't on your PATH, installs it
   globally (`npm i -g @marshell/chifu`, falling back to `bun add -g`). The CLI
   also runs via `bunx @marshell/chifu` with no global install, so this step is
   optional.
2. **Wires up every AI coding agent it detects.** For each one it translates the
   bundled skill (`assets/SKILL.md`) into that agent's native instruction format
   and drops it in the right place. See [Supported agents](#supported-agents).
3. **Signs you in** (browser pairing) so your checks sync to your dashboard.
   chifu needs an account — `chifu check` won't run until you've signed in.
4. **Sets an optional custom backend URL** (defaults to `https://api.marshell.dev`).
5. **Prints a short how-to.**

The skill is bundled with the wizard, so it works offline and is fully
self-contained.

## Options

| Flag | Effect |
|---|---|
| `-y`, `--yes` | Accept all defaults, no prompts (interactive-safe) |
| `--ci` | Non-interactive defaults (alias of `--no-interactive`) |
| `--no-interactive` | Same as `--ci` |
| `--json` | Print a machine-readable JSON result of what was installed |
| `--agent` | Print an onboarding prompt for an external coding agent and exit (no side effects) |
| `--all-agents` | Install into every detected agent without per-agent prompts |
| `--target <name>` | Only install into these agents — repeatable or comma-separated (`claude`, `cursor`, `windsurf`, `codex`, `opencode`, `gemini`, `cline`) |
| `--skip-cli` | Don't install the chifu CLI |
| `--skip-agents` | Don't touch any agent config |
| `--api-key <key>` | Save this `chf_…` key (also reads `CHIFU_API_KEY`) |
| `--api-url <url>` | Use a custom backend (also reads `CHIFU_API_URL`) |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show the version |

Forward args through the piped one-liners:

```sh
curl -fsSL https://marshell.dev/install.sh | sh -s -- --yes --all-agents
```

```powershell
$ChifuWizardArgs = '--yes --all-agents'; irm https://marshell.dev/install.ps1 | iex
```

## Authentication

chifu requires an account — `chifu check` needs a `chf_` key. Get one two ways:

- **Browser device-pairing (recommended).** Run `chifu login`; it opens a
  pairing URL/code you confirm in the browser, then writes the key to your local
  config. No copy-pasting secrets.
- **Manual key.** Copy a key from the dashboard
  ([marshell.dev](https://marshell.dev)) and either pass it to the wizard
  (`--api-key chf_…`), set `CHIFU_API_KEY`, or run `chifu login chf_…`.

Keys are stored at `~/.config/chifu/config.json` (or `%APPDATA%\chifu` on
Windows) with mode `600`.

## Supported agents

The wizard detects each agent by its config directory (or binary on PATH) and
writes the skill in that agent's native format. Adapters are independent — one
failing never blocks the others. Formats marked *best-effort* follow the most
reasonable convention for that tool; adjust to taste.

| Agent | Detected via | Format | Location |
|---|---|---|---|
| Claude Code | `~/.claude` / `claude` on PATH | skill | `~/.claude/skills/chifu-dep-guard/SKILL.md` |
| Cursor | `~/.cursor` | `.mdc` project rule | `~/.cursor/rules/chifu-dep-guard.mdc` |
| Windsurf | `~/.codeium/windsurf` | markdown rule *(best-effort)* | `~/.codeium/windsurf/memories/chifu-dep-guard.md` |
| Codex | `~/.codex` / `codex` on PATH | `AGENTS.md` block *(best-effort)* | `~/.codex/AGENTS.md` |
| OpenCode | `~/.config/opencode` or `~/.opencode` | `AGENTS.md` block *(best-effort)* | `…/opencode/AGENTS.md` |
| Gemini CLI | `~/.gemini` / `gemini` on PATH | `GEMINI.md` block *(best-effort)* | `~/.gemini/GEMINI.md` |
| Cline | `~/.clinerules` | rule file *(best-effort)* | `~/.clinerules/chifu-dep-guard.md` |

`AGENTS.md` / `GEMINI.md` writes are **idempotent**: the wizard inserts a
clearly delimited `## chifu` block (between `<!-- chifu:begin -->` and
`<!-- chifu:end -->`) and replaces just that block on re-run, leaving the rest
of your file untouched.

Use `--target` to pick specific agents or `--all-agents` to install into every
detected one:

```sh
bunx @marshell/chifu-wizard --target claude,codex
bunx @marshell/chifu-wizard --all-agents --yes
```

## How it works

chifu is a CLI plus an agent skill — there is no MCP server to run.

- **The CLI does detection.** `chifu check --json` resolves the project's
  dependency tree and matches it against known CVEs, then prints the actionable
  upgrades (one entry per vulnerable package, collapsed to the single version
  that clears all of its CVEs) plus the per-advisory detail.
- **The agent does the fixing.** The installed skill tells your agent *when* to
  run chifu (any time it adds, upgrades, or changes a dependency, and before
  finishing a task) and *how* to act on the output — upgrade to the recommended
  version, handle breaking changes from the advisory, re-check, then report.
- **The wizard wires the two together** so your agent reaches for chifu
  automatically instead of guessing whether a dependency is safe.

After setup, open your agent in a project, add or upgrade a dependency, and ask
it to check your dependencies for vulnerabilities. Or run it yourself:

```sh
chifu check                      # human-readable report for the current project
chifu check --json               # machine-readable (what the agent uses)
chifu check --fail-on-findings   # non-zero exit for CI gates
```

### Onboarding an agent without the wizard

`chifu-wizard --agent` prints a self-contained prompt (no side effects) that you
can paste into any coding agent to have it set chifu up itself — detect a
runtime, install the CLI, authenticate, confirm `chifu check` works, and install
the skill:

```sh
bunx @marshell/chifu-wizard --agent
```

## License

MIT © Marshell
