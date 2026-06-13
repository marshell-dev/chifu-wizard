// skills.sh (https://www.skills.sh) — the cross-agent skills registry. A single
// `skills` command detects every coding agent the user has installed
// (Claude Code, Cursor, Codex, Copilot, Windsurf, Gemini, Cline, and ~15 more)
// and writes the skill into each in its native format. That's strictly broader
// than our hand-rolled per-agent adapters, so the wizard prefers it and only
// falls back to the bundled adapters when skills.sh can't run.
//
// The chifu skill lives in its own public repo (marshell-dev/chifu-skill) with a
// valid SKILL.md at the root, which is all skills.sh needs — no separate publish
// step; the registry indexes a repo the first time someone installs it.
//
// Install vs update:
//   - Fresh install  → `skills add <repo> --global --yes`
//     Writes the skill into every detected agent.
//   - Update run     → `skills update chifu-dep-guard --global --yes`
//     Pulls the latest SKILL.md from GitHub and overwrites every agent's copy.
//     `add` skips agents that already have the skill; `update` force-refreshes them.

import { run, onPath } from "../exec.ts";

// The public repo skills.sh resolves the skill from.
export const SKILLS_SH_REPO = "marshell-dev/chifu-skill";
// The skill name as known to skills.sh (matches the `name:` in SKILL.md).
export const SKILLS_SH_NAME = "chifu-dep-guard";

// First-run `npx skills` may download the CLI before installing; give it room
// but never let it hang the wizard.
const INSTALL_TIMEOUT_MS = 120_000;

export interface SkillsShResult {
  ok: boolean;
  // The exact command we ran (surfaced in messaging / --json transparency).
  command: string;
  // A short tail of stderr/stdout when it failed, for diagnostics.
  detail?: string;
}

// Opt out with CHIFU_NO_SKILLS_SH=1 to force the per-agent adapter fallback.
export function skillsShDisabled(): boolean {
  const v = process.env.CHIFU_NO_SKILLS_SH;
  return v != null && /^(1|true|yes|on)$/i.test(v.trim());
}

// Install the chifu skill into every detected agent via skills.sh. Synchronous +
// best-effort: never throws, returns ok=false so the caller can fall back.
//   npx --yes skills add marshell-dev/chifu-skill --global --yes
//     --yes (npx)      : don't prompt before fetching the `skills` package
//     add <repo>       : install the skill from that GitHub repo
//     --global         : write to the user-level agent dirs (~/.claude/… etc.),
//                        matching how this wizard installs everything else
//     --yes (skills)   : install into all detected agents without prompting
export function installViaSkillsSh(): SkillsShResult {
  const args = ["--yes", "skills", "add", SKILLS_SH_REPO, "--global", "--yes"];
  const command = `npx ${args.join(" ")}`;

  // `npx` ships with npm; without a node/npx runtime we can't reach skills.sh.
  if (!onPath("npx")) {
    return { ok: false, command, detail: "npx not found on PATH" };
  }

  const r = run("npx", args, { capture: true, timeout: INSTALL_TIMEOUT_MS });
  if (r.ok) return { ok: true, command };

  const detail =
    (r.stderr || r.stdout || `exited with code ${r.code ?? "unknown"}`)
      .trim()
      .split("\n")
      .slice(-3)
      .join(" ")
      .slice(0, 300) || "unknown error";
  return { ok: false, command, detail };
}

// Update the chifu skill across every agent that already has it via skills.sh.
// Uses `skills update` instead of `skills add` — `add` skips agents where the
// skill is already present, while `update` force-fetches the latest SKILL.md
// from GitHub and overwrites every agent's copy.
//   npx --yes skills update chifu-dep-guard --global --yes
export function updateViaSkillsSh(): SkillsShResult {
  const args = ["--yes", "skills", "update", SKILLS_SH_NAME, "--global", "--yes"];
  const command = `npx ${args.join(" ")}`;

  if (!onPath("npx")) {
    return { ok: false, command, detail: "npx not found on PATH" };
  }

  const r = run("npx", args, { capture: true, timeout: INSTALL_TIMEOUT_MS });
  if (r.ok) return { ok: true, command };

  // `update` can fail if the skill was never installed via skills.sh (e.g. the
  // user used the wizard's built-in adapters). Fall back to `add` so the caller
  // gets a single unified result and doesn't need two code paths.
  const addArgs = ["--yes", "skills", "add", SKILLS_SH_REPO, "--global", "--yes"];
  const addR = run("npx", addArgs, { capture: true, timeout: INSTALL_TIMEOUT_MS });
  if (addR.ok) return { ok: true, command: `npx ${addArgs.join(" ")} (update fell back to add)` };

  const detail =
    (r.stderr || r.stdout || `exited with code ${r.code ?? "unknown"}`)
      .trim()
      .split("\n")
      .slice(-3)
      .join(" ")
      .slice(0, 300) || "unknown error";
  return { ok: false, command, detail };
}
