// Step 2 — detect installed AI coding agents and teach each one about chifu.
//
//   Claude Code  → drop the skill at ~/.claude/skills/chifu-dep-guard/SKILL.md
//   Cursor       → write a rule (.mdc) pointing the agent at the chifu CLI
//   Windsurf     → best-effort rule/memory file
//
// Detection is by the agent's home directory (or its binary on PATH). Each
// install is independent and best-effort: a failure for one agent never aborts
// the others or the wizard.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { onPath } from "../exec.ts";
import { log, c, type Prompter } from "../ui.ts";
import {
  claudeDir,
  claudeSkillDir,
  claudeSkillFile,
  cursorDir,
  cursorRuleFile,
  windsurfDir,
  windsurfRuleFile,
  skillMarkdown,
} from "../paths.ts";

export interface AgentResult {
  claude: boolean;
  cursor: boolean;
  windsurf: boolean;
  any: boolean;
}

function writeFileEnsuringDir(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

// Cursor consumes "rules", not skills. We translate the skill into a Project
// Rule (.mdc) with frontmatter so Cursor can auto-attach it. The body reuses
// the bundled skill content so behavior stays in sync with Claude Code.
function cursorRuleContent(): string {
  const body = skillMarkdown()
    // Strip the skill's own YAML frontmatter; we supply Cursor-flavored
    // frontmatter instead.
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .trim();
  return `---
description: chifu dep-guard — check changed dependencies for known CVEs and fix them.
alwaysApply: false
---

# chifu dep-guard (Cursor rule)

Apply this whenever you add, install, upgrade, pin, or change a dependency
(editing package.json, running npm/bun/yarn install), and before finishing a
task that touched dependencies. Run \`chifu check --json\` (or \`bunx chifu check
--json\` if the CLI isn't installed) and fix what it reports.

${body}
`;
}

// Windsurf reads markdown "rules"/memories. Reuse the skill body verbatim.
function windsurfRuleContent(): string {
  return skillMarkdown();
}

export async function installAgents(
  prompt: Prompter,
  assumeYes: boolean,
): Promise<AgentResult> {
  log.step("AI coding agents");

  const result: AgentResult = {
    claude: false,
    cursor: false,
    windsurf: false,
    any: false,
  };

  // ── Claude Code ───────────────────────────────────────────────────────────
  const hasClaude = existsSync(claudeDir) || onPath("claude");
  if (hasClaude) {
    const go =
      assumeYes ||
      (await prompt.confirm("Claude Code detected — install the chifu skill?", true));
    if (go) {
      try {
        mkdirSync(claudeSkillDir, { recursive: true });
        writeFileSync(claudeSkillFile, skillMarkdown(), "utf8");
        log.ok(`Claude Code: skill installed → ${c.dim(claudeSkillFile)}`);
        result.claude = true;
      } catch (err) {
        log.fail(`Claude Code: couldn't write skill (${(err as Error).message})`);
      }
    } else {
      log.skip("Claude Code: skipped");
    }
  } else {
    log.skip("Claude Code: not detected (no ~/.claude, `claude` not on PATH)");
  }

  // ── Cursor ────────────────────────────────────────────────────────────────
  const hasCursor = existsSync(cursorDir) || onPath("cursor");
  if (hasCursor) {
    const go =
      assumeYes ||
      (await prompt.confirm("Cursor detected — add the chifu rule?", true));
    if (go) {
      try {
        writeFileEnsuringDir(cursorRuleFile, cursorRuleContent());
        log.ok(`Cursor: rule installed → ${c.dim(cursorRuleFile)}`);
        result.cursor = true;
      } catch (err) {
        log.fail(`Cursor: couldn't write rule (${(err as Error).message})`);
      }
    } else {
      log.skip("Cursor: skipped");
    }
  } else {
    log.skip("Cursor: not detected (no ~/.cursor)");
  }

  // ── Windsurf (best-effort, clearly optional) ────────────────────────────────
  const hasWindsurf = existsSync(windsurfDir) || onPath("windsurf");
  if (hasWindsurf) {
    const go =
      assumeYes ||
      (await prompt.confirm("Windsurf detected — add the chifu rule? (optional)", true));
    if (go) {
      try {
        writeFileEnsuringDir(windsurfRuleFile, windsurfRuleContent());
        log.ok(`Windsurf: rule installed → ${c.dim(windsurfRuleFile)}`);
        result.windsurf = true;
      } catch (err) {
        log.fail(`Windsurf: couldn't write rule (${(err as Error).message})`);
      }
    } else {
      log.skip("Windsurf: skipped");
    }
  } else {
    log.skip("Windsurf: not detected (optional)");
  }

  result.any = result.claude || result.cursor || result.windsurf;

  if (!hasClaude && !hasCursor && !hasWindsurf) {
    log.warn(
      "No supported AI coding agent detected. The chifu CLI still works on its " +
        "own — install Claude Code or Cursor and re-run this wizard to wire it up.",
    );
  }

  return result;
}
