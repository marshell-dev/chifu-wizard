// `chifu-wizard --agent` — emit (never execute) a self-contained onboarding
// prompt that an *external* coding agent can read and follow to set chifu up by
// itself.
//
// The contract: this is prompt text only, with zero side effects. A user pipes
// it into their agent ("here, do this") and the agent installs the CLI, gets a
// key, and confirms the skill is wired up. We deliberately keep it terse,
// imperative, and copy-paste-safe — no colors, no banners, just instructions.

// Kept as a plain template so it round-trips cleanly through a pipe and is easy
// to diff. Nothing here touches the filesystem, the network, or argv.
export const AGENT_PROMPT = `You are setting up chifu so this coding agent becomes dependency-security aware.
chifu checks the project's dependencies against known CVEs so you can fix what
you introduced before it ships. Follow these steps exactly. Do not skip the
verification step. If a step fails, report the failure and stop — do not guess.

1. Detect a runtime. Check for bun first, then node:
     bun --version
     node --version
   Bun is preferred. If neither exists, tell the user to install Bun
   (https://bun.sh) or Node 18+ and stop.

2. Install the chifu CLI globally (skip if \`chifu --version\` already works):
     bun add -g @marshell/chifu        # if bun is available
     npm install -g @marshell/chifu    # otherwise
   The CLI also runs without a global install via \`bunx @marshell/chifu\`, so
   treat a failed global install as non-fatal and use the bunx form below.

3. Authenticate (optional — chifu works anonymously, a key just syncs results to
   the dashboard). Offer the user two choices and let them pick:
     a. Browser device-pairing:  chifu login
        This prints a URL/code to confirm in the browser. Hand the URL to the
        user; wait for them to approve.
     b. Manual key: tell the user to copy a key from the dashboard
        (https://app.marshell.dev) and run:  chifu login chf_xxx
   If the user wants to stay anonymous, skip this step.

4. Confirm the CLI works by running a real check in the project root:
     chifu check --json     # or: bunx @marshell/chifu check --json
   It must exit and return JSON. If it errors, surface the message and stop.

5. Confirm the chifu skill/rule is installed for THIS agent so you reach for it
   automatically. Run the official installer, which detects this agent and
   writes the skill to the right place:
     bunx @marshell/chifu-wizard --yes
   Then verify a chifu instruction file now exists for your agent (e.g. a
   Claude Code skill, a Cursor rule, or a "## chifu" block in AGENTS.md).

6. Report a one-line summary: runtime found, whether the CLI is installed,
   whether a key was saved or you're running anonymously, and that \`chifu check\`
   succeeded. From now on, run \`chifu check --json\` and fix what it reports
   whenever you add, upgrade, or change a dependency.
`;

// Print the prompt to stdout with a trailing newline. Returns nothing; the
// caller decides the exit code.
export function printAgentPrompt(): void {
  process.stdout.write(AGENT_PROMPT.endsWith("\n") ? AGENT_PROMPT : AGENT_PROMPT + "\n");
}
