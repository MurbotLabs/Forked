# Forked — Time-Travel Debugger for OpenClaw

```
███████╗ ██████╗ ██████╗ ██╗  ██╗███████╗██████╗
██╔════╝██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝██╔══██╗
█████╗  ██║   ██║██████╔╝█████╔╝ █████╗  ██║  ██║
██╔══╝  ██║   ██║██╔══██╗██╔═██╗ ██╔══╝  ██║  ██║
██║     ╚██████╔╝██║  ██║██║  ██╗███████╗██████╔╝
╚═╝      ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
```

Forked is a time-travel debugger that wraps your [OpenClaw](https://openclaw.ai) agent setup. It captures every LLM call, tool use, and session event in real time, lets you rewind any run to an earlier state, and **fork** it — re-running from that point with a different model, prompt, or config — without touching your original session.

---

## What it captures

- Every LLM request and response (model, prompt, token usage)
- Every tool call and its result, with before/after file snapshots for write operations
- Session start/end and agent lifecycle events
- Config and setup file changes in your OpenClaw home directory
- Fork history — full branching timeline of any run you've replayed

---

## Prerequisites

| Requirement | Version |
|---|---|
| [OpenClaw](https://openclaw.ai) | Any — must be installed and configured |
| Node.js | v18 or later |
| npm | Comes with Node |

---

## Installation

Clone to the standard path and run the installer:

```bash
git clone https://github.com/MurbotLabs/Forked.git ~/forked
cd ~/forked
./install.sh
```

> **Why `~/forked`?** This is the standard install location. Everyone using Forked has the same path, which makes setup and troubleshooting consistent. You can install elsewhere if needed — the installer will warn you and still work.

The installer will:
1. Install dependencies for the tracer, daemon, and UI
2. Register the Forked tracer plugin with your OpenClaw config (`~/.openclaw/openclaw.json`)
3. Print the exact PATH line to copy

Add the `forked` command to your PATH by pasting this into your `~/.zshrc` or `~/.bashrc`:

```bash
export PATH="$HOME/forked:$PATH"
```

Then reload your shell:

```bash
source ~/.zshrc   # or ~/.bashrc
```

> **Re-running the installer is safe.** If you pull an update and run `./install.sh` again, it will update dependencies and re-register the plugin without touching your existing trace data.

---

## Usage

### 1. Start (or restart) your OpenClaw gateway

```bash
openclaw gateway start
```

> If your gateway was already running when you ran `install.sh`, restart it — the gateway reads plugin config at startup, so it needs a restart to pick up the Forked tracer.

The Forked daemon starts automatically in the background as soon as the gateway loads the tracer plugin. No extra step needed.

### 2. Open the Forked UI

```bash
forked run ui
```

This starts the Vite dev server and keeps it tied to your terminal — closing the terminal (or pressing `Ctrl+C`) stops the UI. Open your browser to the URL shown (typically `http://localhost:5173`).

### 3. Run your agents normally

Use OpenClaw as you always would. Traces appear in the UI in real time.

---

## UI Overview

### Traces tab

The main view. Shows all captured sessions in the left sidebar. Click a session to open its timeline — a chronological lane of every event that occurred during that run. Fork branches appear as indented sub-lanes.

**Event types shown:**

| Event | What it represents |
|---|---|
| `Session Start / End` | Agent session lifecycle |
| `LLM Request / Response` | Every call to the model, with full prompt and usage stats |
| `Tool Call / Result` | Every tool the agent used, with parameters and output |
| `Config Change` | Any change detected in your OpenClaw config files |
| `Fork` | A replayed branch of a previous run |

### Config tab

Shows a live read-out of your OpenClaw configuration — configured models (with aliases and primary indicator), agent settings, enabled channels, plugins, skills, and gateway info. Sensitive values (tokens, API keys) are never shown.

---

## Forking a run

Click the **Fork** button on any event in the timeline to open the Fork modal.

- The event's data is shown as editable JSON
- If the event contains a `model` field, a **model picker** dropdown appears — populated from your configured models — so you can switch models without manually editing JSON
- Click **Fork & Replay** to re-run the agent from that point with your changes applied

The forked run appears as a new branch in the timeline, indented under the original.

---

## Rewinding

Click the **Rewind** button (scrubber bar at the top of a timeline lane) to roll the agent's file system state back to what it was at a specific point in time. This restores any files the agent wrote or edited during the run.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  OpenClaw Gateway                               │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │  forked-tracer  (OpenClaw plugin)        │   │
│  │  Hooks into every agent event and        │   │
│  │  streams them via WebSocket to daemon    │   │
│  └──────────────┬───────────────────────────┘   │
└─────────────────│───────────────────────────────┘
                  │ ws://127.0.0.1:7999
┌─────────────────▼───────────────────────────────┐
│  forked-daemon  (Node.js / Express)             │
│  Receives traces, stores in SQLite,             │
│  exposes REST API, runs Fork Engine             │
│  http://127.0.0.1:8000                          │
└─────────────────┬───────────────────────────────┘
                  │ http://127.0.0.1:8000/api/*
┌─────────────────▼───────────────────────────────┐
│  forked-ui  (React + Vite)                      │
│  Timeline, fork editor, config viewer           │
│  http://localhost:5173                          │
└─────────────────────────────────────────────────┘
```

All communication is **localhost-only**. Nothing is exposed to the network.

---

## Troubleshooting

### UI shows "Offline"

The daemon is not running. Make sure your OpenClaw gateway is running — the daemon starts automatically when the gateway loads. Check that the tracer is enabled:

```bash
cat ~/.openclaw/openclaw.json | grep -A5 '"forked-tracer"'
```

Should show `"enabled": true`. If not, re-run `./install.sh`.

### No traces appearing

Check that the jiti cache isn't serving a stale version of the tracer:

```bash
rm -rf /var/folders/*/T/jiti /var/folders/*/T/node-jiti 2>/dev/null; true
```

Then restart the gateway.

### install.sh fails with "OpenClaw config not found"

OpenClaw needs to be installed and run through initial setup before installing Forked. Run `openclaw configure` first.

### Port conflicts

The daemon uses ports `7999` (WebSocket) and `8000` (HTTP API). If something else is on those ports, kill it or check what's running:

```bash
lsof -i :7999
lsof -i :8000
```

---

## Project structure

```
forked/
├── forked-tracer/      OpenClaw plugin — hooks into the gateway and streams events
│   ├── index.ts
│   ├── package.json
│   └── openclaw.plugin.json
├── forked-daemon/      Standalone Node.js server — receives, stores, and serves traces
│   ├── index.js
│   └── package.json
├── forked-ui/          React + Vite dashboard
│   ├── src/
│   └── package.json
├── forked              CLI entrypoint (`forked run ui`)
├── install.sh          One-shot installer
└── .gitignore
```

---

## License

MIT
