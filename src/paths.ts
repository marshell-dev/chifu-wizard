// Shared filesystem locations and the bundled skill content.
//
// The skill markdown is vendored into ../assets/SKILL.md and shipped inside the
// package (see package.json "files"), so the wizard is self-contained and works
// offline via `bunx chifu-wizard`. We resolve it relative to this module so it
// works no matter where bunx/npx unpacks the package.

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

// ── chifu CLI config (must match chifu-cli/src/api.ts exactly) ──────────────

// chifu stores its config under XDG_CONFIG_HOME / %APPDATA% / ~/.config, in a
// `chifu` subfolder. We mirror that resolution so `chifu login` and a wizard
// fallback write to the same place.
export function chifuConfigDir(): string {
  const base =
    process.env.XDG_CONFIG_HOME ||
    (process.platform === "win32" && process.env.APPDATA) ||
    join(homedir(), ".config");
  return join(base, "chifu");
}

export function chifuConfigPath(): string {
  return join(chifuConfigDir(), "config.json");
}

// ── agent locations ─────────────────────────────────────────────────────────

export const home = homedir();

export const claudeDir = join(home, ".claude");
export const claudeSkillDir = join(claudeDir, "skills", "chifu-dep-guard");
export const claudeSkillFile = join(claudeSkillDir, "SKILL.md");

export const cursorDir = join(home, ".cursor");
export const cursorRulesDir = join(cursorDir, "rules");
export const cursorRuleFile = join(cursorRulesDir, "chifu-dep-guard.mdc");

export const windsurfDir = join(home, ".codeium", "windsurf");
export const windsurfRuleFile = join(windsurfDir, "memories", "chifu-dep-guard.md");

// ── AGENTS.md-style targets (cross-agent standard) ──────────────────────────
// AGENTS.md is a shared convention read by Codex, OpenCode and others. We
// append a clearly delimited "## chifu" block to the tool's *global* agents
// file, detecting each tool by its config directory.

export const codexDir = join(home, ".codex");
export const codexAgentsFile = join(codexDir, "AGENTS.md");

// OpenCode has two known layouts in the wild; we detect either dir and write
// the AGENTS.md inside whichever exists (preferring the XDG-style config dir).
export const opencodeXdgDir = join(
  process.env.XDG_CONFIG_HOME || join(home, ".config"),
  "opencode",
);
export const opencodeDir = join(home, ".opencode");

// ── Gemini CLI ──────────────────────────────────────────────────────────────
// Gemini CLI reads GEMINI.md-style context/instruction files from ~/.gemini.
export const geminiDir = join(home, ".gemini");
export const geminiRuleFile = join(geminiDir, "GEMINI.md");

// ── Cline ─────────────────────────────────────────────────────────────────--
// Cline reads global rules from ~/.clinerules (a folder of markdown rule files).
export const clineRulesDir = join(home, ".clinerules");
export const clineRuleFile = join(clineRulesDir, "chifu-dep-guard.md");

// ── bundled skill content ────────────────────────────────────────────────────

let cachedSkill: string | null = null;

// The vendored skill markdown, read from the package's assets folder.
export function skillMarkdown(): string {
  if (cachedSkill !== null) return cachedSkill;
  const assetPath = join(here, "..", "assets", "SKILL.md");
  cachedSkill = readFileSync(assetPath, "utf8");
  return cachedSkill;
}
