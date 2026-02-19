#!/usr/bin/env bash
set -e

FORKED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OC_CONFIG="$HOME/.openclaw/openclaw.json"

echo ""
echo "  Forked — Uninstaller"
echo ""

# ── Remove tracer from OpenClaw config ────────────────────────────────────────

if [ -f "$OC_CONFIG" ]; then
  echo "  [+] Removing Forked tracer from OpenClaw config..."
  node --input-type=module <<EOF
import { readFileSync, writeFileSync } from "fs";

const configPath = "$OC_CONFIG";
let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf-8"));
} catch (e) {
  console.error("  [error] Could not parse OpenClaw config:", e.message);
  process.exit(1);
}

// Remove forked-tracer from load paths
if (Array.isArray(config.plugins?.load?.paths)) {
  config.plugins.load.paths = config.plugins.load.paths.filter(
    (p) => !p.includes("forked-tracer")
  );
}

// Remove forked-tracer from entries
if (config.plugins?.entries?.["forked-tracer"] !== undefined) {
  delete config.plugins.entries["forked-tracer"];
}

writeFileSync(configPath, JSON.stringify(config, null, 4) + "\n");
console.log("  [ok] OpenClaw config cleaned up");
EOF
else
  echo "  [skip] OpenClaw config not found, skipping"
fi

# ── Kill daemon if running ─────────────────────────────────────────────────────

echo "  [+] Stopping Forked daemon (if running)..."
pkill -f "node.*forked-daemon/index.js" 2>/dev/null && echo "  [ok] Daemon stopped" || echo "  [ok] Daemon was not running"

# ── Optionally delete trace database ──────────────────────────────────────────

DB_FILE="$FORKED_DIR/forked-daemon/forked.db"
if [ -f "$DB_FILE" ]; then
  echo ""
  printf "  Delete all trace data (forked.db)? This cannot be undone. [y/N] "
  read -r answer
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    rm -f "$DB_FILE" "$DB_FILE-shm" "$DB_FILE-wal"
    echo "  [ok] Trace data deleted"
  else
    echo "  [skip] Trace data kept"
  fi
fi

# ── Restart gateway to unload the tracer ──────────────────────────────────────

echo ""
echo "  [+] Restarting OpenClaw gateway to unload the tracer..."
if command -v openclaw &>/dev/null; then
  openclaw gateway stop 2>/dev/null || true
  openclaw gateway start 2>/dev/null || true
  echo "  [ok] Gateway restarted"
else
  echo "  [skip] openclaw not found in PATH — restart the gateway manually"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "  ✓ Forked uninstalled."
echo ""
echo "  ─────────────────────────────────────────────────"
echo "  FINAL STEP — remove forked from your PATH"
echo ""
echo "  Find and delete this line in your ~/.zshrc or ~/.bashrc:"
echo ""
echo "      export PATH=\"$FORKED_DIR:\$PATH\""
echo ""
echo "  Then reload your shell:"
echo ""
echo "      source ~/.zshrc"
echo ""
echo "  You can also delete the forked directory entirely:"
echo ""
echo "      rm -rf \"$FORKED_DIR\""
echo "  ─────────────────────────────────────────────────"
echo ""
