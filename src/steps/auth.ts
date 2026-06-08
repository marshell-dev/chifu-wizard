// Steps 3 & 4 — optional API key and optional backend URL.
//
// chifu check works fully anonymously; a key only syncs results to the user's
// dashboard. So this whole step is skippable. When a key is given we prefer the
// CLI's own `chifu login` (single source of truth for the config format); if
// the CLI isn't installed we write ~/.config/chifu/config.json ourselves,
// matching chifu-cli/src/api.ts (merge existing keys, mode 0600).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { run } from "../exec.ts";
import { log, c, type Prompter } from "../ui.ts";
import { chifuConfigDir, chifuConfigPath } from "../paths.ts";

export interface AuthOptions {
  cliPresent: boolean;
  // Pre-supplied via flags/env for non-interactive use.
  apiKey?: string;
  apiUrl?: string;
  assumeYes: boolean;
}

interface ChifuConfig {
  apiKey?: string;
  apiUrl?: string;
}

function readConfig(): ChifuConfig {
  try {
    return JSON.parse(readFileSync(chifuConfigPath(), "utf8")) as ChifuConfig;
  } catch {
    return {};
  }
}

// Merge a patch into the existing config and persist with mode 0600, exactly as
// the CLI does — so the wizard and `chifu login` never clobber each other.
function writeConfig(patch: ChifuConfig): void {
  const merged = { ...readConfig(), ...patch };
  mkdirSync(chifuConfigDir(), { recursive: true });
  writeFileSync(chifuConfigPath(), JSON.stringify(merged, null, 2) + "\n", {
    mode: 0o600,
  });
}

// Persist the key via the CLI when available (it owns the format), else write
// the config file directly. Returns true on success.
function saveKey(key: string, cliPresent: boolean): boolean {
  if (cliPresent) {
    const r = run("chifu", ["login", key], { capture: true });
    if (r.ok) return true;
    log.warn("`chifu login` failed — writing the config file directly instead");
  }
  try {
    writeConfig({ apiKey: key });
    return true;
  } catch (err) {
    log.fail(`Couldn't save the API key (${(err as Error).message})`);
    return false;
  }
}

function looksLikeKey(key: string): boolean {
  return key.startsWith("chf_");
}

export async function configureAuth(prompt: Prompter, opts: AuthOptions): Promise<void> {
  log.step("API key & backend (optional)");

  // ── API URL (only persisted when explicitly provided) ───────────────────────
  let apiUrl = opts.apiUrl?.trim();
  if (!apiUrl && !opts.assumeYes) {
    const answer = await prompt.ask(
      "Custom backend URL? (leave blank for the default api.marshell.dev)",
      "",
    );
    apiUrl = answer.trim();
  }
  if (apiUrl) {
    const normalized = apiUrl.replace(/\/+$/, "");
    try {
      writeConfig({ apiUrl: normalized });
      log.ok(`Backend URL set to ${c.bold(normalized)}`);
    } catch (err) {
      log.fail(`Couldn't save backend URL (${(err as Error).message})`);
    }
  } else {
    log.skip("Using the default backend (https://api.marshell.dev)");
  }

  // ── API key ─────────────────────────────────────────────────────────────────
  let key = opts.apiKey?.trim();
  if (!key && !opts.assumeYes) {
    const wantKey = await prompt.confirm(
      "Add an API key to sync scan results to your dashboard? (optional)",
      false,
    );
    if (wantKey) {
      key = (await prompt.ask("Paste your chifu API key (chf_…)", "")).trim();
    }
  }

  if (!key) {
    log.skip("No API key — chifu check runs anonymously (no dashboard sync)");
    return;
  }

  if (!looksLikeKey(key)) {
    log.warn(`That key doesn't look like a chifu key (expected a ${c.bold("chf_")} prefix) — saving it anyway`);
  }

  if (saveKey(key, opts.cliPresent)) {
    log.ok(`API key saved → ${c.dim(chifuConfigPath())} ${c.dim("(mode 600)")}`);
  }
}

// Exposed so the summary step can tell the user whether a key is configured,
// without re-prompting.
export function hasConfiguredKey(): boolean {
  return Boolean(readConfig().apiKey) || Boolean(process.env.CHIFU_API_KEY);
}

// True when the config file already exists (used to detect the no-config case).
export function configExists(): boolean {
  return existsSync(chifuConfigPath());
}
