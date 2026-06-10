---
name: chifu-dep-guard
description: >-
  Check the project's dependencies for known security vulnerabilities (CVEs) and
  report them to the user — NEVER edit dependency versions, lockfiles, or
  overrides yourself. Use this whenever you add, upgrade, pin, or change a
  dependency (editing package.json, etc.), ALWAYS right before you run `git
  commit`, before opening a pull request, and before finishing a task that
  touched dependencies. Also use when the user asks to audit, check, or secure
  dependencies.
---

# chifu dep-guard

You changed dependencies. Before the work is done, check whether any have known
vulnerabilities and **report what you find to the user**. `chifu` does the
detection; you surface the results and the recommended upgrades. You do **not**
change dependency versions yourself — that decision, and applying it, belongs to
the user.

## ⛔ Detect and report — never edit versions, never install

Two hard rules, no exceptions:

1. **Never edit a dependency version.** Do NOT touch `package.json`,
   `package-lock.json`, `bun.lock`, `yarn.lock`, or `pnpm-lock.yaml`, and do NOT
   add or change an `overrides` / `resolutions` entry to bump, pin, or swap a
   package. Even when chifu reports a clean one-line fix, you **describe** it —
   you do not apply it. Changing versions (especially transitive pins and
   overrides) can silently break the build or the dependency tree, and the
   change must be made and validated in the user's own environment, not
   blind-edited here.

2. **Never run a package-manager install / add / upgrade / audit-fix.** Not
   `npm install`, `npm ci`, `npm audit fix`, `yarn`, `pnpm install`,
   `bun install`, `bun update`, or any equivalent. Installing executes the
   `preinstall`/`postinstall` lifecycle scripts of the very packages you are
   vetting — arbitrary, untrusted code on this machine. That is exactly the
   supply-chain attack chifu exists to stop.

chifu reads `package.json` and the lockfile straight from disk — **nothing needs
to be installed for it to work.** The only command you run is the read-only
`chifu check`. Everything after that is a report, not an edit.

## Your job ends at the report

When `chifu check` reports vulnerable packages, your job is to make the user
fully aware of them — clearly, completely, most-severe first — and to tell them
the recommended fix for each. It is **not** to apply that fix.

For every vulnerable package, surface:

- the package name and the **installed version**,
- the **recommended version** that clears its CVEs (or note that no fix exists
  yet when `recommendedVersion` is null),
- the worst severity and how many CVEs it carries,
- the CVE ids and advisory link(s) so the user can read the detail.

Then state the exact change they could make (e.g. "bump `lodash` to `4.17.21`",
or "add an `overrides` entry pinning the transitive `foo` to `1.2.3`") as a
**recommendation the user applies themselves** — in their controlled
environment, with their own install + build + tests.

Never:

- edit a manifest, lockfile, or `overrides` / `resolutions` to change a version;
- run an install / add / upgrade to apply or "test" a fix;
- claim a dependency is safe without having run `chifu check` — you cannot know
  the current CVE state from training data;
- guess vulnerabilities yourself — only report what chifu returns.

## Run before every commit

**Run `chifu check` before every `git commit` that touched dependencies.** A
vulnerable dependency that gets committed reaches production — so surface it to
the user *before* the commit. You still don't edit versions: you report the
findings and let the user decide whether to proceed, hold, or upgrade first.

## Steps

1. **Check.** In the project root:

   ```bash
   chifu check --json
   ```

   You must be signed in — chifu needs an account. If it reports you're not
   authenticated, run `chifu login` first (or set `CHIFU_API_KEY`). If `chifu`
   isn't found, fall back to `bunx @marshell/chifu@latest check --json`. If it
   errors (no network, no `package.json`/lockfile, or not signed in), report the
   exact error and stop — never guess vulnerabilities yourself.

2. **Read the output.** `packages` is the actionable list (one entry per
   vulnerable package, collapsed to the single upgrade that clears its CVEs);
   `findings` carries per-CVE advisory detail.

   ```json
   {
     "vulnerablePackages": 1,
     "packages": [
       { "name": "lodash", "version": "4.17.4", "recommendedVersion": "4.17.21",
         "worstSeverity": "high", "cveCount": 5, "cves": ["CVE-2021-23337", "..."] }
     ],
     "findings": [
       { "name": "lodash", "version": "4.17.4", "cve": "CVE-2021-23337",
         "severity": "high", "vulnerableRange": "<4.17.21", "fixedVersion": "4.17.21",
         "advisoryUrl": "https://github.com/advisories/...", "summary": "..." }
     ]
   }
   ```

   If `vulnerablePackages` is 0, say so briefly and stop.

3. **Report — do not edit, do not install.** Most severe first (`worstSeverity`:
   critical → high → medium → low), list each vulnerable package with its
   installed version, `recommendedVersion`, CVE count + ids, and `advisoryUrl`,
   plus the exact upgrade you'd recommend. Make clear it is the user's to apply.
   When `recommendedVersion` is null there's no fix yet — say so and suggest
   mitigations (pin away from the vulnerable range, drop the dependency, etc.),
   but never edit or remove a dependency yourself. The user then applies any
   change in their own environment and can re-run this skill to confirm it's
   clean.

## Rules

- **Never edit dependency versions, lockfiles, or `overrides` / `resolutions`.**
  Report the recommended change; the user applies it.
- **Never run a package-manager install / add / upgrade / audit-fix command.**
  The only command this skill runs is the read-only `chifu check`.
- Never claim a dependency is safe without running `chifu check`.
- Present `recommendedVersion` as a recommendation, never as an action you take.
- Don't guess vulnerabilities from training data — only report what chifu finds.
