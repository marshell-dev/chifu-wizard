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
//   3. signs in via browser pairing (optional — anonymous works too),
//   4. prints how to use it.
//
// Designed to run from a piped one-liner (install.sh / install.ps1) as well as
// interactively. Use --yes/--ci for a non-interactive run, --json for a
// machine-readable result, and --agent to emit an onboarding prompt for an
// external coding agent instead of running the wizard.
//
// UX is built on @clack/prompts (the boxed ┌ ◇ │ ◆ └ flow) + chalk; args are
// parsed with yargs; backend responses validated with zod; the browser is
// opened with `open`; and CHIFU_* env can come from a .env file (dotenv).

import { config as loadDotenv } from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import chalk from "chalk";

import {
  intro,
  outro,
  note,
  log,
  c,
  makePrompter,
  setQuiet,
  type Prompter,
} from "./ui.ts";
import { installCli } from "./steps/install-cli.ts";
import {
  installAgents,
  ALL_TARGETS,
  type AgentTarget,
  type AgentInstall,
} from "./steps/install-agents.ts";
import { signIn, hasConfiguredKey } from "./steps/auth.ts";
import { printAgentPrompt } from "./agent-prompt.ts";

// Load CHIFU_API_URL / CHIFU_WEB_URL / CHIFU_API_KEY from a .env file if present.
// Existing process env always wins (dotenv does not override by default).
// `quiet` suppresses dotenv's startup banner so it never pollutes stdout — vital
// for --json mode, which must emit only the result object.
loadDotenv({ quiet: true });

const VERSION = "0.1.0";

const DEFAULT_API_URL = "https://api.marshell.dev";
const DEFAULT_WEB_URL = "https://marshell.dev";

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
  errors: string[];
}

// Normalise the raw --target values (repeatable + comma-separated) into known
// AgentTargets, collecting any unknown names as errors.
function parseTargets(raw: string[]): { targets: AgentTarget[]; errors: string[] } {
  const targets: AgentTarget[] = [];
  const errors: string[] = [];
  const flat = raw
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  for (const r of flat) {
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

// Build the yargs parser. We keep the help/version output ourselves only for the
// styled banner inside the help epilogue; yargs handles flag parsing + --help.
function buildParser(argv: string[]) {
  return yargs(argv)
    .scriptName("chifu-wizard")
    .usage(
      `${chalk.bold("chifu-wizard")} — set up chifu for your AI coding agent\n\n` +
        "Usage:\n" +
        "  npx @marshell/chifu-wizard [options]\n" +
        "  bunx @marshell/chifu-wizard [options]\n\n" +
        "What it does:\n" +
        "  1. installs the chifu CLI (if missing)\n" +
        "  2. lets you pick which detected agents get the chifu skill\n" +
        "     (Claude Code, Cursor, Windsurf, Codex, OpenCode, Gemini CLI, Cline)\n" +
        "  3. signs you in through your browser (a pairing code) — optional",
    )
    .option("yes", {
      alias: "y",
      type: "boolean",
      default: false,
      describe: "Non-interactive: do steps 1-2, skip the browser sign-in",
    })
    .option("ci", {
      type: "boolean",
      default: false,
      describe: "Same as --yes (non-interactive)",
    })
    .option("json", {
      type: "boolean",
      default: false,
      describe: "Print a machine-readable JSON result and nothing else",
    })
    .option("agent", {
      type: "boolean",
      default: false,
      describe: "Print an onboarding prompt for an external coding agent and exit",
    })
    .option("target", {
      type: "string",
      array: true,
      describe: `Only install into these agents (repeatable / comma-sep): ${ALL_TARGETS.join(", ")}`,
    })
    .option("all-agents", {
      type: "boolean",
      default: false,
      describe: "Install into every detected agent (skip the checklist)",
    })
    .option("skip-cli", {
      type: "boolean",
      default: false,
      describe: "Don't install the chifu CLI",
    })
    .option("skip-agents", {
      type: "boolean",
      default: false,
      describe: "Don't touch any agent config",
    })
    .option("skip-login", {
      type: "boolean",
      default: false,
      describe: "Don't sign in (chifu still works anonymously)",
    })
    .option("api-key", {
      type: "string",
      describe: "Sign in with this key instead of the browser (env: CHIFU_API_KEY)",
    })
    .option("api-url", {
      type: "string",
      describe: `Backend origin (env: CHIFU_API_URL, default ${DEFAULT_API_URL})`,
    })
    .option("web-url", {
      type: "string",
      describe: `Dashboard origin for sign-in (env: CHIFU_WEB_URL, default ${DEFAULT_WEB_URL})`,
    })
    .help("help")
    .alias("help", "h")
    .version("version", "Show the version", VERSION)
    .alias("version", "v")
    .strict()
    .wrap(Math.min(100, process.stdout.columns || 100));
}

function parseArgs(argv: string[]): Args {
  const parsed = buildParser(argv).parseSync();
  const rawTargets = (parsed.target as string[] | undefined) ?? [];
  const { targets, errors } = parseTargets(rawTargets);
  return {
    yes: Boolean(parsed.yes),
    // --ci is an alias for non-interactive defaults.
    noInteractive: Boolean(parsed.ci),
    skipCli: Boolean(parsed["skip-cli"]),
    skipAgents: Boolean(parsed["skip-agents"]),
    skipLogin: Boolean(parsed["skip-login"]),
    allAgents: Boolean(parsed["all-agents"]),
    targets,
    json: Boolean(parsed.json),
    agent: Boolean(parsed.agent),
    // Flags take precedence, then env (so install one-liners can pass either).
    apiKey: (parsed["api-key"] as string | undefined) ?? process.env.CHIFU_API_KEY,
    apiUrl: (parsed["api-url"] as string | undefined) ?? process.env.CHIFU_API_URL,
    webUrl: (parsed["web-url"] as string | undefined) ?? process.env.CHIFU_WEB_URL,
    errors,
  };
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

  note(
    `Ask your coding agent ${c.cyan('"check my dependencies for vulnerabilities and fix them"')}\n` +
      `Or run ${c.cyan("chifu check")} yourself.\n` +
      `Docs: ${c.cyan("https://marshell.dev")}`,
    "Try it",
  );
  outro(c.green("chifu is ready"));
}

async function main(): Promise<number> {
  const argv = hideBin(process.argv);
  const args = parseArgs(argv);

  // --agent emits a prompt and exits with zero side effects. Honored before any
  // other work (and before the clack UI starts) so it's always safe to pipe.
  if (args.agent) {
    printAgentPrompt();
    return 0;
  }

  if (args.errors.length > 0) {
    for (const e of args.errors) process.stderr.write(`error: ${e}\n`);
    return 2;
  }

  // --json: suppress the entire interactive clack UI; only the final JSON object
  // is written to stdout.
  const jsonMode = args.json;
  setQuiet(jsonMode);

  // Only the sign-in step is interactive; --yes/--ci/--json make the run silent.
  const nonInteractive = args.yes || args.noInteractive || jsonMode;
  const prompt: Prompter = makePrompter(!nonInteractive);
  const apiUrl = (args.apiUrl?.trim() || DEFAULT_API_URL).replace(/\/+$/, "");
  const webUrl = (args.webUrl?.trim() || DEFAULT_WEB_URL).replace(/\/+$/, "");

  if (!jsonMode) {
    intro(`${chalk.bgCyan.black.bold(" chifu wizard ")} ${chalk.dim("v" + VERSION)}`);
    log.message(c.dim("make your AI coding agent dependency-security aware"));
  }

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

    // 2. Skill → pick agents from a pre-checked checklist. Non-interactive
    //    (--yes/--ci/--json), --all-agents, or --target install all detected
    //    without prompting.
    let agents: AgentInstall[] = [];
    let agentsConfigured = false;
    if (args.skipAgents) {
      log.step("AI coding agents");
      log.skip("Skipped (--skip-agents)");
    } else {
      const r = await installAgents(prompt, {
        assumeYes: nonInteractive,
        only: args.targets,
        all: args.allAgents,
      });
      agents = r.installs;
      agentsConfigured = r.any;
    }

    // 3. Sign in via the browser pairing code. Interactive unless
    // --yes/--ci/--json/--skip-login, or --api-key was supplied.
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
      log.fail(`Wizard failed: ${(err as Error).message}`);
    }
    return 1;
  } finally {
    prompt.close();
  }
}

main().then((code) => process.exit(code));
