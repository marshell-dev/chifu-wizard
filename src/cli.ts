#!/usr/bin/env bun

// chifu-wizard — one-command setup for chifu.
//
//   bunx @marshell/chifu-wizard          (or: npx @marshell/chifu-wizard)
//
// Walks a developer through everything needed to make their AI coding agent
// dependency-security aware:
//   1. installs the `chifu` CLI globally (if missing),
//   2. installs the chifu skill/rule into every detected agent (Claude Code,
//      Cursor, Windsurf, Codex, OpenCode, Gemini CLI, Cline),
//   3. optionally saves an API key (anonymous works too),
//   4. optionally points at a custom backend URL,
//   5. prints how to use it.
//
// Designed to run from a piped one-liner (install.sh / install.ps1) as well as
// interactively. Use --yes/--ci for a non-interactive run, --json for a
// machine-readable result, and --agent to emit an onboarding prompt for an
// external coding agent instead of running the wizard. Built on node: builtins
// + Bun APIs only — no third-party dependencies.

import { log, c, makePrompter, type Prompter } from "./ui.ts";
import { installCli } from "./steps/install-cli.ts";
import {
  installAgents,
  ALL_TARGETS,
  type AgentTarget,
  type AgentInstall,
} from "./steps/install-agents.ts";
import { signIn, hasConfiguredKey } from "./steps/auth.ts";
import { printAgentPrompt } from "./agent-prompt.ts";

const VERSION = "0.1.0";

interface Args {
  yes: boolean;
  noInteractive: boolean;
  skipCli: boolean;
  skipAgents: boolean;
  skipLogin: boolean;
  allAgents: boolean;
  targets: AgentTarget[];
  json: boolean;
  agent: boolean;
  apiKey?: string;
  apiUrl?: string;
  webUrl?: string;
  help: boolean;
  version: boolean;
  errors: string[];
}

const DEFAULT_API_URL = "https://api.marshell.dev";
const DEFAULT_WEB_URL = "https://app.marshell.dev";

function getOpt(argv: string[], name: string): string | undefined {
  // Supports both `--flag value` and `--flag=value`.
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

// Collect every value of a repeatable flag (e.g. --target a --target b) plus
// comma-separated forms (--target a,b).
function getOptAll(argv: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === name && i + 1 < argv.length) out.push(argv[i + 1]!);
    else if (a.startsWith(`${name}=`)) out.push(a.slice(name.length + 1));
  }
  return out.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}

function parseTargets(raw: string[]): { targets: AgentTarget[]; errors: string[] } {
  const targets: AgentTarget[] = [];
  const errors: string[] = [];
  for (const r of raw) {
    const norm = r.toLowerCase();
    if ((ALL_TARGETS as string[]).includes(norm)) {
      const t = norm as AgentTarget;
      if (!targets.includes(t)) targets.push(t);
    } else {
      errors.push(`unknown --target "${r}" (valid: ${ALL_TARGETS.join(", ")})`);
    }
  }
  return { targets, errors };
}

function parseArgs(argv: string[]): Args {
  const has = (n: string) => argv.includes(n);
  const { targets, errors } = parseTargets(getOptAll(argv, "--target"));
  return {
    yes: has("--yes") || has("-y"),
    // --ci is an alias for non-interactive defaults.
    noInteractive: has("--no-interactive") || has("--ci"),
    skipCli: has("--skip-cli"),
    skipAgents: has("--skip-agents"),
    skipLogin: has("--skip-login"),
    allAgents: has("--all-agents"),
    targets,
    json: has("--json"),
    agent: has("--agent"),
    // Flags take precedence, then env (so install one-liners can pass either).
    apiKey: getOpt(argv, "--api-key") ?? process.env.CHIFU_API_KEY,
    apiUrl: getOpt(argv, "--api-url") ?? process.env.CHIFU_API_URL,
    webUrl: getOpt(argv, "--web-url") ?? process.env.CHIFU_WEB_URL,
    help: has("--help") || has("-h"),
    version: has("--version") || has("-v"),
    errors,
  };
}

const HELP = `${c.bold("chifu-wizard")} ${VERSION} — set up chifu for your AI coding agent

${c.bold("Usage:")}
  bunx @marshell/chifu-wizard [options]
  npx @marshell/chifu-wizard [options]

${c.bold("What it does:")}
  1. installs the chifu CLI (if missing)
  2. installs the chifu skill into your detected agents
     (Claude Code, Cursor, Windsurf, Codex, OpenCode, Gemini CLI, Cline)
  3. signs you in through your browser (a 6-character code) — optional

${c.bold("Options:")}
  -y, --yes            Non-interactive: do steps 1-2, skip the browser sign-in
      --ci             Same as --yes
      --json           Print a machine-readable JSON result of what was installed
      --agent          Print an onboarding prompt for an external coding agent and
                       exit (no side effects; the agent sets chifu up itself)
      --target <name>  Only install into these agents (repeatable / comma-sep).
                       Names: ${ALL_TARGETS.join(", ")}
      --skip-cli       Don't install the chifu CLI
      --skip-agents    Don't touch any agent config
      --skip-login     Don't sign in (chifu still works anonymously)
      --api-key <key>  Sign in with this key instead of the browser. Reads CHIFU_API_KEY
      --api-url <url>  Backend origin. Reads CHIFU_API_URL  (default ${DEFAULT_API_URL})
      --web-url <url>  Dashboard origin for sign-in. Reads CHIFU_WEB_URL  (default ${DEFAULT_WEB_URL})
  -h, --help           Show this help
  -v, --version        Show the version
`;

function printBanner(): void {
  log.plain();
  log.plain(c.cyan(c.bold("  chifu wizard")));
  log.plain(c.dim("  make your AI coding agent dependency-security aware"));
}

// Shape returned to the caller and serialized for --json.
interface RunResult {
  ok: boolean;
  version: string;
  cli: { present: boolean; installedVia: "npm" | "bun" | null };
  agents: AgentInstall[];
  agentsConfigured: boolean;
  apiKeyConfigured: boolean;
}

function printSummary(result: RunResult): void {
  log.step("Done");

  if (!result.cli.present) {
    log.warn("chifu CLI isn't on PATH — your agent will fall back to `bunx @marshell/chifu`");
  }

  const names = result.agents.filter((a) => a.installed).map((a) => a.label);
  if (names.length > 0) {
    const verb = names.length === 1 ? "agent can" : "agents can";
    log.ok(`Your ${verb} now check dependencies for CVEs: ${c.bold(names.join(", "))}`);
  } else {
    log.info("No supported agent detected — install one and re-run the wizard.");
  }

  log.plain();
  log.plain(
    `  ${c.bold("Try it:")} in your agent, ask ${c.cyan('"check my dependencies for vulnerabilities and fix them"')}`,
  );
  log.plain(
    `  Or run ${c.cyan("chifu check")} yourself.  Docs: ${c.cyan("https://marshell.dev")}`,
  );
  log.plain();
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  // --agent emits a prompt and exits with zero side effects. Honored before any
  // other work so it's always safe to pipe.
  if (args.agent) {
    printAgentPrompt();
    return 0;
  }

  if (args.errors.length > 0) {
    for (const e of args.errors) log.fail(e);
    return 2;
  }

  // Only the sign-in step is interactive; --yes/--ci make the whole run silent.
  const nonInteractive = args.yes || args.noInteractive;
  const prompt: Prompter = makePrompter(!nonInteractive);
  const apiUrl = (args.apiUrl?.trim() || DEFAULT_API_URL).replace(/\/+$/, "");
  const webUrl = (args.webUrl?.trim() || DEFAULT_WEB_URL).replace(/\/+$/, "");

  // In --json mode we suppress the narrative banner so stdout stays parseable;
  // step logging still goes to stdout but the final line is the JSON object.
  const jsonMode = args.json;
  if (!jsonMode) printBanner();

  try {
    // 1. CLI — install automatically, no prompt.
    let cliPresent = false;
    let installedVia: "npm" | "bun" | null = null;
    if (args.skipCli) {
      log.step("chifu CLI");
      log.skip("Skipped (--skip-cli)");
    } else {
      const r = await installCli(prompt, true);
      cliPresent = r.present;
      installedVia = r.installedVia;
    }

    // 2. Skill → every detected agent, no per-agent prompts.
    let agents: AgentInstall[] = [];
    let agentsConfigured = false;
    if (args.skipAgents) {
      log.step("AI coding agents");
      log.skip("Skipped (--skip-agents)");
    } else {
      const r = await installAgents(prompt, {
        assumeYes: true,
        only: args.targets,
        all: true,
      });
      agents = r.installs;
      agentsConfigured = r.any;
    }

    // 3. Sign in via the browser (6-char pairing code). Interactive unless
    // --yes/--ci/--skip-login, or --api-key was supplied.
    const signedIn = await signIn(prompt, {
      apiUrl,
      webUrl,
      apiKey: args.apiKey,
      nonInteractive,
      skip: args.skipLogin,
    });

    const result: RunResult = {
      ok: true,
      version: VERSION,
      cli: { present: cliPresent, installedVia },
      agents,
      agentsConfigured,
      apiKeyConfigured: signedIn || hasConfiguredKey(),
    };

    if (jsonMode) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      printSummary(result);
    }
    return 0;
  } catch (err) {
    if (jsonMode) {
      process.stdout.write(
        JSON.stringify({ ok: false, version: VERSION, error: (err as Error).message }, null, 2) +
          "\n",
      );
    } else {
      log.plain();
      log.fail(`Wizard failed: ${(err as Error).message}`);
    }
    return 1;
  } finally {
    prompt.close();
  }
}

main().then((code) => process.exit(code));
