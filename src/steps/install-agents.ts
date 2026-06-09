// Step 2 — detect installed AI coding agents and teach each one about chifu.
//
// Each supported agent is modeled as a small, independent *adapter*: it knows
// how to detect itself (by config directory or binary on PATH), where its
// instruction file lives, and how to render the bundled skill (assets/SKILL.md)
// into that agent's native format. Every adapter is best-effort — a failure for
// one agent never aborts the others or the wizard.
//
// Supported targets:
//   claude    Claude Code → ~/.claude/skills/chifu-dep-guard/SKILL.md (skill)
//   cursor    Cursor      → ~/.cursor/rules/chifu-dep-guard.mdc (.mdc rule)
//   windsurf  Windsurf    → ~/.codeium/windsurf/memories/… (markdown rule)
//   codex     Codex       → ~/.codex/AGENTS.md (delimited "## chifu" block)
//   opencode  OpenCode    → ~/.config/opencode/AGENTS.md or ~/.opencode/AGENTS.md
//   gemini    Gemini CLI  → ~/.gemini/GEMINI.md (delimited block)
//   cline     Cline       → ~/.clinerules/chifu-dep-guard.md (rule file)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
  codexAgentsFile,
  opencodeXdgDir,
  opencodeDir,
  geminiRuleFile,
  clineRulesDir,
  clineRuleFile,
  skillMarkdown,
} from "../paths.ts";

// Canonical target names, also accepted by the --target flag.
export type AgentTarget =
  | "claude"
  | "cursor"
  | "windsurf"
  | "codex"
  | "opencode"
  | "gemini"
  | "cline";

export const ALL_TARGETS: AgentTarget[] = [
  "claude",
  "cursor",
  "windsurf",
  "codex",
  "opencode",
  "gemini",
  "cline",
];

// Per-agent install outcome (what the --json output and summary consume).
export interface AgentInstall {
  target: AgentTarget;
  label: string;
  detected: boolean;
  installed: boolean;
  // Absolute path written (when installed), else the path we'd have used.
  path: string | null;
  note?: string;
}

export interface AgentResult {
  installs: AgentInstall[];
  any: boolean;
  // Back-compat fields used by older callers / summaries.
  claude: boolean;
  cursor: boolean;
  windsurf: boolean;
}

export interface InstallAgentsOptions {
  assumeYes: boolean;
  // When set, only operate on these targets (from --target). Detection still
  // applies — an explicitly named-but-undetected target is reported, not forced.
  only?: AgentTarget[];
  // --all-agents: install into every detected target without per-agent prompts.
  all?: boolean;
}

// ── shared rendering helpers ────────────────────────────────────────────────

const BLOCK_BEGIN = "<!-- chifu:begin -->";
const BLOCK_END = "<!-- chifu:end -->";

function writeFileEnsuringDir(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

// The skill body with its own YAML frontmatter stripped — reused by adapters
// that supply their own header/frontmatter.
function skillBody(): string {
  return skillMarkdown()
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .trim();
}

// A short, agent-agnostic preamble prepended to rule/instruction formats so the
// agent knows when and how to reach for chifu even without skill auto-loading.
function rulePreamble(): string {
  return `Apply this whenever you add, install, upgrade, pin, or change a dependency
(editing package.json, running npm/bun/yarn install), and before finishing a
task that touched dependencies. Run \`chifu check --json\` (or
\`bunx @marshell/chifu@latest check --json\` if the CLI isn't installed) and fix what it
reports.`;
}

// Render a self-delimited "## chifu" block for AGENTS.md / GEMINI.md targets.
// The delimiters make re-runs idempotent: we replace the block in place rather
// than appending a duplicate.
function chifuMarkdownBlock(): string {
  return `${BLOCK_BEGIN}
## chifu — dependency security

${rulePreamble()}

${skillBody()}
${BLOCK_END}`;
}

// Insert-or-replace the chifu block in an existing markdown file's content.
// Preserves everything the user already had outside our delimiters.
function upsertBlock(existing: string, block: string): string {
  const begin = existing.indexOf(BLOCK_BEGIN);
  const end = existing.indexOf(BLOCK_END);
  if (begin !== -1 && end !== -1 && end > begin) {
    const before = existing.slice(0, begin);
    const after = existing.slice(end + BLOCK_END.length);
    return (before + block + after).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }
  const base = existing.trim();
  return (base ? base + "\n\n" : "") + block + "\n";
}

// Write the chifu block into an AGENTS.md/GEMINI.md-style file idempotently.
function upsertMarkdownFile(file: string): void {
  let existing = "";
  try {
    existing = readFileSync(file, "utf8");
  } catch {
    existing = "";
  }
  writeFileEnsuringDir(file, upsertBlock(existing, chifuMarkdownBlock()));
}

// ── adapter model ───────────────────────────────────────────────────────────

interface Adapter {
  target: AgentTarget;
  label: string;
  // Best-effort label for the agent's instruction format (for transparency).
  format: string;
  // Detect by config dir and/or binary on PATH. Returns the dir we matched (for
  // messaging) or null.
  detect(): { detected: boolean; reason: string };
  // The path we will write to (may depend on which dir exists).
  resolvePath(): string;
  // Perform the write. Throws on failure (caller catches and reports).
  apply(path: string): void;
}

const adapters: Adapter[] = [
  {
    target: "claude",
    label: "Claude Code",
    format: "skill",
    detect: () =>
      existsSync(claudeDir) || onPath("claude")
        ? { detected: true, reason: claudeDir }
        : { detected: false, reason: "no ~/.claude, `claude` not on PATH" },
    resolvePath: () => claudeSkillFile,
    apply: () => {
      mkdirSync(claudeSkillDir, { recursive: true });
      writeFileSync(claudeSkillFile, skillMarkdown(), "utf8");
    },
  },
  {
    target: "cursor",
    label: "Cursor",
    format: ".mdc rule",
    detect: () =>
      existsSync(cursorDir) || onPath("cursor")
        ? { detected: true, reason: cursorDir }
        : { detected: false, reason: "no ~/.cursor" },
    resolvePath: () => cursorRuleFile,
    apply: () => {
      const content = `---
description: chifu dep-guard — check changed dependencies for known CVEs and fix them.
alwaysApply: false
---

# chifu dep-guard (Cursor rule)

${rulePreamble()}

${skillBody()}
`;
      writeFileEnsuringDir(cursorRuleFile, content);
    },
  },
  {
    target: "windsurf",
    label: "Windsurf",
    format: "markdown rule",
    detect: () =>
      existsSync(windsurfDir) || onPath("windsurf")
        ? { detected: true, reason: windsurfDir }
        : { detected: false, reason: "no ~/.codeium/windsurf" },
    resolvePath: () => windsurfRuleFile,
    apply: () => {
      writeFileEnsuringDir(windsurfRuleFile, skillMarkdown());
    },
  },
  {
    target: "codex",
    label: "Codex",
    format: "AGENTS.md block",
    // CLI agent — require the actual binary, not just a leftover ~/.codex dir,
    // so we never install into an agent the user doesn't really have.
    detect: () =>
      onPath("codex")
        ? { detected: true, reason: "`codex` on PATH" }
        : { detected: false, reason: "`codex` not on PATH" },
    resolvePath: () => codexAgentsFile,
    apply: (path) => upsertMarkdownFile(path),
  },
  {
    target: "opencode",
    label: "OpenCode",
    format: "AGENTS.md block",
    // CLI agent — require the binary on PATH (a stray config dir isn't enough).
    detect: () =>
      onPath("opencode")
        ? { detected: true, reason: "`opencode` on PATH" }
        : { detected: false, reason: "`opencode` not on PATH" },
    resolvePath: () =>
      existsSync(opencodeXdgDir)
        ? join(opencodeXdgDir, "AGENTS.md")
        : join(opencodeDir, "AGENTS.md"),
    apply: (path) => upsertMarkdownFile(path),
  },
  {
    target: "gemini",
    label: "Gemini CLI",
    format: "GEMINI.md block",
    // CLI agent — require the `gemini` binary on PATH, not a leftover ~/.gemini.
    detect: () =>
      onPath("gemini")
        ? { detected: true, reason: "`gemini` on PATH" }
        : { detected: false, reason: "`gemini` not on PATH" },
    resolvePath: () => geminiRuleFile,
    apply: (path) => upsertMarkdownFile(path),
  },
  {
    target: "cline",
    label: "Cline",
    format: "rule file",
    detect: () =>
      existsSync(clineRulesDir)
        ? { detected: true, reason: clineRulesDir }
        : { detected: false, reason: "no ~/.clinerules" },
    resolvePath: () => clineRuleFile,
    apply: () => {
      const content = `# chifu dep-guard (Cline rule)

${rulePreamble()}

${skillBody()}
`;
      writeFileEnsuringDir(clineRuleFile, content);
    },
  },
];

export async function installAgents(
  prompt: Prompter,
  options: InstallAgentsOptions,
): Promise<AgentResult> {
  log.step("AI coding agents");

  const { assumeYes, only, all } = options;
  const onlySet = only && only.length > 0 ? new Set(only) : null;

  const installs: AgentInstall[] = [];

  // 1. Detect every candidate (filtered to --target when given). Probe once.
  const detections = adapters
    .filter((a) => !onlySet || onlySet.has(a.target))
    .map((a) => ({ adapter: a, det: a.detect() }));

  // Record undetected ones quietly (kept for --json transparency, not printed).
  for (const { adapter, det } of detections) {
    if (!det.detected) {
      installs.push({
        target: adapter.target,
        label: adapter.label,
        detected: false,
        installed: false,
        path: null,
        note: `not detected: ${det.reason}`,
      });
    }
  }

  const detected = detections.filter((d) => d.det.detected);
  if (detected.length === 0) {
    log.warn(
      "No supported AI coding agent detected. The chifu CLI still works on its " +
        "own — install an agent (Claude Code, Cursor, Codex, …) and re-run this wizard.",
    );
    return buildResult(installs);
  }

  // 2. Choose which detected agents get the skill. Interactive runs show a
  //    pre-checked checklist; --yes/--ci/--all-agents/--target install every
  //    detected agent (the choice was already made by the flag / non-TTY).
  const interactive = !assumeYes && !all && !onlySet && Boolean(process.stdin.isTTY);
  let chosen: Set<AgentTarget>;
  if (interactive) {
    const picked = await prompt.multiselect<AgentTarget>(
      "Which agents should get the chifu skill?",
      detected.map((d) => ({
        value: d.adapter.target,
        label: d.adapter.label,
        hint: d.adapter.format,
      })),
      detected.map((d) => d.adapter.target), // everything pre-checked
    );
    chosen = new Set(picked);
  } else {
    chosen = new Set(detected.map((d) => d.adapter.target));
  }

  // 3. Install into the chosen agents; record the rest as skipped.
  for (const { adapter } of detected) {
    const record: AgentInstall = {
      target: adapter.target,
      label: adapter.label,
      detected: true,
      installed: false,
      path: null,
    };

    if (!chosen.has(adapter.target)) {
      record.note = "skipped by user";
      installs.push(record);
      continue;
    }

    const path = adapter.resolvePath();
    record.path = path;
    try {
      adapter.apply(path);
      record.installed = true;
      log.ok(`${adapter.label} ${c.dim(`→ ${path}`)}`);
    } catch (err) {
      record.note = `write failed: ${(err as Error).message}`;
      log.fail(`${adapter.label}: couldn't write ${adapter.format} (${(err as Error).message})`);
    }
    installs.push(record);
  }

  if (!installs.some((i) => i.installed)) {
    log.skip("No agents selected.");
  }

  return buildResult(installs);
}

function buildResult(installs: AgentInstall[]): AgentResult {
  const byTarget = (t: AgentTarget) => installs.find((i) => i.target === t)?.installed ?? false;
  return {
    installs,
    any: installs.some((i) => i.installed),
    claude: byTarget("claude"),
    cursor: byTarget("cursor"),
    windsurf: byTarget("windsurf"),
  };
}
