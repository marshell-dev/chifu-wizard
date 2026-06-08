// Terminal UI helpers: colored output and interactive prompts.
//
// Colors auto-disable when stdout isn't a TTY, when NO_COLOR is set, or when
// FORCE_COLOR=0 — so CI logs stay clean. Prompts go through node:readline so we
// stay on builtins only (no extra deps), and they respect a non-interactive
// mode (--yes / CI) by returning the supplied defaults without blocking.

import { createInterface } from "node:readline";

const colorEnabled = (): boolean => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
};

const wrap = (code: number, s: string): string =>
  colorEnabled() ? `\x1b[${code}m${s}\x1b[0m` : s;

export const c = {
  bold: (s: string) => wrap(1, s),
  dim: (s: string) => wrap(2, s),
  red: (s: string) => wrap(31, s),
  green: (s: string) => wrap(32, s),
  yellow: (s: string) => wrap(33, s),
  blue: (s: string) => wrap(34, s),
  magenta: (s: string) => wrap(35, s),
  cyan: (s: string) => wrap(36, s),
};

const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

export const log = {
  plain: (s = "") => out(s),
  step: (s: string) => out(`\n${c.cyan(c.bold("→"))} ${c.bold(s)}`),
  ok: (s: string) => out(`  ${c.green("✓")} ${s}`),
  info: (s: string) => out(`  ${c.blue("•")} ${s}`),
  warn: (s: string) => out(`  ${c.yellow("!")} ${s}`),
  skip: (s: string) => out(`  ${c.dim("·")} ${c.dim(s)}`),
  // Failures are non-fatal notices, written to stdout so they appear inline
  // with the rest of the wizard's narrative; hard errors throw instead.
  fail: (s: string) => out(`  ${c.red("✗")} ${s}`),
};

export interface Prompter {
  // Free-text question. `secret` masks nothing (we never echo it back), but we
  // avoid printing the value anywhere.
  ask(question: string, fallback?: string): Promise<string>;
  // Yes/no. `def` is returned in non-interactive mode and on empty input.
  confirm(question: string, def: boolean): Promise<boolean>;
  close(): void;
}

// Interactive prompter backed by node:readline.
class ReadlinePrompter implements Prompter {
  private rl = createInterface({ input: process.stdin, output: process.stdout });

  ask(question: string, fallback = ""): Promise<string> {
    const suffix = fallback ? c.dim(` (${fallback})`) : "";
    return new Promise((resolve) => {
      this.rl.question(`  ${c.magenta("?")} ${question}${suffix} `, (answer) => {
        const trimmed = answer.trim();
        resolve(trimmed || fallback);
      });
    });
  }

  confirm(question: string, def: boolean): Promise<boolean> {
    const hint = def ? "Y/n" : "y/N";
    return new Promise((resolve) => {
      this.rl.question(`  ${c.magenta("?")} ${question} ${c.dim(`(${hint})`)} `, (answer) => {
        const a = answer.trim().toLowerCase();
        if (!a) return resolve(def);
        resolve(a === "y" || a === "yes");
      });
    });
  }

  close(): void {
    this.rl.close();
  }
}

// Non-interactive prompter for --yes / CI: never blocks, always uses defaults.
class AutoPrompter implements Prompter {
  ask(_question: string, fallback = ""): Promise<string> {
    return Promise.resolve(fallback);
  }
  confirm(_question: string, def: boolean): Promise<boolean> {
    return Promise.resolve(def);
  }
  close(): void {
    /* nothing to close */
  }
}

export function makePrompter(interactive: boolean): Prompter {
  // Even if the caller wants interactivity, fall back to auto when there's no
  // TTY (piped install one-liners) so we never hang waiting on stdin.
  if (!interactive || !process.stdin.isTTY) return new AutoPrompter();
  return new ReadlinePrompter();
}
