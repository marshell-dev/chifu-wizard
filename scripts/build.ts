#!/usr/bin/env bun
// Build the node-runnable bundle published to npm.
//
// The wizard source ships a `#!/usr/bin/env bun` shebang and imports .ts files
// with extensions (great for `bun run src/cli.ts` during dev), but the published
// artifact must launch under plain Node so `npx @marshell/chifu-wizard` works
// without Bun installed. `bun build --target=node` bundles everything into a
// single dist/cli.js and inlines the bundled skill read, then we rewrite the
// shebang to node. On POSIX we chmod +x; on Windows npm generates the shim.
//
// Note: assets/SKILL.md is read at runtime via paths.ts (relative to the module),
// so it is still shipped in the package "files" list and resolved next to dist/.

import { rmSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "src", "cli.ts");
const outfile = join(root, "dist", "cli.js");

// Clean previous output so a failed build can't leave a stale bundle behind.
rmSync(join(root, "dist"), { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [entry],
  target: "node",
  outdir: join(root, "dist"),
  naming: "cli.js",
});

if (!result.success) {
  for (const message of result.logs) console.error(message);
  process.exit(1);
}

// Force a Node shebang on the published bundle (source ships a bun shebang).
const NODE_SHEBANG = "#!/usr/bin/env node";
let code = readFileSync(outfile, "utf8");
if (code.startsWith("#!")) {
  code = code.replace(/^#![^\n]*\n/, `${NODE_SHEBANG}\n`);
} else {
  code = `${NODE_SHEBANG}\n${code}`;
}
writeFileSync(outfile, code);

// Make it directly executable on POSIX (npm handles the shim on Windows).
try {
  chmodSync(outfile, 0o755);
} catch {
  /* non-POSIX or restricted FS — npm's bin shim still works */
}

console.log(`built ${outfile}`);
