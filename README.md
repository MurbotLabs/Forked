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

Clone to the standard path and run the installer.

```bash
git clone https://github.com/MurbotLabs/Forked.git ~/forked
cd ~/forked
./install.sh
```

> **Why `~/forked`?** This is the standard install location. Everyone using Forked has the same path, which makes setup and troubleshooting consistent. You can install elsewhere if needed.

The installer will:
1. Install dependencies for the tracer, daemon, and UI
2. Register the Forked tracer plugin with your OpenClaw config (`~/.openclaw/openclaw.json`)
3. Create a symlink at `~/.local/bin/forked` (Linux) or add to `~/.zshrc` / `~/.bash_profile` (macOS) so the `forked` command is available

**After install, open a new terminal** and run:

```bash
forked run ui
```

> **Re-running the installer is safe.** If you pull an update and run `./install.sh` again, it will update dependencies and re-register the plugin without touching your existing trace data.

---

## Updating

```bash
cd ~/forked
forked update
```

This pulls the latest code from GitHub and re-runs the installer to update dependencies and plugin registration.

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

If the daemon isn't running when you launch the UI, it will automatically run `forked audit` to fix the issue before opening.

### 3. Run your agents normally

Use OpenClaw as you always would. Traces appear in the UI in real time.

---

## Troubleshooting (quick fix)

If anything isn't working — daemon not starting, UI showing "Offline", traces not appearing — run:

```bash
forked audit
```

This checks your entire Forked setup and auto-fixes whatever it can: re-registers the plugin, installs missing dependencies, starts the daemon, clears stale plugin cache, and restarts the gateway. No manual steps needed.

---

## UI Overview

### Traces tab

The main view. Shows all captured sessions in the left sidebar. Click a session to open its timeline — a chronological lane of every event that occurred during that run. Fork branches appear as indented sub-lanes.

**Sidebar features:**
- Search sessions by session key, run ID, or custom label
- Click the pencil icon on any session card to set a custom label (stored locally)

**Timeline toolbar:**
- Sort events oldest-first or newest-first
- **Stats bar** — shows LLM call count, tool call count, total tokens, and session duration at a glance
- **Filter bar** — click `LLM`, `Tools`, `Messages`, or `System` to show only those event types
- **Search** — filter events by any text in their data

**Event types shown:**

| Event | What it represents |
|---|---|
| `Session Start / End` | Agent session lifecycle |
| `LLM Request` | Every call to the model — shows the actual user message, model/provider, and context size |
| `LLM Response` | Model response text, input/output token counts |
| `Tool Call` | Tool name and key parameters — start and end events are merged into one row |
| `Tool Result` | Output from the tool, duration, pass/fail indicator |
| `Message Received` | Inbound message from user (via Telegram, WhatsApp, etc.) |
| `Message Sent` | Outbound reply to user |
| `Config Change` | Any change detected in your OpenClaw config files |
| `Fork` | A replayed branch of a previous run |

Clicking any event expands it to show a **human-readable summary** of what happened. A **"Show raw data"** toggle reveals the full JSON for power users.

### Config tab

Shows a live read-out of your OpenClaw configuration — configured models (with aliases and primary indicator), agent settings, enabled channels, plugins, skills, and gateway info. Sensitive values (tokens, API keys) are never shown.

---

## Forking a run

Click the **Fork** button on any event in the timeline to open the Fork modal.

- The event's data is shown as editable JSON
- If the event contains a `model` field, a **model picker** dropdown appears — populated from your configured models — so you can switch models without manually editing JSON
- Enable **Rewind** to roll back file system state to the moment of the fork point before replaying
- Click **Fork & Replay** to re-run the agent from that point with your changes applied

The forked run appears as a new branch in the timeline, indented under the original. The agent's response is delivered to the same channel (e.g. Telegram) as the original session.

---

## Rewinding

Enable the **Rewind** toggle in the Fork modal to restore the file system state to what it was at that exact point in the original run. This rolls back any files the agent wrote or edited after the fork point, so the replayed agent starts from a clean slate.

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

## Troubleshooting (detailed)

### `forked: command not found`

**Quick fix for the current terminal session:**
```bash
export PATH="$HOME/forked:$PATH"
```

**Permanent fix (Linux):**
```bash
mkdir -p ~/.local/bin
ln -sf ~/forked/forked ~/.local/bin/forked
```
Then open a new terminal.

**Permanent fix (macOS):** Add to `~/.zshrc`:
```bash
export PATH="$HOME/forked:$PATH"
```
Then run `source ~/.zshrc`.

Re-running `./install.sh` will also fix this automatically.

---

### UI shows "Offline"

Run `forked audit` — it will diagnose and fix the issue automatically.

If you want to check manually, the daemon is not running. Make sure your OpenClaw gateway is running — the daemon starts automatically when the gateway loads. Check that the tracer is enabled:

```bash
cat ~/.openclaw/openclaw.json | grep -A5 '"forked-tracer"'
```

Should show `"enabled": true`. If not, run `forked audit` or re-run `./install.sh`.

---

### No traces appearing

Check that the jiti cache isn't serving a stale version of the tracer:

```bash
rm -rf /var/folders/*/T/jiti /var/folders/*/T/node-jiti 2>/dev/null; true
```

Then restart the gateway.

---

### `install.sh` fails with "OpenClaw config not found"

OpenClaw needs to be installed and run through initial setup before installing Forked. Run `openclaw configure` first.

---

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
├── forked              CLI entrypoint (`forked run ui`, `forked update`)
├── install.sh          One-shot installer
└── .gitignore
```

---

## License

MIT
