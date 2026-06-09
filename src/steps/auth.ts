// Step 3 — Sign in (browser pairing, the same poll flow as `chifu login`).
//
// The wizard mints a pairing session, opens the onboarding page (which carries
// the sid + code), and POLLS the backend until the logged-in browser authorizes
// the device — no manual code paste. On success it writes the freshly-minted
// chf_ key to the chifu config (the exact path + format the CLI reads). chifu
// REQUIRES an account, so this is the expected step — skipping it leaves chifu
// unable to run until the user signs in later with `chifu login`.
//
// We do the session create + poll inline (rather than shelling out to
// `chifu login`) so the wizard's sign-in works regardless of which CLI version
// is installed, and so the wizard package stays standalone.
//
// Backend responses are validated with zod before use; the local chifu config is
// parsed with jsonc-parser so a hand-edited (possibly commented) config.json
// doesn't crash the read.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { parse as parseJsonc } from "jsonc-parser";

import { openBrowser } from "../exec.ts";
import { log, c, note, spinner, type Prompter } from "../ui.ts";
import { chifuConfigDir, chifuConfigPath } from "../paths.ts";

interface ChifuConfig {
  apiKey?: string;
  apiUrl?: string;
  webUrl?: string;
}

// Tolerant read of the chifu CLI config: it may not exist, may be empty, or may
// have been hand-edited with comments — jsonc-parser handles all three.
function readConfig(): ChifuConfig {
  let raw: string;
  try {
    raw = readFileSync(chifuConfigPath(), "utf8");
  } catch {
    return {};
  }
  const parsed = parseJsonc(raw) as unknown;
  if (parsed && typeof parsed === "object") return parsed as ChifuConfig;
  return {};
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
  // --yes / --ci: no browser prompt; without a pre-supplied key the user must
  // run `chifu login` afterwards (chifu needs an account to run).
  nonInteractive: boolean;
  // --skip-login.
  skip: boolean;
}

const POLL_INTERVAL_MS = 2000;

// ── response schemas ──────────────────────────────────────────────────────────
// The backend wraps payloads in { data, error }. We validate the envelope and
// the inner data shape before trusting any field.

const SessionCreateSchema = z.object({
  sid: z.string().min(1),
  code: z.string().min(1),
  expiresInSeconds: z.number().finite(),
});
type SessionCreate = z.infer<typeof SessionCreateSchema>;

const SessionStatusSchema = z.union([
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("authorized"),
    apiKey: z.string().min(1),
    org: z.string().optional().default(""),
  }),
]);
type SessionStatus = z.infer<typeof SessionStatusSchema>;

function envelopeSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    data: data.nullable().optional(),
    error: z.string().nullable().optional(),
  });
}

// PKCE proof-of-possession (RFC 7636 S256), mirroring chifu-cli/src/api.ts
// generatePkcePair. We keep `verifier` private and only ever send `challenge`
// (its SHA-256 hash) to the server at create time, then present the raw
// `verifier` on each poll. This binds the minted key to THIS wizard process: a
// `sid` that leaks via the browser URL (the cli-onboarding link now carries it)
// can't redeem the key without the verifier the attacker never saw.
interface PkcePair {
  verifier: string;
  challenge: string;
}

function generatePkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// Mint a pairing session (POST /api/v1/cli/session, no auth). Mirrors the CLI's
// postCliSessionCreate so the two stay on the same contract — including the
// optional `code_challenge` PKCE binding (the backend accepts it optionally).
async function createSession(apiUrl: string, codeChallenge: string): Promise<SessionCreate> {
  const res = await fetch(`${apiUrl}/api/v1/cli/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code_challenge: codeChallenge }),
  });
  const raw = (await res.json().catch(() => null)) as unknown;
  const env = envelopeSchema(SessionCreateSchema).safeParse(raw);
  if (!res.ok || !env.success || env.data.error || !env.data.data) {
    const msg = env.success ? env.data.error : null;
    throw new Error(msg || `sign-in failed (HTTP ${res.status})`);
  }
  return env.data.data;
}

// Poll a pairing session (GET /api/v1/cli/session?sid=…&verifier=…, no auth). A
// 404/410 (missing/expired/consumed) throws with the server's message. The
// `verifier` is the PKCE secret the server hashes and compares against the
// challenge bound at create time — it enforces it only when a challenge was
// stored, so the wizard stays on the CLI's getCliSession wire contract.
async function pollSession(apiUrl: string, sid: string, verifier: string): Promise<SessionStatus> {
  const res = await fetch(
    `${apiUrl}/api/v1/cli/session?sid=${encodeURIComponent(sid)}&verifier=${encodeURIComponent(verifier)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  );
  const raw = (await res.json().catch(() => null)) as unknown;
  const env = envelopeSchema(SessionStatusSchema).safeParse(raw);
  if (!res.ok || !env.success || env.data.error || !env.data.data) {
    const msg = env.success ? env.data.error : null;
    throw new Error(msg || `sign-in failed (HTTP ${res.status})`);
  }
  return env.data.data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Returns true if a key ended up saved.
export async function signIn(_prompt: Prompter, opts: SignInOptions): Promise<boolean> {
  log.step("Sign in (required)");

  if (opts.skip) {
    log.skip("Skipped (--skip-login) — chifu won't run until you sign in with `chifu login`");
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

  // Non-interactive without a key: we can't open a browser here. Don't hard-fail
  // the install, but make clear chifu needs a login before it'll run.
  if (opts.nonInteractive) {
    log.skip("No API key — run `chifu login` before using chifu (it needs an account)");
    return false;
  }

  // PKCE: bind this pairing to THIS wizard process. We send only the challenge
  // (hash) when minting the session and present the verifier on every poll, so
  // the server hands the minted key to no one but us — even if the sid leaks
  // (it travels in the cli-onboarding browser URL).
  const { verifier, challenge } = generatePkcePair();

  // Mint a session, then open the browser to the onboarding page.
  let session: SessionCreate;
  try {
    session = await createSession(opts.apiUrl, challenge);
  } catch (err) {
    log.fail(`Couldn't start sign-in (${(err as Error).message}) — run \`chifu login\` to finish setup`);
    return false;
  }

  const onboardingUrl =
    `${opts.webUrl}/cli-onboarding?code=${encodeURIComponent(session.code)}` +
    `&sid=${encodeURIComponent(session.sid)}`;

  const expiresMin = Math.max(1, Math.floor(session.expiresInSeconds / 60));
  note(
    `${c.bold("Your sign-in code")}\n\n` +
      `    ${c.bold(c.green(session.code))}\n\n` +
      c.dim(`Code expires in ${expiresMin} minutes`),
    "Browser sign-in",
  );
  log.info(`Opening ${c.cyan(onboardingUrl)}`);
  await openBrowser(onboardingUrl);
  log.message(c.dim("If the browser didn't open, go to:\n") + `  ${c.cyan(onboardingUrl)}`);

  // Poll until authorized or the session expires (~10 min). Transient poll
  // errors don't abort — we keep trying until the deadline. A clack spinner
  // shows progress for the whole wait.
  const s = spinner();
  s.start("Waiting for you to authorize in your browser…");
  const deadline = Date.now() + Math.max(0, session.expiresInSeconds) * 1000;
  let pollCount = 0;
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      s.stop("Timed out — run `chifu login` to finish signing in (chifu needs an account)", 1);
      return false;
    }

    // Live countdown; every ~30s also surface the URL in case the browser
    // never opened.
    const totalSecs = Math.floor(remainingMs / 1000);
    const clock = `${Math.floor(totalSecs / 60)}:${String(totalSecs % 60).padStart(2, "0")}`;
    s.message(
      pollCount > 0 && pollCount % 15 === 0
        ? `Waiting for authorization… (${clock} left) — ${onboardingUrl}`
        : `Waiting for you to authorize in your browser… (${clock} left)`,
    );
    pollCount++;

    await sleep(POLL_INTERVAL_MS);

    let status: SessionStatus;
    try {
      status = await pollSession(opts.apiUrl, session.sid, verifier);
    } catch (err) {
      const msg = (err as Error).message;
      // A 404/410 means the session is gone — unrecoverable, stop polling.
      if (/expired|not found|consumed|410|404/i.test(msg)) {
        s.stop(`${msg} — run \`chifu login\` to finish signing in`, 1);
        return false;
      }
      // Otherwise a transient blip — keep polling until the deadline.
      continue;
    }

    if (status.status === "authorized") {
      writeConfig({ apiKey: status.apiKey });
      s.stop(`Signed in${status.org ? ` ${c.dim(`(${status.org})`)}` : ""}`);
      return true;
    }
    // status === "pending": keep polling.
  }
}

export function hasConfiguredKey(): boolean {
  return Boolean(readConfig().apiKey) || Boolean(process.env.CHIFU_API_KEY);
}
