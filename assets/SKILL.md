---
name: chifu-dep-guard
description: >-
  Check the project's dependencies for known security vulnerabilities (CVEs) and
  fix them WITHOUT installing untrusted packages. Use this whenever you add,
  upgrade, pin, or change a dependency (editing package.json, etc.), ALWAYS right
  before you run `git commit`, before opening a pull request, and before
  finishing a task that touched dependencies. Also use when the user asks to
  audit, check, or secure dependencies.
---

# chifu dep-guard

You changed dependencies. Before the work is done, make sure none have known
vulnerabilities — and fix the ones that do. `chifu` does the detection; **you**
do the fixing, **by editing files — never by installing.**

## ⛔ Never run an install while checking or fixing

**Do NOT run `npm install`, `npm ci`, `npm audit fix`, `yarn`, `pnpm install`,
`bun install`, or any package-manager install/add command** as part of this
work. Installing executes the `preinstall`/`postinstall` lifecycle scripts of the
very packages you are vetting — arbitrary, untrusted code on this machine. That
is exactly the supply-chain attack chifu exists to stop; running it defeats the
entire purpose, even just to "re-check" or "test the fix."

chifu reads `package.json` and the lockfile straight from disk — **nothing needs
to be installed for it to work.** You fix by editing the manifest and re-checking
with chifu. The real `npm install` + build + tests happen later, in the user's
own controlled environment or CI — not here, not by you.

The **only** install-adjacent command allowed — and only when you must re-resolve
transitive versions (e.g. after adding an `overrides`/`resolutions` entry) — is:

```bash
npm install --package-lock-only --ignore-scripts
```

It rewrites `package-lock.json` to reflect your edits **without downloading,
building, or executing any package**. Nothing else.

## Finish the job — the manifest is yours to change

Not being allowed to install is **not** a reason to leave a vulnerability
unfixed, and it is **never** an excuse to stop early or hand the task back
half-done. You have full authority and capability to do the fix: editing
`package.json` (and `overrides` / `resolutions`) is a plain text edit, always
available to you, requiring nobody's permission. Use it decisively.

When `chifu check` reports vulnerable packages, your task is **not done** until
one of these is true:

- `chifu check` reports `vulnerablePackages: 0`, **or**
- the only packages left have `recommendedVersion: null` (no fix exists yet) —
  and you've told the user which ones and why.

Drive the loop yourself until then:

> edit `package.json` (versions + `overrides`) → `npm install --package-lock-only
> --ignore-scripts` → `chifu check --json` → repeat.

Never:

- skip a fixable package because "the user needs to run install" — **you** edit
  the version, that edit *is* the fix;
- stop after a single pass — one bump can surface a new transitive vuln, so loop
  until the check comes back clean;
- treat the install ban as a blocker — it only forbids *executing* packages, not
  changing their declared versions, which you do freely.

The final, clean `chifu check` is mandatory: ending the turn without it means you
don't actually know the task is done.

## Run before every commit

**Run `chifu check` before every `git commit`.** A vulnerable dependency that
gets committed reaches production — catch and fix it before the commit, not after.

## Steps

1. **Check.** In the project root:

   ```bash
   chifu check --json
   ```

   No account or API key needed. If `chifu` isn't found, fall back to
   `bunx @marshell/chifu@latest check --json`. If it errors (no network, or no
   `package.json`/lockfile), report the exact error and stop — never guess
   vulnerabilities yourself.

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

3. **Fix — by editing files, not installing.** Most severe first
   (`worstSeverity`: critical → high → medium → low):
   - **Edit `package.json`** (and add an `overrides` / `resolutions` entry for
     vulnerable *transitive* deps) to the `recommendedVersion`. One bump clears
     every CVE for that package. If `recommendedVersion` is null there's no fix
     yet — tell the user and suggest mitigations; don't remove a dependency
     without asking.
   - If — and only if — you need the transitive tree re-resolved so chifu can
     re-check it, run `npm install --package-lock-only --ignore-scripts` (no
     code execution). Never a plain install.
   - **Handle breaking changes by reading, not running.** A major bump can break
     calling code. Read each `advisoryUrl` and the package's changelog, then fix
     the call sites by static review. Do **not** install + run the package to
     "test" it — that is the exact execution we're avoiding.

4. **Re-check.** Run `chifu check --json` again — it reads your edited files
   straight from disk. Repeat steps 3–4 until `vulnerablePackages` is 0.

5. **Report — don't install.** Summarize: packages upgraded (from → to),
   overrides added, and any code you changed for breaking changes. Tell the user
   to run their normal `npm install` + build + tests **themselves** to apply and
   validate — that belongs in their controlled environment, not this session.

## Rules

- **Never run a package-manager install / add / audit-fix command.** The single
  exception is `npm install --package-lock-only --ignore-scripts`.
- Never claim a dependency is safe without running `chifu check` — you can't know
  the current CVE state from training data.
- Don't blindly bump majors; read the advisory and fix the usage statically.
- Keep changes scoped to what's vulnerable plus the minimum to stay consistent —
  don't opportunistically upgrade unrelated packages.
- Never end the turn with a fixable vulnerability outstanding. The manifest edit
  is always within your power — keep looping until the check is clean (or only
  `recommendedVersion: null` packages remain).
