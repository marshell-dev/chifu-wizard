// Step 3 — Sign in (browser pairing, the same poll flow as `chifu login`).
//
// The wizard mints a pairing session, opens the onboarding page (which carries
// the sid + code), and POLLS the backend until the logged-in browser authorizes
// the device — no manual code paste. On success it writes the freshly-minted
// chf_ key to the chifu config (the exact path + format the CLI reads). chifu
// works anonymously, so this is skippable.
//
// We do the session create + poll inline (rather than shelling out to
// `chifu login`) so the wizard's sign-in works regardless of which CLI version
// is installed, and so the wizard package stays standalone.
//
// Backend responses are validated with zod before use; the local chifu config is
// parsed with jsonc-parser so a hand-edited (possibly commented) config.json
// doesn't crash the read.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  // --yes / --ci: no browser prompt; stay anonymous unless apiKey was given.
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

// Mint a pairing session (POST /api/v1/cli/session, no auth). Mirrors the CLI's
// postCliSessionCreate so the two stay on the same contract.
async function createSession(apiUrl: string): Promise<SessionCreate> {
  const res = await fetch(`${apiUrl}/api/v1/cli/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const raw = (await res.json().catch(() => null)) as unknown;
  const env = envelopeSchema(SessionCreateSchema).safeParse(raw);
  if (!res.ok || !env.success || env.data.error || !env.data.data) {
    const msg = env.success ? env.data.error : null;
    throw new Error(msg || `sign-in failed (HTTP ${res.status})`);
  }
  return env.data.data;
}

// Poll a pairing session (GET /api/v1/cli/session?sid=…, no auth). A 404/410
// (missing/expired/consumed) throws with the server's message.
async function pollSession(apiUrl: string, sid: string): Promise<SessionStatus> {
  const res = await fetch(`${apiUrl}/api/v1/cli/session?sid=${encodeURIComponent(sid)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
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

  // Mint a session, then open the browser to the onboarding page.
  let session: SessionCreate;
  try {
    session = await createSession(opts.apiUrl);
  } catch (err) {
    log.fail(`Couldn't start sign-in (${(err as Error).message}) — continuing anonymously`);
    return false;
  }

  const onboardingUrl =
    `${opts.webUrl}/cli-onboarding?code=${encodeURIComponent(session.code)}` +
    `&sid=${encodeURIComponent(session.sid)}`;

  note(
    `${c.bold("Your code:")} ${c.cyan(c.bold(session.code))}\n\n` +
      `Opening ${c.dim(onboardingUrl)}\n` +
      `If the browser didn't open, paste that URL in yourself, then authorize.`,
    "Sign in to chifu",
  );
  await openBrowser(onboardingUrl);

  // Poll until authorized or the session expires (~10 min). Transient poll
  // errors don't abort — we keep trying until the deadline. A clack spinner
  // shows progress for the whole wait.
  const s = spinner();
  s.start("Waiting for you to authorize in your browser…");
  const deadline = Date.now() + Math.max(0, session.expiresInSeconds) * 1000;
  for (;;) {
    if (Date.now() >= deadline) {
      s.stop("Timed out — continuing anonymously; run `chifu login` later", 1);
      return false;
    }

    await sleep(POLL_INTERVAL_MS);

    let status: SessionStatus;
    try {
      status = await pollSession(opts.apiUrl, session.sid);
    } catch (err) {
      const msg = (err as Error).message;
      // A 404/410 means the session is gone — unrecoverable, stop polling.
      if (/expired|not found|consumed|410|404/i.test(msg)) {
        s.stop(`${msg} — continuing anonymously; run \`chifu login\` later`, 1);
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
