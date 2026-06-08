#!/usr/bin/env bun

// chifu-wizard — one-command setup for chifu.
//
//   bunx chifu-wizard          (or: npx chifu-wizard)
//
// Walks a developer through everything needed to make their AI coding agent
// dependency-security aware:
//   1. installs the `chifu` CLI globally (if missing),
//   2. installs the chifu skill/rule into every detected agent (Claude Code,
//      Cursor, Windsurf),
//   3. optionally saves an API key (anonymous works too),
//   4. optionally points at a custom backend URL,
//   5. prints how to use it.
//
// Designed to run from a piped one-liner (install.sh / install.ps1) as well as
// interactively. Use --yes for a fully non-interactive run in CI. Built on
// node: builtins + Bun APIs only — no third-party dependencies.

import { log, c, makePrompter, type Prompter } from "./ui.ts";
import { installCli } from "./steps/install-cli.ts";
import { installAgents } from "./steps/install-agents.ts";
import { configureAuth, hasConfiguredKey } from "./steps/auth.ts";

const VERSION = "0.1.0";

interface Args {
  yes: boolean;
  noInteractive: boolean;
  skipCli: boolean;
  skipAgents: boolean;
  apiKey?: string;
  apiUrl?: string;
  help: boolean;
  version: boolean;
}

function getOpt(argv: string[], name: string): string | undefined {
  // Supports both `--flag value` and `--flag=value`.
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function parseArgs(argv: string[]): Args {
  const has = (n: string) => argv.includes(n);
  return {
    yes: has("--yes") || has("-y"),
    noInteractive: has("--no-interactive") || has("--ci"),
    skipCli: has("--skip-cli"),
    skipAgents: has("--skip-agents"),
    // Flags take precedence, then env (so install one-liners can pass either).
    apiKey: getOpt(argv, "--api-key") ?? process.env.CHIFU_API_KEY,
    apiUrl: getOpt(argv, "--api-url") ?? process.env.CHIFU_API_URL,
    help: has("--help") || has("-h"),
    version: has("--version") || has("-v"),
  };
}

const HELP = `${c.bold("chifu-wizard")} ${VERSION} — set up chifu for your AI coding agent

${c.bold("Usage:")}
  bunx chifu-wizard [options]
  npx  chifu-wizard [options]

${c.bold("What it does:")}
  • installs the chifu CLI globally if it's missing
  • installs the chifu skill/rule into your detected agents
    (Claude Code, Cursor, Windsurf)
  • optionally saves an API key and a custom backend URL

${c.bold("Options:")}
  -y, --yes            Accept all defaults; don't prompt (still interactive-safe)
      --no-interactive Alias for non-interactive mode (also --ci)
      --skip-cli       Don't install the chifu CLI
      --skip-agents    Don't touch any agent config
      --api-key <key>  Save this chifu API key (chf_…). Also reads CHIFU_API_KEY
      --api-url <url>  Use a custom backend. Also reads CHIFU_API_URL
  -h, --help           Show this help
  -v, --version        Show the version
`;

function printBanner(): void {
  log.plain();
  log.plain(c.cyan(c.bold("  chifu wizard")));
  log.plain(c.dim("  make your AI coding agent dependency-security aware"));
}

function printSummary(opts: {
  cliPresent: boolean;
  installedVia: "npm" | "bun" | null;
  agentsConfigured: boolean;
}): void {
  log.step("All set");

  if (opts.cliPresent) {
    const via = opts.installedVia ? ` (installed via ${opts.installedVia})` : "";
    log.ok(`chifu CLI ready${via}`);
  } else {
    log.warn("chifu CLI not installed — your agent will fall back to `bunx chifu`");
  }

  if (opts.agentsConfigured) {
    log.ok("Your AI coding agent now knows how to check dependencies for CVEs");
  } else {
    log.info("No agent was configured — install one and re-run `bunx chifu-wizard`");
  }

  log.ok(
    hasConfiguredKey()
      ? "API key saved — results will sync to your dashboard"
      : "Running anonymously (no API key) — that's fine, scans still work",
  );

  log.plain();
  log.plain(c.bold("  Try it:"));
  log.plain(`    1. Open your AI coding agent in a project.`);
  log.plain(`    2. Add or upgrade a dependency (edit ${c.cyan("package.json")}).`);
  log.plain(
    `    3. Ask it: ${c.cyan('"check my dependencies for vulnerabilities and fix them"')}.`,
  );
  log.plain();
  log.plain(
    `  Or run it yourself anytime: ${c.cyan("chifu check")} ${c.dim("(add --json for agents)")}`,
  );
  log.plain(`  Docs: ${c.cyan("https://marshell.dev")}`);
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

  const assumeYes = args.yes || args.noInteractive;
  const prompt: Prompter = makePrompter(!assumeYes);

  printBanner();

  try {
    // 1. CLI
    let cliPresent = false;
    let installedVia: "npm" | "bun" | null = null;
    if (args.skipCli) {
      log.step("chifu CLI");
      log.skip("Skipped (--skip-cli)");
    } else {
      const r = await installCli(prompt, assumeYes);
      cliPresent = r.present;
      installedVia = r.installedVia;
    }

    // 2. Agents
    let agentsConfigured = false;
    if (args.skipAgents) {
      log.step("AI coding agents");
      log.skip("Skipped (--skip-agents)");
    } else {
      const r = await installAgents(prompt, assumeYes);
      agentsConfigured = r.any;
    }

    // 3 & 4. Auth + backend URL
    await configureAuth(prompt, {
      cliPresent,
      apiKey: args.apiKey,
      apiUrl: args.apiUrl,
      assumeYes,
    });

    // 5. Summary
    printSummary({ cliPresent, installedVia, agentsConfigured });
    return 0;
  } catch (err) {
    log.plain();
    log.fail(`Wizard failed: ${(err as Error).message}`);
    return 1;
  } finally {
    prompt.close();
  }
}

main().then((code) => process.exit(code));
