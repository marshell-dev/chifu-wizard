// Cross-platform process execution, PATH detection, and browser opening.
//
// Windows is the tricky case: globally-installed CLIs land as `.cmd`/`.ps1`
// shims (e.g. `chifu.cmd`, `npm.cmd`), and spawning a `.cmd` without a shell
// throws EINVAL. So on Windows we run through the shell — but we pass a SINGLE
// command string rather than (command, args[], {shell:true}), because the
// latter triggers Node's DEP0190 deprecation warning ("Passing args to a child
// process with shell option true …"). On *nix we spawn directly (no shell).

import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  capture?: boolean;
  cwd?: string;
}

// Quote an argument for safe inclusion in a shell command string.
function quoteArg(a: string): string {
  return /[\s"^&|<>()%]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

// Run a command. Never throws on a non-zero exit — inspect `ok`.
export function run(cmd: string, args: string[], opts: RunOptions = {}): RunResult {
  const stdio = opts.capture ? "pipe" : "inherit";
  const res = isWindows
    ? spawnSync([cmd, ...args].map(quoteArg).join(" "), {
        stdio: ["ignore", stdio, stdio],
        cwd: opts.cwd,
        encoding: "utf8",
        shell: true, // single string + shell:true → resolves .cmd/.ps1, no DEP0190
      })
    : spawnSync(cmd, args, {
        stdio: ["ignore", stdio, stdio],
        cwd: opts.cwd,
        encoding: "utf8",
      });
  return {
    ok: res.status === 0,
    code: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

// Is a binary resolvable on PATH? Single-string shell command (no args array)
// so we don't trip DEP0190.
export function onPath(bin: string): boolean {
  const res = isWindows
    ? spawnSync(`where ${quoteArg(bin)}`, { stdio: "ignore", shell: true })
    : spawnSync(`command -v ${quoteArg(bin)}`, { stdio: "ignore", shell: "/bin/sh" });
  return res.status === 0;
}

// Does a command exist AND respond? Confirms an install produced a working
// binary (PATH cache can lag right after a global install).
export function works(cmd: string, args: string[]): boolean {
  return run(cmd, args, { capture: true }).ok;
}

// Open a URL in the default browser. Best-effort + non-blocking — if it fails,
// the caller has already printed the URL for the user to open manually.
export function openBrowser(url: string): void {
  try {
    if (isWindows) {
      spawnSync(`start "" ${quoteArg(url)}`, { stdio: "ignore", shell: true });
    } else if (process.platform === "darwin") {
      spawnSync("open", [url], { stdio: "ignore" });
    } else {
      spawnSync("xdg-open", [url], { stdio: "ignore" });
    }
  } catch {
    /* best-effort — the URL was printed already */
  }
}
