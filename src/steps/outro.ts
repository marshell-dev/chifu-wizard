// Post-install success outro — scannable sections (what you got, how to use it,
// example asks, links), rendered inside clack's outro box. Style mirrors
// nia-wizard's buildSuccessOutro: a bold green title, a dim tagline, cyan
// section headers, and dim-bulleted lines.

import chalk from "chalk";

const pad = "  ";

function dimBullet(text: string): string {
  return `${pad}${chalk.dim("•")} ${text}`;
}

export interface SuccessOutroOptions {
  cliPresent: boolean;
  // Labels of the agents the skill was installed into.
  agents: string[];
  signedIn: boolean;
}

export function buildSuccessOutro(o: SuccessOutroOptions): string {
  const sections = [
    chalk.green.bold("chifu is ready"),
    chalk.dim(
      "Your AI coding agent now checks dependencies for known CVEs — and fixes them — before they ship.",
    ),
    "",
    chalk.cyan.bold("What you got"),
    dimBullet(
      o.cliPresent
        ? `${chalk.white("chifu CLI")} ${chalk.dim("— installed; run")} ${chalk.yellow("chifu check")} ${chalk.dim("in any repo")}`
        : `${chalk.white("chifu CLI")} ${chalk.dim("— not on PATH; your agent falls back to")} ${chalk.yellow("bunx @marshell/chifu")}`,
    ),
    dimBullet(
      o.agents.length
        ? `${chalk.white("dep-guard skill")} ${chalk.dim("— added to")} ${chalk.white(o.agents.join(", "))}`
        : `${chalk.white("dep-guard skill")} ${chalk.dim("— no agent detected; install one and re-run the wizard")}`,
    ),
    ...(o.signedIn
      ? [
          dimBullet(
            `${chalk.white("Dashboard")} ${chalk.dim("— signed in; checks sync to")} ${chalk.cyan("https://marshell.dev")}`,
          ),
        ]
      : []),
    "",
    chalk.cyan.bold("Ask your coding agent"),
    `${pad}${chalk.yellow('"check my dependencies for vulnerabilities and fix them"')}`,
    `${pad}${chalk.yellow('"is anything in my package.json vulnerable?"')}`,
    "",
    chalk.cyan.bold("Or run it yourself"),
    `${pad}${chalk.yellow("chifu check")}   ${chalk.dim("(--json for agents · --fail-on-findings for CI)")}`,
    "",
    chalk.cyan.bold("Links"),
    `${pad}${chalk.dim("Docs")}       ${chalk.cyan("https://marshell.dev")}`,
    `${pad}${chalk.dim("Dashboard")}  ${chalk.cyan("https://marshell.dev/dashboard")}`,
  ];

  return sections.join("\n");
}
