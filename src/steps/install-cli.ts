// Step 1 — make sure the `chifu` CLI is installed and on PATH.
//
// If it's already resolvable we leave it alone. Otherwise we try a global npm
// install first (most universal), then fall back to `bun add -g`. We report
// which manager succeeded, and we don't hard-fail the wizard if neither works —
// the agent skill can still fall back to `bunx @marshell/chifu@latest` at runtime.

import { run, onPath, works } from "../exec.ts";
import { log, c, spinner, type Prompter } from "../ui.ts";

export interface CliResult {
  present: boolean;
  installedVia: "npm" | "bun" | null;
}

function chifuWorks(): boolean {
  // Prefer a real invocation over PATH lookup alone — confirms it executes.
  if (works("chifu", ["--version"])) return true;
  return onPath("chifu");
}

// `update` forces a reinstall of @latest even when chifu is already present
// (used by `chifu-wizard update`); otherwise we leave a working install alone.
export async function installCli(
  prompt: Prompter,
  assumeYes: boolean,
  update = false,
): Promise<CliResult> {
  log.step("chifu CLI");

  if (!update && chifuWorks()) {
    log.ok(`${c.bold("chifu")} is already installed and on your PATH`);
    return { present: true, installedVia: null };
  }

  if (!update) {
    log.info("chifu CLI not found on PATH");
    const proceed =
      assumeYes || (await prompt.confirm("Install the chifu CLI globally now?", true));
    if (!proceed) {
      log.skip("Skipped CLI install — your agent can still use `bunx @marshell/chifu@latest`");
      return { present: false, installedVia: null };
    }
  }

  const verb = update ? "Updating" : "Installing";
  const done = update ? "Updated" : "Installed";

  // Try npm first (broadest reach), then bun. A spinner wraps each attempt.
  if (onPath("npm")) {
    const s = spinner();
    s.start(`${verb} chifu via npm (npm i -g @marshell/chifu@latest)`);
    const r = run("npm", ["install", "-g", "@marshell/chifu@latest"], { capture: true });
    if (r.ok && chifuWorks()) {
      s.stop(`${done} ${c.bold("chifu")} via npm`);
      return { present: true, installedVia: "npm" };
    }
    s.stop("npm did not produce a working `chifu` — trying bun…", 1);
  } else {
    log.skip("npm not found — trying bun…");
  }

  if (onPath("bun")) {
    const s = spinner();
    s.start(`${verb} chifu via bun (bun add -g @marshell/chifu@latest)`);
    const r = run("bun", ["add", "-g", "@marshell/chifu@latest"], { capture: true });
    if (r.ok && chifuWorks()) {
      s.stop(`${done} ${c.bold("chifu")} via bun`);
      return { present: true, installedVia: "bun" };
    }
    s.stop("bun did not produce a working `chifu`", 1);
  } else {
    log.skip("bun not found");
  }

  log.fail(
    `Couldn't ${update ? "update" : "install"} the chifu CLI automatically. Do it yourself with ` +
      `${c.bold("npm i -g @marshell/chifu@latest")} or ${c.bold("bun add -g @marshell/chifu@latest")}.`,
  );
  log.info("Your agent can still run `bunx @marshell/chifu@latest check` without a global install.");
  return { present: false, installedVia: null };
}
