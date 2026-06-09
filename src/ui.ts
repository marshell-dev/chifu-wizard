// Terminal UI helpers, built on @clack/prompts + chalk.
//
// @clack/prompts gives us the boxed ┌ ◇ │ ◆ └ look (intro/outro/log.*/spinner/
// note/confirm/select/text). chalk handles colors (and auto-disables on NO_COLOR
// / non-TTY). We wrap clack behind a thin `log` facade and a `Prompter`
// interface so:
//   - the rest of the wizard keeps a small, stable surface, and
//   - `--json` mode can globally silence every interactive/log call so the only
//     thing on stdout is the final JSON object.
//
// Set quiet mode with `setQuiet(true)` before doing any work in --json runs.

import {
  intro as clackIntro,
  outro as clackOutro,
  log as clackLog,
  note as clackNote,
  spinner as clackSpinner,
  confirm as clackConfirm,
  select as clackSelect,
  text as clackText,
  isCancel as clackIsCancel,
  cancel as clackCancel,
} from "@clack/prompts";
import chalk from "chalk";

// ── colors ──────────────────────────────────────────────────────────────────
// chalk already honors NO_COLOR / FORCE_COLOR / TTY detection. We keep the same
// `c` shape the rest of the code already imports.

export const c = {
  bold: (s: string) => chalk.bold(s),
  dim: (s: string) => chalk.dim(s),
  red: (s: string) => chalk.red(s),
  green: (s: string) => chalk.green(s),
  yellow: (s: string) => chalk.yellow(s),
  blue: (s: string) => chalk.blue(s),
  magenta: (s: string) => chalk.magenta(s),
  cyan: (s: string) => chalk.cyan(s),
};

// ── quiet mode (──json) ───────────────────────────────────────────────────────
// When quiet, every interactive/log helper is a no-op so stdout stays a single
// parseable JSON object. Prompts return their fallbacks (we never prompt in
// --json mode anyway).
//
// The flag lives in process.env, not a module-level variable: the bundler can
// duplicate this module across the import graph (one copy per importing chunk),
// and a module-level boolean would only flip in one copy. process.env is truly
// process-global, so every copy reads the same value.

const QUIET_ENV = "__CHIFU_WIZARD_QUIET";
function quiet(): boolean {
  return process.env[QUIET_ENV] === "1";
}
export function setQuiet(on: boolean): void {
  if (on) process.env[QUIET_ENV] = "1";
  else delete process.env[QUIET_ENV];
}
export function isQuiet(): boolean {
  return quiet();
}

// ── narrative ─────────────────────────────────────────────────────────────────

export function intro(title: string): void {
  if (quiet()) return;
  clackIntro(title);
}

export function outro(message: string): void {
  if (quiet()) return;
  clackOutro(message);
}

export function note(message: string, title?: string): void {
  if (quiet()) return;
  clackNote(message, title);
}

// ── logging facade (maps onto clack's gutter-rendered log.*) ──────────────────

export const log = {
  // Plain message in the clack gutter.
  message: (s = "") => {
    if (!quiet()) clackLog.message(s);
  },
  // Step heading.
  step: (s: string) => {
    if (!quiet()) clackLog.step(s);
  },
  // Success (✓ style).
  ok: (s: string) => {
    if (!quiet()) clackLog.success(s);
  },
  // Informational note.
  info: (s: string) => {
    if (!quiet()) clackLog.info(s);
  },
  // Warning.
  warn: (s: string) => {
    if (!quiet()) clackLog.warn(s);
  },
  // Skipped / dimmed note — there's no native "skip" level, so render it as a
  // dimmed message keeping the gutter alignment.
  skip: (s: string) => {
    if (!quiet()) clackLog.message(c.dim(s));
  },
  // Non-fatal failure notice (hard errors throw instead).
  fail: (s: string) => {
    if (!quiet()) clackLog.error(s);
  },
};

// ── spinner ───────────────────────────────────────────────────────────────────

export interface Spinner {
  start(message?: string): void;
  stop(message?: string, code?: number): void;
  message(message?: string): void;
}

// A clack spinner, or a no-op in quiet mode.
export function spinner(): Spinner {
  if (quiet()) {
    return { start() {}, stop() {}, message() {} };
  }
  const s = clackSpinner();
  return {
    start: (m) => s.start(m),
    stop: (m, code) => s.stop(m, code),
    message: (m) => s.message(m),
  };
}

// ── cancellation ──────────────────────────────────────────────────────────────
// Re-export clack's isCancel; callers use bailIfCancelled to standardise the
// exit behavior (cancel("Cancelled.") + a clean non-zero exit).

export const isCancel = clackIsCancel;

export function bailIfCancelled<T>(value: T | symbol): asserts value is T {
  if (clackIsCancel(value)) {
    clackCancel("Cancelled.");
    process.exit(130);
  }
}

// ── prompts ───────────────────────────────────────────────────────────────────
// The Prompter interface is preserved (steps depend on it). When interactive it
// uses clack confirm/text; in non-interactive/quiet mode it returns the supplied
// fallback/default without blocking. Cancellation exits cleanly via
// bailIfCancelled.

export interface Prompter {
  // Free-text question. Returns the fallback on empty input.
  ask(question: string, fallback?: string): Promise<string>;
  // Yes/no. `def` is returned in non-interactive mode and on empty input.
  confirm(question: string, def: boolean): Promise<boolean>;
  // Single-choice select. Returns the chosen value, or `def` in non-interactive
  // mode.
  select<V extends string>(
    question: string,
    options: { value: V; label: string; hint?: string }[],
    def: V,
  ): Promise<V>;
  close(): void;
}

// Interactive prompter backed by clack.
class ClackPrompter implements Prompter {
  async ask(question: string, fallback = ""): Promise<string> {
    const answer = await clackText({
      message: question,
      placeholder: fallback || undefined,
      defaultValue: fallback,
    });
    bailIfCancelled(answer);
    const trimmed = String(answer).trim();
    return trimmed || fallback;
  }

  async confirm(question: string, def: boolean): Promise<boolean> {
    const answer = await clackConfirm({ message: question, initialValue: def });
    bailIfCancelled(answer);
    return answer;
  }

  async select<V extends string>(
    question: string,
    options: { value: V; label: string; hint?: string }[],
    _def: V,
  ): Promise<V> {
    // clack's Option<V> uses a conditional type that TS won't narrow from a
    // generic V; the runtime shape matches, so cast at the boundary.
    const answer = await clackSelect<V>({
      message: question,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: options as any,
    });
    bailIfCancelled(answer);
    return answer as V;
  }

  close(): void {
    /* clack manages its own streams */
  }
}

// Non-interactive prompter for --yes / CI / --json / no-TTY: never blocks.
class AutoPrompter implements Prompter {
  ask(_question: string, fallback = ""): Promise<string> {
    return Promise.resolve(fallback);
  }
  confirm(_question: string, def: boolean): Promise<boolean> {
    return Promise.resolve(def);
  }
  select<V extends string>(
    _question: string,
    _options: { value: V; label: string; hint?: string }[],
    def: V,
  ): Promise<V> {
    return Promise.resolve(def);
  }
  close(): void {
    /* nothing to close */
  }
}

export function makePrompter(interactive: boolean): Prompter {
  // Even if the caller wants interactivity, fall back to auto when there's no
  // TTY (piped install one-liners) or in quiet/json mode so we never hang.
  if (!interactive || quiet() || !process.stdin.isTTY) return new AutoPrompter();
  return new ClackPrompter();
}
