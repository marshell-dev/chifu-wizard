---
name: chifu-dep-guard
description: >-
  Check the project's dependencies for known security vulnerabilities (CVEs) and
  fix them. Use this whenever you add, install, upgrade, pin, or change a
  dependency (e.g. editing package.json, running npm/bun/yarn install),
  ALWAYS right before you run `git commit`, before opening a pull request, and
  before finishing a task that touched dependencies. Also use when the user asks
  to audit, check, or secure dependencies.
---

# chifu dep-guard

You introduced or changed dependencies. Before you consider the work done, make
sure none of them have known vulnerabilities — and fix the ones that do. The
`chifu` CLI does the detection; **you** do the fixing.

**Run `chifu check` before every `git commit`.** A vulnerable dependency that
gets committed ends up in production — so catch and fix it *before* the commit,
never after. If you're about to commit and there are unfixed vulnerable
packages, fix them first (or tell the user why you can't) and only then commit.

## Steps

1. **Check.** Run the CLI in the project root and read the JSON:

   ```bash
   chifu check --json
   ```

   This works without any account or API key — no login step needed. If the
   command isn't found, fall back to `bunx @marshell/chifu check --json`. If it still
   fails (e.g. no network, or no `package.json`/lockfile in the path), report
   the exact error to the user and stop — do not guess vulnerabilities yourself.

2. **Read the output.** `packages` is the actionable list (one entry per
   vulnerable package, already collapsed to the single upgrade that clears all
   of its CVEs); `findings` carries the per-CVE advisory detail. The shape below
   shows the fields you act on (the full object also includes `ecosystem`,
   `scanned`, `source`, and `synced` — ignore those when fixing):

   ```json
   {
     "vulnerablePackages": 1,
     "packages": [
       {
         "name": "lodash",
         "version": "4.17.4",
         "recommendedVersion": "4.18.0",
         "worstSeverity": "critical",
         "cveCount": 8,
         "cves": ["CVE-2019-10744", "CVE-2021-23337", "..."]
       }
     ],
     "findings": [
       {
         "name": "lodash",
         "version": "4.17.4",
         "cve": "CVE-2021-23337",
         "severity": "high",
         "vulnerableRange": "<4.17.21",
         "fixedVersion": "4.17.21",
         "advisoryUrl": "https://github.com/advisories/...",
         "summary": "..."
       }
     ]
   }
   ```

   If `packages` is empty (`vulnerablePackages` is 0), you're done — say so
   briefly and stop.

3. **Fix each package in `packages`**, most severe first (`worstSeverity`:
   critical → high → medium → low):
   - Upgrade it to `recommendedVersion` (update `package.json` and the lockfile,
     e.g. `npm install <name>@<recommendedVersion>` or the project's package
     manager). One bump to `recommendedVersion` clears every CVE for that
     package. If `recommendedVersion` is null, there's no fix yet — tell the user
     and suggest mitigations; don't remove the dependency without asking.
   - **Handle breaking changes.** A version bump (especially a major) can break
     the code that uses the package. Find this package's entries in `findings`
     (match on `name`), open each `advisoryUrl`, read the changelog, and update
     the calling code so it still works. Do not leave the build broken.

4. **Re-run `chifu check --json`** after fixing. Repeat steps 3-4 until
   `packages` is empty (a fix can pull in a new transitive vuln).

5. **Verify and report.** Run the project's build/tests if available, then give
   the user a short summary: which packages you upgraded, from→to versions, and
   any code you changed to handle breaking changes.

## Rules

- Never claim a dependency is safe without running `chifu check` — you cannot
  know the current CVE state from training data.
- Don't blindly bump major versions; read the advisory and fix the usage.
- Keep upgrades scoped to what's vulnerable plus the minimum needed to make it
  build — don't opportunistically upgrade unrelated packages.
