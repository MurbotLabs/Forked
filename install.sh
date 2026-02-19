#!/usr/bin/env bash
set -e

FORKED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STANDARD_DIR="$HOME/forked"
OC_CONFIG="$HOME/.openclaw/openclaw.json"

echo ""
echo "  ███████╗ ██████╗ ██████╗ ██╗  ██╗███████╗██████╗ "
echo "  ██╔════╝██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝██╔══██╗"
echo "  █████╗  ██║   ██║██████╔╝█████╔╝ █████╗  ██║  ██║"
echo "  ██╔══╝  ██║   ██║██╔══██╗██╔═██╗ ██╔══╝  ██║  ██║"
echo "  ██║     ╚██████╔╝██║  ██║██║  ██╗███████╗██████╔╝"
echo "  ╚═╝      ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝ "
echo ""
echo "  Time-Travel Debugger — Installer"
echo ""

# ── Path check ────────────────────────────────────────────────────────────────

if [ "$FORKED_DIR" = "$STANDARD_DIR" ]; then
  echo "  [ok] Installing from standard path: $STANDARD_DIR"
else
  echo "  [!] Non-standard install path detected."
  echo "      Current : $FORKED_DIR"
  echo "      Standard: $STANDARD_DIR"
  echo ""
  echo "  The standard path makes setup identical for everyone."
  echo "  To use the standard path, exit and re-clone:"
  echo ""
  echo "      git clone https://github.com/MurbotLabs/Forked.git ~/forked"
  echo "      cd ~/forked && ./install.sh"
  echo ""
  printf "  Continue installing from %s? [y/N] " "$FORKED_DIR"
  read -r answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "  Aborted."
    exit 0
  fi
fi

echo ""

# ── Checks ────────────────────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  echo "  [error] Node.js is required but not found in PATH."
  echo "          Install Node.js (v18+) from https://nodejs.org and re-run."
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "  [error] Node.js v18+ required. Found: $(node --version)"
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "  [error] npm is required but not found in PATH."
  exit 1
fi

if [ ! -f "$OC_CONFIG" ]; then
  echo "  [error] OpenClaw config not found at $OC_CONFIG"
  echo "          Make sure OpenClaw is installed and configured before running this."
  exit 1
fi

echo "  [ok] Node $(node --version) / npm $(npm --version)"
echo "  [ok] OpenClaw config found"
echo ""

# ── Install dependencies ───────────────────────────────────────────────────────

install_deps() {
  local dir="$1"
  local name="$2"
  echo "  [+] Installing $name dependencies..."
  (cd "$dir" && npm install --silent 2>&1 | grep -v "^npm warn" | grep -v "^$" || true)
  echo "  [ok] $name ready"
}

install_deps "$FORKED_DIR/forked-tracer"  "forked-tracer"
install_deps "$FORKED_DIR/forked-daemon"  "forked-daemon"
install_deps "$FORKED_DIR/forked-ui"      "forked-ui"

echo ""

# ── Patch ~/.openclaw/openclaw.json ──────────────────────────────────────────

TRACER_PATH="$FORKED_DIR/forked-tracer"

echo "  [+] Configuring OpenClaw to load the Forked tracer..."

node --input-type=module <<EOF
import { readFileSync, writeFileSync } from "fs";

const configPath = "$OC_CONFIG";
const tracerPath = "$TRACER_PATH";

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf-8"));
} catch (e) {
  console.error("  [error] Could not parse OpenClaw config:", e.message);
  process.exit(1);
}

config.plugins ??= {};
config.plugins.load ??= {};
config.plugins.load.paths ??= [];

// Remove any stale forked-tracer paths, then add ours
config.plugins.load.paths = config.plugins.load.paths
  .filter(p => !p.includes("forked-tracer"))
  .concat(tracerPath);

config.plugins.entries ??= {};
config.plugins.entries["forked-tracer"] ??= {};
config.plugins.entries["forked-tracer"].enabled = true;

writeFileSync(configPath, JSON.stringify(config, null, 4) + "\n");
console.log("  [ok] OpenClaw config updated");
EOF

# ── Make CLI executable ────────────────────────────────────────────────────────

chmod +x "$FORKED_DIR/forked"
echo "  [ok] forked CLI is executable"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "  ✓ Forked installed successfully!"
echo ""
echo "  ─────────────────────────────────────────────────"
echo "  FINAL STEP — add forked to your PATH"
echo ""
echo "  Paste this line into your ~/.zshrc or ~/.bashrc:"
echo ""
echo "      export PATH=\"$FORKED_DIR:\$PATH\""
echo ""
echo "  Then reload your shell:"
echo ""
echo "      source ~/.zshrc"
echo ""
echo "  ─────────────────────────────────────────────────"
echo "  HOW TO USE"
echo ""
echo "  1. Start your OpenClaw gateway as normal."
echo "     The Forked daemon starts automatically when the gateway loads."
echo ""
echo "  2. Launch the Forked UI:"
echo ""
echo "       forked run ui"
echo ""
echo "  ─────────────────────────────────────────────────"
echo ""
