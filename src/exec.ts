// Cross-platform process execution and PATH detection.
//
// Windows is the tricky case: globally-installed CLIs land as `.cmd`/`.ps1`
// shims (e.g. `chifu.cmd`, `npm.cmd`), and spawning a `.cmd` without a shell
// throws EINVAL on modern Node/Bun. So on Windows we always run through the
// shell. On *nix we spawn directly (no shell) to avoid quoting surprises.

import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  // When true, capture stdout/stderr instead of inheriting the terminal.
  capture?: boolean;
  cwd?: string;
}

// Run a command. `args` are passed through; on Windows we route via the shell
// so `.cmd` shims resolve. Never throws on a non-zero exit — inspect `ok`.
export function run(cmd: string, args: string[], opts: RunOptions = {}): RunResult {
  const stdio = opts.capture ? "pipe" : "inherit";
  const res = spawnSync(cmd, args, {
    stdio: ["ignore", stdio, stdio],
    cwd: opts.cwd,
    encoding: "utf8",
    shell: isWindows, // route through cmd.exe so .cmd/.ps1 shims work
  });
  return {
    ok: res.status === 0,
    code: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

// Is a binary resolvable on PATH? Uses `where` on Windows, `command -v` on
// *nix. Both are builtins/standard and quiet.
export function onPath(bin: string): boolean {
  if (isWindows) {
    const r = spawnSync("where", [bin], { stdio: "ignore", shell: true });
    return r.status === 0;
  }
  const r = spawnSync("command", ["-v", bin], { stdio: "ignore", shell: "/bin/sh" });
  return r.status === 0;
}

// Does a command exist AND respond? We use this to confirm an install actually
// produced a working binary (PATH cache can lag right after a global install).
export function works(cmd: string, args: string[]): boolean {
  const r = run(cmd, args, { capture: true });
  return r.ok;
}
