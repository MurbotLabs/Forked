#!/usr/bin/env bash
set -e

FORKED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
  if ! (cd "$dir" && npm install 2>&1 | grep -v "^npm warn" | grep -v "^$"); then
    echo "  [error] npm install failed for $name — see output above"
    exit 1
  fi
  echo "  [ok] $name ready"
}

install_deps "$FORKED_DIR/forked-tracer"  "forked-tracer"
install_deps "$FORKED_DIR/forked-daemon"  "forked-daemon"
install_deps "$FORKED_DIR/forked-ui"      "forked-ui"

echo ""

# ── Patch ~/.openclaw/openclaw.json ───────────────────────────────────────────

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

# ── Make CLIs executable ───────────────────────────────────────────────────────

chmod +x "$FORKED_DIR/forked"
chmod +x "$FORKED_DIR/uninstall.sh"
echo "  [ok] forked CLI is executable"

# ── Auto-add to PATH ───────────────────────────────────────────────────────────

PATH_LINE="export PATH=\"$FORKED_DIR:\$PATH\""

# Detect shell rc file(s)
if [ -n "$ZSH_VERSION" ] || [[ "$SHELL" == */zsh ]]; then
  RC_FILES=("$HOME/.zshrc")
elif [[ "$(uname)" == "Darwin" ]]; then
  # macOS: bash_profile is the login shell file
  RC_FILES=("$HOME/.bash_profile")
else
  # Linux VPS: SSH login shells read ~/.profile, NOT ~/.bashrc
  # Add to both so it works for login shells and interactive shells
  RC_FILES=("$HOME/.profile" "$HOME/.bashrc")
fi

for RC_FILE in "${RC_FILES[@]}"; do
  if grep -qF "$FORKED_DIR" "$RC_FILE" 2>/dev/null; then
    echo "  [ok] PATH already configured in $RC_FILE"
  else
    echo "" >> "$RC_FILE"
    echo "# Forked — Time-Travel Debugger" >> "$RC_FILE"
    echo "$PATH_LINE" >> "$RC_FILE"
    echo "  [ok] Added forked to PATH in $RC_FILE"
  fi
done

# ── Symlink into ~/.local/bin (already in PATH on modern Linux — no source needed) ──

if [[ "$(uname)" != "Darwin" ]]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$FORKED_DIR/forked" "$HOME/.local/bin/forked"
  echo "  [ok] Symlinked forked -> ~/.local/bin/forked"
fi

# ── Restart gateway if already running ────────────────────────────────────────

echo ""
echo "  [+] Restarting OpenClaw gateway to load the Forked tracer..."
if command -v openclaw &>/dev/null; then
  openclaw gateway stop 2>/dev/null || true
  sleep 1
  openclaw gateway start 2>/dev/null || true
  echo "  [ok] Gateway restarted"
else
  echo "  [skip] openclaw not in PATH yet — start your gateway manually after setup"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
  echo "  ✓ Forked installed successfully!"
  echo ""
  echo "  ─────────────────────────────────────────────────"
  if [[ "$(uname)" != "Darwin" ]]; then
    echo "  Open a new terminal (or run: source ~/.bashrc)"
    echo "  then start the UI:"
  else
    echo "  Open a new terminal (or run: source ${RC_FILES[0]})"
    echo "  then start the UI:"
  fi
  echo ""
  echo "      forked run ui"
  echo "  ─────────────────────────────────────────────────"
echo ""
