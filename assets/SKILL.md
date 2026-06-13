---
name: chifu-dep-guard
description: >-
  Run chifu check --json before EVERY git commit, git push, or pull-request
  open — regardless of whether package.json changed. Also run whenever a
  dependency is added, upgraded, pinned, or removed, and whenever the user asks
  to audit or secure dependencies. Run from the directory that contains
  package.json (not necessarily the git root). NEVER run npm/bun/yarn install
  as part of this check. Report findings; do not edit versions or lockfiles.
---

# chifu dep-guard

You changed dependencies. Before the work is done, check whether any have known
vulnerabilities and **report what you find to the user**. `chifu` does the
detection; you surface the results and the recommended upgrades. You do **not**
install anything and you do **not** change versions — applying a fix belongs to
the user, in their own environment.

## ⛔ Rule 0 — NEVER run an install, and never before `chifu check`

`chifu check` reads `package.json` and the lockfile **straight from disk**. It
needs **nothing installed** to run. So:

> **Do NOT run `npm install` / `npm ci` / `npm audit` / `npm audit fix` /
> `yarn` / `pnpm install` / `bun install` / `bun update` — or anything that
> writes `node_modules` or generates a lockfile — at any point in this task.**

Most important: never run one **before** `chifu check`. An install executes the
`preinstall`/`postinstall` lifecycle scripts of the very dependencies you are
vetting — arbitrary, untrusted code — *before chifu ever inspects them*. That is
the exact supply-chain attack chifu exists to catch. Running it yourself, even
"just to check", defeats the entire tool.

None of these are exceptions — each one **is** the mistake:

- ❌ "I'll install to generate a `package-lock.json` so the scan covers the full
  tree." No. A missing lockfile means you **report reduced coverage**; you never
  create one by installing. The user generates it later, in their environment.
- ❌ "I'll install to test that the fix works." No. You are not applying fixes
  (Rule 1), so there is nothing to test — and "testing" runs the package.
- ❌ "`npm audit` only reads, it's fine." No. It is not chifu and it needs the
  installed/locked tree. Use `chifu check`, nothing else.

If you are about to type an install command, **STOP** — that is precisely the
failure this skill prevents. The only command you run is the read-only
`chifu check`.

## ⛔ Rule 1 — report only; never edit versions

Do NOT touch `package.json`, `package-lock.json`, `bun.lock`, `yarn.lock`, or
`pnpm-lock.yaml`, and do NOT add or change an `overrides` / `resolutions` entry
to bump, pin, or swap a package. Even when chifu reports a clean one-line fix,
you **describe** it — you do not apply it. Changing versions (especially
transitive pins and overrides) can silently break the build or the dependency
tree, and the change must be made and validated in the user's own environment.

A specific trap: **never invent, round, or "upgrade to latest" a version from
memory.** Report `recommendedVersion` **exactly** as chifu returns it, verbatim.
A made-up version — e.g. a `lodash@4.18.0` that doesn't exist (the real line ends
at `4.17.21`) — can resolve to a malicious or typosquatted package, and you must
never be the one who installs it anyway. If chifu gives no `recommendedVersion`,
say there's no fix yet; do not guess one.

## Your job ends at the report

When `chifu check` reports vulnerable packages, your job is to make the user
fully aware of them — clearly, completely, most-severe first — and to tell them
the recommended fix for each. It is **not** to apply that fix.

For every vulnerable package, surface:

- the package name and the **installed version**,
- the **recommended version** that clears its CVEs (verbatim from chifu, or note
  that no fix exists yet when `recommendedVersion` is null),
- the worst severity and how many CVEs it carries,
- the CVE ids and advisory link(s) so the user can read the detail.

Then state the change they could make (e.g. "bump `lodash` to `4.17.21`") as a
**recommendation the user applies themselves** — in their controlled
environment, with their own install + build + tests.

## Run before every commit

**Run `chifu check` before every `git commit` that touched dependencies** — and
again, *without* installing first. A vulnerable dependency that gets committed
reaches production, so surface it to the user before the commit. You still don't
install and don't edit versions: you report, and the user decides whether to
proceed, hold, or upgrade.

## Steps

1. **Check — do not install first.** Run from the directory that contains
   `package.json` (e.g. `frontend/`, not the git root if they differ), against
   whatever is already on disk (do **not** run `npm install` to "prepare"):

   ```bash
   chifu check --json
   ```

   You must be signed in — chifu needs an account. If it reports you're not
   authenticated, run `chifu login` first (or set `CHIFU_API_KEY`). If `chifu`
   isn't found, fall back to `bunx @marshell/chifu@latest check --json`. If it
   errors (no network, no `package.json`, or not signed in), report the exact
   error and stop — never guess vulnerabilities yourself, and never `npm install`
   to "fix" a missing-lockfile message.

2. **Read the output.** `packages` is the actionable list (one entry per
   vulnerable package, collapsed to the single upgrade that clears its CVEs);
   `findings` carries per-CVE advisory detail.

   ```json
   {
     "update": null,
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

   The output may also carry an `update` object — when present, chifu upgraded
   itself in the background before this check (e.g.
   `{ "status": "updated", "from": "0.2.0", "to": "0.3.0" }`). Tell the user in
   one line when it's there: `"status": "updated"` means the new version
   installed and takes effect on the next run; `"status": "failed"` means a newer
   version was available but couldn't auto-install. When `update` is `null`, say
   nothing about updates.

   If `vulnerablePackages` is 0, say so briefly and stop.

3. **Report — do not edit, do not install.** Most severe first, list each
   vulnerable package with its installed version, `recommendedVersion` (verbatim),
   CVE count + ids, and `advisoryUrl`, plus the exact upgrade you'd recommend.
   Make clear it is the user's to apply. When `recommendedVersion` is null there's
   no fix yet — say so and suggest mitigations (drop the dependency, pin away from
   the vulnerable range), but never edit, install, or remove anything yourself.
   The user applies the change in their own environment and can re-run this skill
   to confirm it's clean.

## Rules

- **Never run an install / add / upgrade / audit / audit-fix — ever, and never
  before `chifu check`.** `chifu check` is the only command this skill runs.
- **Never edit dependency versions, lockfiles, or `overrides` / `resolutions`.**
  Report the recommended change; the user applies it.
- **Never generate a lockfile or `node_modules` by installing** — a missing
  lockfile is reduced coverage you report, not something you fix.
- Report `recommendedVersion` verbatim; never invent or "upgrade to latest" a
  version from memory.
- Never claim a dependency is safe without running `chifu check`; only report
  what chifu returns.
