---
name: chifu-dep-guard
description: >-
  Run chifu check --json before EVERY git commit, git push, or pull-request
  open — regardless of whether package.json changed. Also run whenever a
  dependency is added, upgraded, pinned, or removed, and whenever the user asks
  to audit or secure dependencies. Run from the directory that contains
  package.json (not necessarily the git root). Fix what chifu finds by editing
  package.json, then loop until the check comes back clean.
---

# chifu dep-guard

Before committing, pushing, or finishing any task that touched dependencies,
run `chifu check --json`, fix every vulnerable package it finds by editing
`package.json`, and loop until the check is clean. `chifu` does the detection;
**you do the fixing — by editing files, never by installing.**

## ⛔ Rule 0 — NEVER run an install

`chifu check` reads `package.json` and the lockfile **straight from disk**. It
needs **nothing installed** to run. Never run:

> `npm install` / `npm ci` / `npm audit fix` / `yarn` / `pnpm install` /
> `bun install` / `bun update` — or anything that writes `node_modules` or
> downloads packages.

An install executes the `preinstall`/`postinstall` scripts of the packages you
are vetting — arbitrary, untrusted code — *before chifu inspects them*. That
is the exact supply-chain attack chifu exists to catch.

The **one exception**: after editing `package.json` you may run

```bash
npm install --package-lock-only --ignore-scripts
```

to re-resolve the lockfile. This rewrites `package-lock.json` without
downloading, building, or executing any package. Nothing else.

## ⛔ Rule 1 — use `recommendedVersion` verbatim; never invent versions

Always set the exact `recommendedVersion` chifu returns. A made-up version
(e.g. `lodash@4.18.0`, which does not exist) can resolve to a malicious or
typosquatted package. If chifu returns `recommendedVersion: null`, there is no
fix yet — tell the user and suggest mitigations; do not guess a version.

## Fix loop — your job is not done until the check is clean

When `chifu check` reports vulnerable packages, drive this loop yourself until
`vulnerablePackages` is 0 (or only `recommendedVersion: null` entries remain):

```
chifu check --json
  → edit package.json (versions + overrides)
  → npm install --package-lock-only --ignore-scripts
  → chifu check --json
  → repeat
```

Never stop after a single pass — one version bump can surface a new transitive
vulnerability, so keep looping until the check is clean.

## Steps

1. **Check — do not install first.** Run from the directory that contains
   `package.json` (e.g. `frontend/`, not the git root if they differ):

   ```bash
   chifu check --json
   ```

   You must be signed in. If it reports you're not authenticated, run
   `chifu login` first (or set `CHIFU_API_KEY`). If `chifu` isn't found,
   fall back to `bunx @marshell/chifu@latest check --json`. If it errors
   (no network, no `package.json`, or not signed in), report the exact
   error and stop — never guess vulnerabilities yourself.

2. **Read the output.** `packages` is the actionable list; `findings` carries
   per-CVE detail.

   ```json
   {
     "vulnerablePackages": 1,
     "packages": [
       { "name": "lodash", "version": "4.17.4", "recommendedVersion": "4.17.21",
         "worstSeverity": "high", "cveCount": 5, "cves": ["CVE-2021-23337"] }
     ],
     "findings": [
       { "name": "lodash", "version": "4.17.4", "cve": "CVE-2021-23337",
         "severity": "high", "vulnerableRange": "<4.17.21", "fixedVersion": "4.17.21",
         "advisoryUrl": "https://github.com/advisories/...", "summary": "..." }
     ]
   }
   ```

   If the output also contains an `update` object (e.g.
   `{ "status": "updated", "from": "0.2.0", "to": "0.3.0" }`), tell the
   user in one line: the new version takes effect on the next run. If
   `vulnerablePackages` is 0, say so briefly and stop.

3. **Fix — edit files, do not install.** Most-severe first:

   - **Direct dep** — edit the version in `package.json` `dependencies` /
     `devDependencies` to `recommendedVersion` (verbatim).
   - **Transitive dep** — add or update an `overrides` (npm/bun) or
     `resolutions` (yarn) entry in `package.json`.
   - **Breaking-change bump** — if the fix is a major version bump, read the
     `advisoryUrl` and the package changelog to understand what changed, then
     fix call sites by static review. Do **not** install the package to "test"
     it.
   - After editing, run `npm install --package-lock-only --ignore-scripts` so
     chifu can re-read the full resolved tree on the next check.

4. **Re-check.** Run `chifu check --json` again against the edited files.
   Repeat steps 3–4 until `vulnerablePackages` is 0.

5. **Report.** Tell the user: which packages were bumped (from → to), which
   overrides were added, and any call-site code you changed for breaking
   changes. Remind them to run their normal `npm install` + build + tests
   **themselves** to apply and validate — that belongs in their controlled
   environment, not this session.

## Rules

- **Never run `npm install` / `bun install` / `yarn` / audit-fix.** The only
  allowed install-adjacent command is `npm install --package-lock-only
  --ignore-scripts`.
- **Use `recommendedVersion` verbatim.** Never invent or round a version.
- **Loop until clean.** Never end the turn with a fixable vulnerability open.
- **Handle breaking changes by reading, not running.** Fix call sites
  statically; do not install to test.
- **If `recommendedVersion` is null**, report it and suggest mitigations
  (drop the dep, pin away from the vulnerable range) — but never remove a
  dependency without asking.
- **Never claim a dependency is safe** without running `chifu check`.
