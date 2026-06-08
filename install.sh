#!/usr/bin/env sh
# chifu-wizard bootstrap (macOS / Linux)
#
# Usage:
#   curl -fsSL https://marshell.dev/install.sh | sh
#
# Installs Bun if it's missing, then runs the chifu setup wizard via bunx.
# Any extra args are forwarded to the wizard, e.g.:
#   curl -fsSL https://marshell.dev/install.sh | sh -s -- --yes

set -eu

info() { printf '\033[36m→\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!\033[0m %s\n' "$1"; }

# Find an existing bun, including the default install location that may not be
# on PATH yet within this shell.
find_bun() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi
  if [ -x "$HOME/.bun/bin/bun" ]; then
    echo "$HOME/.bun/bin/bun"
    return 0
  fi
  return 1
}

if BUN_BIN="$(find_bun)"; then
  info "Found Bun at $BUN_BIN"
else
  info "Bun not found — installing it (https://bun.sh)…"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://bun.sh/install | bash
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://bun.sh/install | bash
  else
    warn "Need curl or wget to install Bun. Install Bun manually from https://bun.sh then re-run."
    exit 1
  fi
  # Bun installs to ~/.bun/bin by default; pick it up for this session.
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! BUN_BIN="$(find_bun)"; then
    warn "Bun installed but couldn't be located. Open a new terminal and run: bunx @marshell/chifu-wizard"
    exit 1
  fi
  info "Bun installed."
fi

info "Launching the chifu wizard…"
# Forward any args passed after `-s --` to the wizard.
exec "$BUN_BIN" x @marshell/chifu-wizard "$@"
