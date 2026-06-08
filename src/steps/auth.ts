// Step 3 — Sign in (browser device-pairing), the same flow as `chifu login`.
//
// The wizard opens the dashboard's pairing page, the user signs in there and
// copies the 6-character code it shows, pastes it back here, and we exchange it
// for a freshly-minted chf_ API key and save it to the chifu config (the exact
// path + format the CLI reads). chifu works anonymously, so this is skippable.
//
// We do the exchange inline (rather than shelling out to `chifu login`) so the
// wizard's sign-in works regardless of which CLI version is installed.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { openBrowser } from "../exec.ts";
import { log, c, type Prompter } from "../ui.ts";
import { chifuConfigDir, chifuConfigPath } from "../paths.ts";

interface ChifuConfig {
  apiKey?: string;
  apiUrl?: string;
  webUrl?: string;
}

function readConfig(): ChifuConfig {
  try {
    return JSON.parse(readFileSync(chifuConfigPath(), "utf8")) as ChifuConfig;
  } catch {
    return {};
  }
}

// Merge + persist with mode 0600, matching chifu-cli/src/api.ts exactly so the
// wizard and the CLI never clobber each other's config.
function writeConfig(patch: ChifuConfig): void {
  const merged = { ...readConfig(), ...patch };
  mkdirSync(chifuConfigDir(), { recursive: true });
  writeFileSync(chifuConfigPath(), JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
}

export interface SignInOptions {
  apiUrl: string;
  webUrl: string;
  // Pre-supplied key (flag/env) → save directly, skip the browser.
  apiKey?: string;
  // --yes / --ci: no browser prompt; stay anonymous unless apiKey was given.
  nonInteractive: boolean;
  // --skip-login.
  skip: boolean;
}

interface Envelope<T> {
  data: T | null;
  error: string | null;
}

// Trade a pairing code for a chf_ API key (POST /api/v1/cli/exchange, no auth).
async function exchange(apiUrl: string, code: string): Promise<{ apiKey: string; org: string }> {
  const res = await fetch(`${apiUrl}/api/v1/cli/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const env = (await res.json().catch(() => null)) as Envelope<{ apiKey: string; org: string }> | null;
  if (!res.ok || !env || env.error || !env.data?.apiKey) {
    throw new Error(env?.error || `sign-in failed (HTTP ${res.status})`);
  }
  return env.data;
}

// Returns true if a key ended up saved.
export async function signIn(prompt: Prompter, opts: SignInOptions): Promise<boolean> {
  log.step("Sign in");

  if (opts.skip) {
    log.skip("Skipped (--skip-login) — chifu runs anonymously");
    return false;
  }

  // Explicit key (CI / --api-key / CHIFU_API_KEY): save and move on.
  if (opts.apiKey) {
    const key = opts.apiKey.trim();
    try {
      writeConfig({ apiKey: key });
      log.ok("API key saved — results will sync to your dashboard");
      return true;
    } catch (err) {
      log.fail(`Couldn't save the key (${(err as Error).message})`);
      return false;
    }
  }

  // Non-interactive without a key: stay anonymous (don't block).
  if (opts.nonInteractive) {
    log.skip("No API key — running anonymously (run `chifu login` anytime)");
    return false;
  }

  const url = `${opts.webUrl}/dashboard/cli`;
  log.info(`Opening ${c.cyan(url)} in your browser…`);
  log.info("Sign in there, then copy the 6-character code it shows.");
  openBrowser(url);

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = (await prompt.ask("Paste the code (or press Enter to skip)")).trim();
    if (!code) {
      log.skip("Skipped — chifu runs anonymously; run `chifu login` anytime");
      return false;
    }
    try {
      const { apiKey, org } = await exchange(opts.apiUrl, code);
      writeConfig({ apiKey });
      log.ok(`Signed in${org ? ` ${c.dim(`(${org})`)}` : ""}`);
      return true;
    } catch (err) {
      log.fail(`${(err as Error).message} — try again, or press Enter to skip`);
    }
  }

  log.skip("Couldn't sign in — continuing anonymously; run `chifu login` later");
  return false;
}

export function hasConfiguredKey(): boolean {
  return Boolean(readConfig().apiKey) || Boolean(process.env.CHIFU_API_KEY);
}
