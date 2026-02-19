import { WebSocketServer, WebSocket } from "ws";
import Database from "better-sqlite3";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { existsSync, chmodSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DAEMON_PORT = 7999;
const API_PORT = 8000;

// Gateway config - read from OpenClaw config
const OPENCLAW_CONFIG_PATH = path.join(process.env.HOME ?? "", ".openclaw", "openclaw.json");
let GATEWAY_WS_URL = "ws://127.0.0.1:18789";
let GATEWAY_TOKEN = "";
// Channels that are actually configured in the user's OpenClaw setup.
// Used to validate delivery hints — prevents routing to channels that don't exist.
const CONFIGURED_CHANNELS = new Set();
try {
  const ocConfig = JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, "utf-8"));
  const port = ocConfig.gateway?.port ?? 18789;
  GATEWAY_WS_URL = `ws://127.0.0.1:${port}`;
  GATEWAY_TOKEN = ocConfig.gateway?.auth?.token ?? "";
  if (ocConfig.channels && typeof ocConfig.channels === "object") {
    for (const [name] of Object.entries(ocConfig.channels)) {
      if (name) CONFIGURED_CHANNELS.add(name.trim().toLowerCase());
    }
  }
  console.log(`[Forked Daemon] Gateway: ${GATEWAY_WS_URL} (token: ${GATEWAY_TOKEN ? "found" : "none"})`);
  if (CONFIGURED_CHANNELS.size > 0) {
    console.log(`[Forked Daemon] Configured channels: ${[...CONFIGURED_CHANNELS].join(", ")}`);
  }
} catch {
  console.log("[Forked Daemon] Could not read OpenClaw config, using defaults");
}
// --- Device Identity (required for gateway scopes) ---
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base64UrlEncode(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem) {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function loadOrCreateDeviceIdentity() {
  const filePath = path.join(process.env.HOME ?? "", ".openclaw", "identity", "device.json");
  try {
    if (existsSync(filePath)) {
      const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
      if (parsed?.version === 1 && parsed.deviceId && parsed.publicKeyPem && parsed.privateKeyPem) {
        return { deviceId: parsed.deviceId, publicKeyPem: parsed.publicKeyPem, privateKeyPem: parsed.privateKeyPem };
      }
    }
  } catch { /* fall through */ }

  // Generate new identity
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);
  const identity = { deviceId, publicKeyPem, privateKeyPem };

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ version: 1, ...identity, createdAtMs: Date.now() }, null, 2) + "\n", { mode: 0o600 });
  try { chmodSync(filePath, 0o600); } catch { /* non-critical */ }
  return identity;
}

function buildDeviceAuth(identity, scopes, role, nonce) {
  const signedAtMs = Date.now();
  const payloadParts = [
    nonce ? "v2" : "v1",
    identity.deviceId,
    "cli",       // clientId
    "cli",       // clientMode
    role,
    scopes.join(","),
    String(signedAtMs),
    GATEWAY_TOKEN || "",
  ];
  if (nonce) payloadParts.push(nonce);
  const payload = payloadParts.join("|");

  const key = crypto.createPrivateKey(identity.privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);

  return {
    id: identity.deviceId,
    publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)),
    signature: base64UrlEncode(sig),
    signedAt: signedAtMs,
    ...(nonce ? { nonce } : {}),
  };
}

let DEVICE_IDENTITY = null;
try {
  DEVICE_IDENTITY = loadOrCreateDeviceIdentity();
  console.log(`[Forked Daemon] Device identity: ${DEVICE_IDENTITY.deviceId.slice(0, 12)}...`);
} catch (err) {
  console.error("[Forked Daemon] Could not load device identity:", err.message);
}

const DB_PATH = path.join(__dirname, "forked.db");

// --- Database Setup ---
console.log("[Forked Daemon] Initializing database...");
const isNewDb = !existsSync(DB_PATH);
const db = new Database(DB_PATH);

if (isNewDb) {
  try {
    chmodSync(DB_PATH, 0o600);
  } catch {
    // non-critical
  }
}

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    session_key TEXT,
    seq INTEGER NOT NULL,
    stream TEXT NOT NULL,
    ts INTEGER NOT NULL,
    data TEXT NOT NULL,
    is_fork BOOLEAN DEFAULT 0,
    forked_from_run_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_traces_run_id ON traces(run_id);
  CREATE INDEX IF NOT EXISTS idx_traces_session_key ON traces(session_key);

  CREATE TABLE IF NOT EXISTS file_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    tool_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content_before TEXT,
    content_after TEXT,
    existed_before BOOLEAN DEFAULT 1,
    exists_after BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_run_id ON file_snapshots(run_id);
  CREATE INDEX IF NOT EXISTS idx_snapshots_run_seq ON file_snapshots(run_id, seq);
`);

console.log("[Forked Daemon] Database initialized.");

// --- Configuration ---
const CONFIG_PATH = path.join(__dirname, "forked.config.json");
let retentionDays = 14; // default

try {
  const envRetention = process.env.FORKED_RETENTION_DAYS;
  if (envRetention) {
    retentionDays = envRetention === "never" ? -1 : parseInt(envRetention, 10);
  } else if (existsSync(CONFIG_PATH)) {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    const val = config.retentionDays;
    if (val === "never") {
      retentionDays = -1;
    } else if (typeof val === "number" && val > 0) {
      retentionDays = val;
    }
  }
} catch {
  console.log("[Forked Daemon] Could not read config, using default retention (14 days)");
}

console.log(`[Forked Daemon] Retention: ${retentionDays === -1 ? "never" : retentionDays + " days"}`);

// --- Prepared Statements ---
const insertStmt = db.prepare(
  "INSERT INTO traces (run_id, session_key, seq, stream, ts, data, is_fork, forked_from_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);

const insertSnapshotStmt = db.prepare(
  `INSERT INTO file_snapshots (run_id, seq, tool_name, file_path, content_before, content_after, existed_before, exists_after)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

const updateSnapshotAfterStmt = db.prepare(
  `UPDATE file_snapshots SET content_after = ?, exists_after = ?
   WHERE id = (SELECT id FROM file_snapshots WHERE run_id = ? AND file_path = ? AND content_after IS NULL ORDER BY seq DESC LIMIT 1)`
);

// Sessions normalized to one row per run_id.
// If some events in a run are missing session_key, prefer the latest non-null
// session_key seen for that run so UI grouping stays stable.
const getSessionsStmt = db.prepare(`
  WITH runs AS (
    SELECT DISTINCT run_id
    FROM traces
  )
  SELECT
    r.run_id,
    (
      SELECT t2.session_key
      FROM traces t2
      WHERE t2.run_id = r.run_id
        AND t2.session_key IS NOT NULL
      ORDER BY t2.ts DESC, t2.seq DESC
      LIMIT 1
    ) AS session_key,
    MIN(t.created_at) AS start_time,
    MAX(t.created_at) AS last_activity,
    COUNT(*) AS event_count,
    SUM(CASE WHEN t.data LIKE '%"type":"llm_input"%' THEN 1 ELSE 0 END) AS llm_input_count,
    SUM(CASE WHEN t.data LIKE '%"type":"llm_output"%' THEN 1 ELSE 0 END) AS llm_output_count,
    MAX(t.is_fork) AS is_fork,
    MAX(t.forked_from_run_id) AS forked_from_run_id
  FROM runs r
  JOIN traces t ON t.run_id = r.run_id
  GROUP BY r.run_id
  ORDER BY last_activity DESC
`);

// Get all run_ids that belong to a session_key (or match a single run_id for orphans)
const getRunIdsForSessionStmt = db.prepare(`
  SELECT DISTINCT run_id FROM traces
  WHERE session_key = ? OR (session_key IS NULL AND run_id IN (
    SELECT DISTINCT run_id FROM traces WHERE session_key = ?
  ))
`);

// Traces by run_id (used internally for fork/rewind which operate on specific runs)
const getTracesStmt = db.prepare(
  "SELECT * FROM traces WHERE run_id = ? ORDER BY seq ASC"
);

const getTracesBeforeSeq = db.prepare(
  "SELECT * FROM traces WHERE run_id = ? AND seq < ? ORDER BY seq ASC"
);

const getSnapshotsStmt = db.prepare(
  "SELECT * FROM file_snapshots WHERE run_id = ? ORDER BY seq ASC"
);

const getSnapshotsBeforeSeqStmt = db.prepare(
  "SELECT * FROM file_snapshots WHERE run_id = ? AND seq <= ? ORDER BY seq ASC"
);

const getRecentLifecycleEventsForSessionStmt = db.prepare(
  "SELECT data FROM traces WHERE session_key = ? AND stream = 'lifecycle' ORDER BY ts DESC, seq DESC LIMIT 200"
);
const getRunSessionKeyStmt = db.prepare(
  "SELECT session_key FROM traces WHERE run_id = ? AND session_key IS NOT NULL ORDER BY ts DESC, seq DESC LIMIT 1"
);
const getLatestSessionKeyStmt = db.prepare(
  "SELECT session_key FROM traces WHERE session_key IS NOT NULL ORDER BY ts DESC, seq DESC LIMIT 1"
);
const getLatestForkSessionKeyStmt = db.prepare(
  "SELECT session_key FROM traces WHERE stream = 'fork_info' AND session_key IS NOT NULL ORDER BY ts DESC, seq DESC LIMIT 1"
);
const getRunEventCountStmt = db.prepare(
  "SELECT COUNT(*) AS count FROM traces WHERE run_id = ?"
);
const getAllRunLineageStmt = db.prepare(
  `SELECT
    run_id,
    MAX(is_fork) AS is_fork,
    MAX(forked_from_run_id) AS forked_from_run_id,
    MAX(ts) AS last_ts
   FROM traces
   GROUP BY run_id
   ORDER BY last_ts ASC`
);
const getExplicitForkRunsStmt = db.prepare(
  `SELECT run_id, MAX(ts) AS last_ts
   FROM traces
   WHERE stream = 'fork_info'
   GROUP BY run_id
   ORDER BY last_ts ASC`
);

// --- Fork Linking ---
// When a fork is initiated, we register it here. As new traces arrive on the
// WebSocket, we check if a new run_id appears that matches a pending fork
// (by timing). We then tag ALL traces from that run as forked.
const pendingForks = new Map(); // key: forkId, value: { originalRunId, forkFromSeq, modifiedData, placeholderRunId, startedAt, sessionKey }
const linkedForkRuns = new Set(); // run_ids already linked to a fork
const runLineage = new Map(); // run_id -> { isFork, forkedFromRunId, sessionKey }
const sessionForkHeads = new Map(); // session_key -> latest explicit fork run_id

const markRunAsForkedStmt = db.prepare(
  "UPDATE traces SET is_fork = 1, forked_from_run_id = ? WHERE run_id = ?"
);

function tryLinkFork(runId) {
  if (linkedForkRuns.has(runId)) return;

  // Find the oldest pending fork (FIFO)
  for (const [forkId, fork] of pendingForks) {
    // The new run must have started after the fork was initiated
    // and must not be the placeholder session
    if (runId === fork.placeholderRunId || runId === fork.originalRunId) continue;

    // Link it
    console.log(`[Forked Daemon] Linking run ${runId} to fork placeholder ${fork.placeholderRunId} (source ${fork.originalRunId}, seq ${fork.forkFromSeq})`);
    markRunAsForkedStmt.run(fork.placeholderRunId, runId);
    linkedForkRuns.add(runId);

    const existing = runLineage.get(runId) ?? {
      isFork: 0,
      forkedFromRunId: null,
      sessionKey: null,
    };
    const resolvedSessionKey =
      existing.sessionKey ??
      getRunSessionKeyStmt.get(runId)?.session_key ??
      fork.sessionKey ??
      null;
    runLineage.set(runId, {
      isFork: 1,
      forkedFromRunId: fork.placeholderRunId,
      sessionKey: resolvedSessionKey,
    });
    if (resolvedSessionKey) {
      sessionForkHeads.set(resolvedSessionKey, fork.placeholderRunId);
    }

    // Remove from pending
    pendingForks.delete(forkId);
    return;
  }
}

for (const row of getAllRunLineageStmt.all()) {
  const sessionKey = getRunSessionKeyStmt.get(row.run_id)?.session_key ?? null;
  runLineage.set(row.run_id, {
    isFork: row.is_fork ? 1 : 0,
    forkedFromRunId: row.forked_from_run_id ?? null,
    sessionKey,
  });
}

for (const row of getExplicitForkRunsStmt.all()) {
  const sessionKey = getRunSessionKeyStmt.get(row.run_id)?.session_key ?? null;
  if (sessionKey) {
    sessionForkHeads.set(sessionKey, row.run_id);
  }
}

function isBackgroundLifecycleChange(data) {
  return Boolean(
    data &&
    typeof data === "object" &&
    (data.type === "config_change" || data.type === "setup_file_change")
  );
}

// Clean up stale pending forks (older than 5 minutes)
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [forkId, fork] of pendingForks) {
    if (fork.startedAt < cutoff) {
      console.log(`[Forked Daemon] Expiring unlinked fork ${forkId}`);
      pendingForks.delete(forkId);
    }
  }
}, 60_000);

// --- Auto-Cleanup ---
const deleteOldTracesStmt = db.prepare(
  "DELETE FROM traces WHERE created_at < datetime('now', '-' || ? || ' days')"
);
const deleteOldSnapshotsStmt = db.prepare(
  "DELETE FROM file_snapshots WHERE created_at < datetime('now', '-' || ? || ' days')"
);

function runCleanup() {
  if (retentionDays < 0) return; // disabled
  try {
    const tracesResult = deleteOldTracesStmt.run(retentionDays);
    const snapshotsResult = deleteOldSnapshotsStmt.run(retentionDays);
    const total = tracesResult.changes + snapshotsResult.changes;
    if (total > 0) {
      console.log(`[Forked Daemon] Cleanup: removed ${tracesResult.changes} traces and ${snapshotsResult.changes} snapshots older than ${retentionDays} days`);
    }
  } catch (err) {
    console.error("[Forked Daemon] Cleanup error:", err.message);
  }
}

// Run on startup
runCleanup();
// Run every hour
const cleanupInterval = setInterval(runCleanup, 60 * 60 * 1000);

// --- WebSocket Server Setup ---
console.log(`[Forked Daemon] Starting WebSocket server on 127.0.0.1:${DAEMON_PORT}...`);
const wss = new WebSocketServer({ port: DAEMON_PORT, host: "127.0.0.1" });

wss.on("connection", (ws) => {
  console.log("[Forked Daemon] Tracer connected.");

  const seenRuns = new Set();

  ws.on("message", (message) => {
    try {
      const event = JSON.parse(message.toString());
      const data = event.data ?? {};
      let eventRunId =
        typeof event.runId === "string" && event.runId.trim()
          ? event.runId.trim()
          : "unknown";
      let eventSessionKey = event.sessionKey ?? null;

      // Fallback for tracer background file-change events that may arrive without run/session context.
      if (isBackgroundLifecycleChange(data)) {
        const needsRunFallback = !eventRunId || eventRunId === "unknown";
        if (!eventSessionKey) {
          eventSessionKey =
            getLatestForkSessionKeyStmt.get()?.session_key ??
            getLatestSessionKeyStmt.get()?.session_key ??
            null;
        }
        if (needsRunFallback && eventSessionKey) {
          const eventTs = Number.isFinite(Number(event.ts)) ? Number(event.ts) : Date.now();
          const eventSeq = Number.isFinite(Number(event.seq)) ? Number(event.seq) : 0;
          eventRunId = `bg_${eventSessionKey.slice(0, 8)}_${eventTs}_${eventSeq}`;
        }
      }

      let lineage = runLineage.get(eventRunId);
      if (!lineage) {
        const explicitHead = eventSessionKey ? sessionForkHeads.get(eventSessionKey) : null;
        lineage = {
          isFork: explicitHead && explicitHead !== eventRunId ? 1 : 0,
          forkedFromRunId:
            explicitHead && explicitHead !== eventRunId ? explicitHead : null,
          sessionKey: eventSessionKey,
        };
        runLineage.set(eventRunId, lineage);
      } else if (!lineage.sessionKey && eventSessionKey) {
        lineage = { ...lineage, sessionKey: eventSessionKey };
        runLineage.set(eventRunId, lineage);
      }

      const effectiveSessionKey = eventSessionKey ?? lineage.sessionKey ?? null;
      if (!lineage.isFork && effectiveSessionKey) {
        const explicitHead = sessionForkHeads.get(effectiveSessionKey) ?? null;
        if (explicitHead && explicitHead !== eventRunId) {
          // Only auto-promote tiny runs to avoid rewriting established history.
          const runEventCount = Number(getRunEventCountStmt.get(eventRunId)?.count ?? 0);
          if (runEventCount <= 2) {
            markRunAsForkedStmt.run(explicitHead, eventRunId);
            lineage = {
              isFork: 1,
              forkedFromRunId: explicitHead,
              sessionKey: effectiveSessionKey,
            };
            runLineage.set(eventRunId, lineage);
          }
        }
      }

      // Store the trace event
      insertStmt.run(
        eventRunId,
        eventSessionKey,
        event.seq,
        event.stream,
        event.ts,
        JSON.stringify(data),
        lineage.isFork ? 1 : 0,
        lineage.forkedFromRunId ?? null
      );

      // Check if this is a new run_id we haven't seen before — could be a forked agent
      if (eventRunId && !seenRuns.has(eventRunId) && pendingForks.size > 0) {
        seenRuns.add(eventRunId);
        tryLinkFork(eventRunId);
      }

      // Extract and store file snapshots if present
      if (data.fileSnapshot) {
        const snap = data.fileSnapshot;
        const toolName = data.toolName ?? "unknown";

        if (data.type === "tool_call_start" && snap.filePath) {
          insertSnapshotStmt.run(
            eventRunId,
            event.seq,
            toolName,
            snap.filePath,
            snap.contentBefore ?? null,
            null,
            snap.existedBefore ? 1 : 0,
            1
          );
        } else if (data.type === "tool_call_end" && snap.filePath) {
          updateSnapshotAfterStmt.run(
            snap.contentAfter ?? null,
            snap.existsAfter ? 1 : 0,
            eventRunId,
            snap.filePath
          );
        } else if ((data.type === "config_change" || data.type === "setup_file_change") && snap.filePath) {
          insertSnapshotStmt.run(
            eventRunId,
            event.seq,
            data.type,
            snap.filePath,
            snap.contentBefore ?? null,
            snap.contentAfter ?? null,
            snap.existedBefore ? 1 : 0,
            snap.existsAfter ? 1 : 0
          );
        }
      }
    } catch (error) {
      console.error("[Forked Daemon] Failed to process message:", error.message);
    }
  });

  ws.on("close", () => {
    console.log("[Forked Daemon] Tracer disconnected.");
  });
});

console.log("[Forked Daemon] WebSocket server started.");

// --- API Server Setup ---
console.log(`[Forked Daemon] Starting API server on 127.0.0.1:${API_PORT}...`);
const app = express();

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      cb(null, true);
    } else {
      cb(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST"],
}));
app.use(express.json());

// GET /api/sessions
app.get("/api/sessions", (_req, res) => {
  try {
    const rows = getSessionsStmt.all();
    res.json(rows);
  } catch (error) {
    console.error("[Forked Daemon] Error fetching sessions:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/traces/:sessionId - fetch all traces for a session (across all run_ids)
app.get("/api/traces/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;

    // First try: sessionId is a session_key — get all run_ids that belong to it
    const runIdRows = getRunIdsForSessionStmt.all(sessionId, sessionId);

    if (runIdRows.length > 0) {
      // Fetch traces for all run_ids in this session
      const placeholders = runIdRows.map(() => "?").join(",");
      const runIds = runIdRows.map((r) => r.run_id);
      const rows = db.prepare(
        `SELECT * FROM traces WHERE run_id IN (${placeholders}) ORDER BY ts ASC, seq ASC`
      ).all(...runIds);
      return res.json(rows);
    }

    // Fallback: sessionId might be a direct run_id (orphan session)
    const rows = getTracesStmt.all(sessionId);
    res.json(rows);
  } catch (error) {
    console.error("[Forked Daemon] Error fetching traces:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/snapshots/:sessionId - fetch all snapshots for a session (across all run_ids)
app.get("/api/snapshots/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;

    const runIdRows = getRunIdsForSessionStmt.all(sessionId, sessionId);

    if (runIdRows.length > 0) {
      const placeholders = runIdRows.map(() => "?").join(",");
      const runIds = runIdRows.map((r) => r.run_id);
      const rows = db.prepare(
        `SELECT * FROM file_snapshots WHERE run_id IN (${placeholders}) ORDER BY seq ASC`
      ).all(...runIds);
      return res.json(rows);
    }

    const rows = getSnapshotsStmt.all(sessionId);
    res.json(rows);
  } catch (error) {
    console.error("[Forked Daemon] Error fetching snapshots:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

function computeRewindFileStates(snapshots) {
  const fileStates = new Map();
  for (const snap of snapshots) {
    if (!fileStates.has(snap.file_path)) {
      fileStates.set(snap.file_path, {
        originalContent: snap.content_before,
        originalExisted: !!snap.existed_before,
        filePath: snap.file_path,
      });
    }
  }
  return fileStates;
}

function rewindFilesToSeq(runId, targetSeq) {
  const snapshots = getSnapshotsBeforeSeqStmt.all(runId, targetSeq);

  if (snapshots.length === 0) {
    return {
      success: false,
      message: "No file snapshots found for this run up to the specified point.",
      filesAffected: 0,
      results: [],
      backupId: null,
      backups: [],
    };
  }

  const fileStates = computeRewindFileStates(snapshots);

  const backupId = `rewind_${Date.now()}`;
  const backups = [];
  for (const [filePath] of fileStates) {
    try {
      backups.push({
        filePath,
        currentContent: existsSync(filePath) ? readFileSync(filePath, "utf-8") : null,
        currentExists: existsSync(filePath),
      });
    } catch {
      // file may be inaccessible
    }
  }

  const results = [];
  for (const [filePath, state] of fileStates) {
    try {
      if (!state.originalExisted) {
        if (existsSync(filePath)) {
          unlinkSync(filePath);
          results.push({ filePath, action: "deleted", success: true });
        } else {
          results.push({ filePath, action: "already_absent", success: true });
        }
      } else {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, state.originalContent ?? "", "utf-8");
        results.push({ filePath, action: "restored", success: true });
      }
    } catch (err) {
      results.push({ filePath, action: "failed", success: false, error: err.message });
    }
  }

  return {
    success: true,
    backupId,
    filesAffected: results.length,
    results,
    backups,
  };
}

// GET /api/rewind/preview/:runId/:targetSeq
app.get("/api/rewind/preview/:runId/:targetSeq", (req, res) => {
  try {
    const { runId, targetSeq } = req.params;
    const snapshots = getSnapshotsBeforeSeqStmt.all(runId, parseInt(targetSeq));

    // For each unique file, find its earliest snapshot (original state)
    const fileStates = new Map();
    for (const snap of snapshots) {
      if (!fileStates.has(snap.file_path)) {
        fileStates.set(snap.file_path, {
          filePath: snap.file_path,
          originalExisted: !!snap.existed_before,
          action: snap.existed_before ? "restore" : "delete",
        });
      }
    }

    res.json({
      runId,
      targetSeq: parseInt(targetSeq),
      files: Array.from(fileStates.values()),
    });
  } catch (error) {
    console.error("[Forked Daemon] Error previewing rewind:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/rewind
app.post("/api/rewind", (req, res) => {
  const { runId, targetSeq } = req.body;

  if (!runId || targetSeq == null) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameters: runId, targetSeq",
    });
  }

  try {
    const rewindResult = rewindFilesToSeq(runId, targetSeq);
    if (!rewindResult.success) {
      return res.json({
        success: false,
        message: rewindResult.message,
      });
    }

    const { backupId, results, backups, filesAffected } = rewindResult;

    // Record rewind as audit trace event
    insertStmt.run(
      runId,
      null,
      999999,
      "rewind",
      Date.now(),
      JSON.stringify({
        type: "rewind_executed",
        targetSeq,
        backupId,
        filesAffected,
        results,
        backups,
      }),
      0,
      null
    );

    console.log(`[Forked Daemon] Rewind executed: ${filesAffected} files affected (backup: ${backupId})`);

    res.json({
      success: true,
      backupId,
      filesAffected,
      results,
    });
  } catch (error) {
    console.error("[Forked Daemon] Rewind failed:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseDeliveryHintFromAddress(address) {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  if (!trimmed) return null;

  const [rawChannel, ...parts] = trimmed.split(":");
  const channel = (rawChannel ?? "").trim().toLowerCase();
  if (!channel || parts.length === 0) return null;

  if (channel === "telegram") {
    const [kind, value, maybeTopic, topicId] = parts;
    if (kind === "group" && value) {
      const hint = { channel, to: value.trim() };
      if (maybeTopic === "topic" && topicId) {
        hint.threadId = topicId.trim();
      }
      return hint;
    }
    if (kind === "direct" && value) {
      return { channel, to: value.trim() };
    }
    const to = parts.join(":").trim();
    return to ? { channel, to } : null;
  }

  const to = parts.join(":").trim();
  return to ? { channel, to } : null;
}

function extractDeliveryHintFromEventData(data) {
  if (!data || typeof data !== "object") return null;

  if (data.type === "message_received" && typeof data.from === "string") {
    return parseDeliveryHintFromAddress(data.from);
  }

  if (data.type === "message_sent" && typeof data.to === "string") {
    return parseDeliveryHintFromAddress(data.to);
  }

  return null;
}

function parseChannelFromSessionKey(sessionKey) {
  if (typeof sessionKey !== "string") return null;
  const parts = sessionKey.split(":");
  if (parts.length < 3) return null;
  if ((parts[0] ?? "").toLowerCase() !== "agent") return null;
  const channel = (parts[2] ?? "").trim().toLowerCase();
  return channel || null;
}

function matchesSessionChannel(hint, sessionChannel) {
  if (!hint) return false;
  if (!sessionChannel) return true;
  return hint.channel === sessionChannel;
}

// Returns true only if the channel is in the user's actual OpenClaw config.
// Falls back to permissive (true) if we couldn't read the config.
function isConfiguredChannel(channel) {
  if (!channel) return false;
  if (CONFIGURED_CHANNELS.size === 0) return true; // couldn't read config, be permissive
  return CONFIGURED_CHANNELS.has(channel.toLowerCase());
}

function findPreferredHintFromRows(rows, sessionChannel) {
  // Prefer inbound addresses first (the user's channel), then outbound as fallback.
  // Skip synthetic events — they are created by Forked itself and use fake addresses
  // like "forked:user" that are not real gateway channels.
  for (let i = rows.length - 1; i >= 0; i--) {
    const parsed = safeParseJson(rows[i].data);
    if (!parsed || parsed.synthetic || parsed.type !== "message_received" || typeof parsed.from !== "string") continue;
    const hint = parseDeliveryHintFromAddress(parsed.from);
    if (matchesSessionChannel(hint, sessionChannel)) return hint;
  }

  for (let i = rows.length - 1; i >= 0; i--) {
    const parsed = safeParseJson(rows[i].data);
    if (!parsed || parsed.synthetic || parsed.type !== "message_sent" || typeof parsed.to !== "string") continue;
    const hint = parseDeliveryHintFromAddress(parsed.to);
    if (matchesSessionChannel(hint, sessionChannel)) return hint;
  }

  return null;
}

function deriveForkDeliveryHint({ modifiedData, history, sessionKey }) {
  const sessionChannel = parseChannelFromSessionKey(sessionKey);

  const fromModified = extractDeliveryHintFromEventData(modifiedData);
  if (fromModified && isConfiguredChannel(fromModified.channel) && matchesSessionChannel(fromModified, sessionChannel)) {
    return fromModified;
  }

  const fromHistory = findPreferredHintFromRows(history, sessionChannel);
  if (fromHistory && isConfiguredChannel(fromHistory.channel)) return fromHistory;

  // Fallback: look across the full session timeline for the most recent target.
  if (sessionKey) {
    const rows = getRecentLifecycleEventsForSessionStmt.all(sessionKey);
    console.log(`[Forked Daemon] Hint search: found ${rows.length} lifecycle rows for session ${sessionKey?.slice(0, 8)}`);
    if (rows.length > 0) {
      // Log the first few 'from'/'to' fields to debug address format
      for (const row of rows.slice(0, 5)) {
        try {
          const d = JSON.parse(row.data);
          if (d.from || d.to) console.log(`  -> type=${d.type} from=${d.from ?? "(none)"} to=${d.to ?? "(none)"}`);
        } catch { /* skip */ }
      }
    }
    const fromSession = findPreferredHintFromRows(rows, sessionChannel);
    if (fromSession && isConfiguredChannel(fromSession.channel)) return fromSession;
  }

  return null;
}

function buildDeliveryTargetFromHint(deliveryHint) {
  if (!deliveryHint || typeof deliveryHint !== "object") return null;
  const channel = typeof deliveryHint.channel === "string" ? deliveryHint.channel.trim() : "";
  const to = typeof deliveryHint.to === "string" ? deliveryHint.to.trim() : "";
  if (!channel || !to) return null;

  if (channel === "telegram") {
    const threadId = typeof deliveryHint.threadId === "string" ? deliveryHint.threadId.trim() : "";
    if (threadId) {
      return { channel, to: `${to}:topic:${threadId}` };
    }
  }

  return { channel, to };
}

function formatForkEchoMessage(message) {
  const source =
    typeof message === "string"
      ? message.trim()
      : message == null
        ? ""
        : String(message).trim();
  if (!source) return null;

  const MAX_ECHO_CHARS = 3000;
  const clipped =
    source.length > MAX_ECHO_CHARS
      ? `${source.slice(0, MAX_ECHO_CHARS)}… [truncated by Forked]`
      : source;
  return `FORKED (YOU): ${clipped}`;
}

function sendForkEchoToGateway(echoMessage, deliveryHint) {
  const target = buildDeliveryTargetFromHint(deliveryHint);
  if (!target || !echoMessage) {
    return Promise.resolve({ skipped: true });
  }

  return new Promise((resolve, reject) => {
    const gwWs = new WebSocket(GATEWAY_WS_URL);
    let authenticated = false;
    let sendReqId = null;
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        gwWs.close();
        reject(new Error("Gateway send timed out after 30s"));
      }
    }, 30_000);

    gwWs.on("open", () => {
      const connectId = crypto.randomUUID();
      const role = "operator";
      const scopes = ["operator.admin", "operator.write"];
      const connectFrame = {
        type: "req",
        id: connectId,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "cli",
            version: "1.0.0",
            platform: "forked-daemon",
            mode: "cli",
            instanceId: crypto.randomUUID(),
          },
          role,
          scopes,
          caps: [],
          auth: GATEWAY_TOKEN ? { token: GATEWAY_TOKEN } : undefined,
          device: DEVICE_IDENTITY ? buildDeviceAuth(DEVICE_IDENTITY, scopes, role) : undefined,
        },
      };
      gwWs.send(JSON.stringify(connectFrame));
    });

    gwWs.on("message", (data) => {
      if (resolved) return;
      try {
        const frame = JSON.parse(data.toString());

        if (frame.type === "res" && !authenticated) {
          if (frame.ok === false || frame.error) {
            resolved = true;
            clearTimeout(timeoutId);
            gwWs.close();
            reject(new Error(`Gateway auth failed: ${frame.error?.message || JSON.stringify(frame.error) || "unknown"}`));
            return;
          }

          authenticated = true;
          sendReqId = crypto.randomUUID();
          const sendFrame = {
            type: "req",
            id: sendReqId,
            method: "send",
            params: {
              channel: target.channel,
              to: target.to,
              message: echoMessage,
              idempotencyKey: sendReqId,
            },
          };
          gwWs.send(JSON.stringify(sendFrame));
          return;
        }

        if (frame.type === "res" && authenticated && frame.id === sendReqId) {
          if (frame.ok === false || frame.error) {
            resolved = true;
            clearTimeout(timeoutId);
            gwWs.close();
            reject(new Error(`Gateway send error: ${frame.error?.message || JSON.stringify(frame.error) || "request rejected"}`));
            return;
          }
          resolved = true;
          clearTimeout(timeoutId);
          gwWs.close();
          resolve({ ok: true, payload: frame.payload ?? null });
        }
      } catch {
        // ignore non-JSON frames
      }
    });

    gwWs.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        reject(err);
      }
    });

    gwWs.on("close", (code, reason) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        reject(new Error(`Gateway closed unexpectedly (code: ${code}, reason: ${reason || "none"})`));
      }
    });
  });
}

// --- Gateway communication helper ---
function sendToGateway(message, sessionKey, deliveryHint = null) {
  return new Promise((resolve, reject) => {
    const gwWs = new WebSocket(GATEWAY_WS_URL);
    let authenticated = false;
    let agentReqId = null;
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        gwWs.close();
        reject(new Error("Gateway request timed out after 120s"));
      }
    }, 120_000);

    gwWs.on("open", () => {
      // Step 1: Send the connect handshake matching GatewayClient.sendConnect() protocol
      const connectId = crypto.randomUUID();
      const role = "operator";
      const scopes = ["operator.admin", "operator.write"];
      const connectFrame = {
        type: "req",
        id: connectId,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "cli",
            version: "1.0.0",
            platform: "forked-daemon",
            mode: "cli",
            instanceId: crypto.randomUUID(),
          },
          role,
          scopes,
          caps: [],
          auth: GATEWAY_TOKEN ? { token: GATEWAY_TOKEN } : undefined,
          device: DEVICE_IDENTITY ? buildDeviceAuth(DEVICE_IDENTITY, scopes, role) : undefined,
        },
      };
      console.log("[Forked Daemon] Sending connect handshake to gateway...");
      gwWs.send(JSON.stringify(connectFrame));
    });

    gwWs.on("message", (data) => {
      if (resolved) return;
      try {
        const frame = JSON.parse(data.toString());
        console.log("[Forked Daemon] <<< Gateway frame:", frame.type,
          frame.method || "", frame.event || "",
          frame.ok !== undefined ? `ok=${frame.ok}` : "",
          frame.payload?.status || ""
        );

        // Handle connect response (hello-ok) — gateway responds to "connect" req with a res
        if (frame.type === "res" && !authenticated) {
          if (frame.ok === false || frame.error) {
            resolved = true;
            clearTimeout(timeoutId);
            gwWs.close();
            reject(new Error(`Gateway auth failed: ${frame.error?.message || JSON.stringify(frame.error) || "unknown"}`));
            return;
          }
          authenticated = true;
          console.log("[Forked Daemon] Gateway authenticated, sending agent request...");

          // Step 2: Send the agent request with all required params
          agentReqId = crypto.randomUUID();

          // Parse agentId from sessionKey (format: "agent:<agentId>:<key>" or just use default)
          let agentId = "main";
          if (sessionKey && sessionKey.startsWith("agent:")) {
            const parts = sessionKey.split(":");
            if (parts.length >= 2) agentId = parts[1];
          }

          const agentFrame = {
            type: "req",
            id: agentReqId,
            method: "agent",
            params: {
              message,
              agentId,
              sessionKey: sessionKey || undefined,
              idempotencyKey: agentReqId,
              timeout: 120,
            },
          };
          console.log("[Forked Daemon] >>> Sending agent request:", JSON.stringify(agentFrame.params));
          gwWs.send(JSON.stringify(agentFrame));
          return;
        }

        // Handle agent response
        if (frame.type === "res" && authenticated) {
          // Check for error responses
          if (frame.ok === false || frame.error) {
            resolved = true;
            clearTimeout(timeoutId);
            gwWs.close();
            reject(new Error(`Gateway agent error: ${frame.error?.message || JSON.stringify(frame.error) || "request rejected"}`));
            return;
          }

          // Skip intermediate "accepted" responses — wait for the final one
          if (frame.payload?.status === "accepted") {
            console.log("[Forked Daemon] Agent request accepted, waiting for completion...");
            return;
          }

          // This is the final response
          resolved = true;
          clearTimeout(timeoutId);
          gwWs.close();
          resolve(frame);
          return;
        }

        // Handle event frames (agent progress, ticks, etc) — log but don't resolve
        if (frame.type === "event") {
          if (frame.event === "agent") {
            console.log("[Forked Daemon] Agent event:", frame.payload?.type || "unknown");
          }
          return;
        }

      } catch {
        // ignore non-JSON frames
      }
    });

    gwWs.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        console.error("[Forked Daemon] Gateway WS error:", err.message);
        reject(err);
      }
    });

    gwWs.on("close", (code, reason) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        reject(new Error(`Gateway closed unexpectedly (code: ${code}, reason: ${reason || "none"})`));
      }
    });
  });
}

// POST /api/fork
app.post("/api/fork", async (req, res) => {
  const { originalRunId, forkFromSeq, modifiedData } = req.body;

  if (!originalRunId || forkFromSeq == null || !modifiedData) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameters: originalRunId, forkFromSeq, modifiedData",
    });
  }

  try {
    const history = getTracesBeforeSeq.all(originalRunId, forkFromSeq);
    const newSessionId = `fork_${originalRunId.slice(0, 8)}_${Date.now()}`;
    const forkControl =
      modifiedData && typeof modifiedData === "object" && modifiedData.__forkedRewindFirst
        ? modifiedData.__forkedRewindFirst
        : null;
    const forkPayload = modifiedData && typeof modifiedData === "object"
      ? { ...modifiedData }
      : modifiedData;
    if (forkPayload && typeof forkPayload === "object" && "__forkedRewindFirst" in forkPayload) {
      delete forkPayload.__forkedRewindFirst;
    }

    // Get the original session_key (prefer non-null rows, since seq=0 fork_info may be null)
    const allTraces = getTracesStmt.all(originalRunId);
    const sessionKey =
      getRunSessionKeyStmt.get(originalRunId)?.session_key ??
      allTraces.find((row) => row.session_key)?.session_key ??
      null;

    // Extract the message to replay from modifiedData
    let forkMessage = forkPayload.prompt
      || forkPayload.message
      || forkPayload.content
      || null;

    // If no message in modified data, try to find the original user message from history
    if (!forkMessage) {
      // Walk the history in reverse to find the most recent user message before the fork point
      for (let i = history.length - 1; i >= 0; i--) {
        try {
          const d = JSON.parse(history[i].data);
          if (d.type === "message_received" && d.content) {
            forkMessage = d.content;
            break;
          } else if (d.type === "llm_input" && d.prompt) {
            forkMessage = d.prompt;
            break;
          }
        } catch { /* skip */ }
      }
    }

    if (!forkMessage) {
      forkMessage = JSON.stringify(forkPayload);
    }
    const forkEchoMessage = formatForkEchoMessage(forkMessage);

    const forkStartedAt = Date.now();
    const deliveryHint = deriveForkDeliveryHint({
      modifiedData,
      history,
      sessionKey,
    });

    console.log("--- FORK ENGINE ---");
    console.log("Forking run:", originalRunId, "at seq:", forkFromSeq);
    console.log("Placeholder session ID:", newSessionId);
    console.log("Original session_key:", sessionKey);
    console.log("Fork message:", typeof forkMessage === "string" ? forkMessage.slice(0, 200) : forkMessage);
    console.log("Delivery hint:", deliveryHint ?? "(none)");
    console.log("Rewind first:", forkControl ? "enabled" : "disabled");
    console.log("History events:", history.length);
    console.log("-------------------");

    // Create a persistent explicit fork branch node (placeholder run_id).
    insertStmt.run(
      newSessionId,
      sessionKey,
      0,
      "fork_info",
      forkStartedAt,
      JSON.stringify({
        type: "fork_info",
        originalRunId,
        forkFromSeq,
        modifiedData: forkPayload,
      }),
      1,
      originalRunId
    );
    if (forkMessage) {
      insertStmt.run(
        newSessionId,
        sessionKey,
        1,
        "lifecycle",
        forkStartedAt + 1,
        JSON.stringify({
          type: "message_received",
          source: "forked",   // display label — intentionally not 'from' so it can't be parsed as a channel address
          content: forkMessage,
          timestamp: forkStartedAt,
          synthetic: true,
        }),
        1,
        originalRunId
      );
    }

    runLineage.set(newSessionId, {
      isFork: 1,
      forkedFromRunId: originalRunId,
      sessionKey,
    });
    if (sessionKey) {
      // The placeholder is the explicit branch container for this fork.
      sessionForkHeads.set(sessionKey, newSessionId);
    }

    // Register this as a pending fork so the WebSocket receiver can link incoming traces
    const forkId = newSessionId;
    pendingForks.set(forkId, {
      originalRunId,
      forkFromSeq,
      modifiedData: forkPayload,
      placeholderRunId: newSessionId,
      startedAt: forkStartedAt,
      sessionKey,
    });

    // Optional pre-fork rewind/apply flow.
    // Used by Fork UI quick-actions (e.g. config rewind/edit): restore first, then apply edits.
    if (forkControl && typeof forkControl === "object") {
      const targetRunId = typeof forkControl.runId === "string" ? forkControl.runId : originalRunId;
      const targetSeq =
        typeof forkControl.targetSeq === "number" ? forkControl.targetSeq : forkFromSeq;
      const rewindResult = rewindFilesToSeq(targetRunId, targetSeq);
      if (!rewindResult.success) {
        pendingForks.delete(forkId);
        return res.status(400).json({
          success: false,
          newRunId: newSessionId,
          message: `Rewind failed before fork: ${rewindResult.message}`,
        });
      }

      // Record rewind inside the fork branch so users can see exactly where rewind happened.
      insertStmt.run(
        newSessionId,
        sessionKey,
        2,
        "rewind",
        Date.now(),
        JSON.stringify({
          type: "rewind_executed",
          targetRunId,
          targetSeq,
          filesAffected: rewindResult.filesAffected ?? 0,
          results: rewindResult.results ?? [],
          backups: rewindResult.backups ?? [],
          synthetic: true,
        }),
        1,
        originalRunId
      );

      // Optional apply step after rewind for config changes edited in the Fork modal.
      if (forkPayload && forkPayload.type === "config_change" && typeof forkPayload.filePath === "string") {
        const filePath = forkPayload.filePath.trim();
        if (filePath) {
          let updatedContent = null;
          if (typeof forkPayload.currentRaw === "string") {
            updatedContent = forkPayload.currentRaw;
          } else if (forkPayload.currentContent !== undefined) {
            updatedContent = `${JSON.stringify(forkPayload.currentContent, null, 2)}\n`;
          }

          if (updatedContent !== null) {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, updatedContent, "utf-8");
            console.log(`[Forked Daemon] Applied post-rewind config update: ${filePath}`);
          }
        }
      }
    }

    // Send to the gateway to run a new agent
    try {
      if (deliveryHint?.channel === "telegram") {
        if (forkEchoMessage) {
          try {
            await sendForkEchoToGateway(forkEchoMessage, deliveryHint);
            console.log("[Forked Daemon] Sent Telegram fork echo.");
          } catch (echoErr) {
            console.warn("[Forked Daemon] Telegram fork echo failed (continuing):", echoErr.message);
          }
        }
      }

      const gwResult = await sendToGateway(forkMessage, sessionKey, deliveryHint);
      console.log("[Forked Daemon] Gateway fork response received. Status:", gwResult?.payload?.status ?? "unknown");

      const payload = gwResult?.payload ?? null;

      // Manually deliver the LLM response to the user's channel.
      // We do NOT use deliver:true on the agent request because the gateway routes
      // delivery via its own session-channel association, which may be stale (e.g.
      // points to WhatsApp when the user is now on Telegram).
      const responseTexts = payload?.result?.payloads
        ?.map((p) => (typeof p?.text === "string" ? p.text : null))
        .filter(Boolean) ?? [];
      const responseText = responseTexts.join("\n\n") || null;

      // Re-derive hint now (history is fresh after agent ran; also check full session)
      const postRunHint = deliveryHint ?? deriveForkDeliveryHint({ modifiedData, history: [], sessionKey });
      console.log("[Forked Daemon] Post-run delivery hint:", postRunHint ?? "(none)");

      if (responseText && postRunHint) {
        try {
          await sendForkEchoToGateway(responseText, postRunHint);
          console.log("[Forked Daemon] Manually delivered fork response to", postRunHint.channel, postRunHint.to);
        } catch (deliverErr) {
          console.warn("[Forked Daemon] Manual delivery failed (response was returned to caller anyway):", deliverErr.message);
        }
      } else if (responseText) {
        console.warn("[Forked Daemon] Have response text but no delivery hint — response not forwarded to user channel.");
      }
      const gatewayRunId =
        typeof payload?.runId === "string"
          ? payload.runId
          : typeof payload?.result?.runId === "string"
            ? payload.result.runId
            : null;
      if (gatewayRunId && pendingForks.has(forkId)) {
        tryLinkFork(gatewayRunId);
      }

      // If the fork wasn't linked during execution (e.g., traces arrived too fast or not at all),
      // try to find the new session by querying for recent runs in the same session.
      if (pendingForks.has(forkId)) {
        const startedAtSecs = Math.floor(forkStartedAt / 1000) - 1;
        const recentRuns = sessionKey
          ? db.prepare(
            `SELECT DISTINCT run_id FROM traces
               WHERE created_at > datetime(?, 'unixepoch')
                 AND session_key = ?
                 AND run_id != ? AND run_id != ?
               ORDER BY created_at DESC LIMIT 5`
          ).all(startedAtSecs, sessionKey, newSessionId, originalRunId)
          : db.prepare(
            `SELECT DISTINCT run_id FROM traces
               WHERE created_at > datetime(?, 'unixepoch')
                 AND run_id != ? AND run_id != ?
               ORDER BY created_at DESC LIMIT 5`
          ).all(startedAtSecs, newSessionId, originalRunId);

        for (const row of recentRuns) {
          if (!pendingForks.has(forkId)) break;
          if (!row?.run_id || row.run_id === newSessionId || row.run_id === originalRunId) continue;
          tryLinkFork(row.run_id);
        }
      }

      // Clean up pending fork if still unlinked (gateway completed but no traces came through)
      const wasLinked = !pendingForks.has(forkId);
      if (!wasLinked) {
        console.log(`[Forked Daemon] Fork completed but no matching traces found — placeholder retained`);
        pendingForks.delete(forkId);
      }

      res.json({
        success: true,
        newRunId: newSessionId,
        linked: wasLinked,
        message: wasLinked ? "Forked run completed and linked." : "Forked run completed (traces may still be arriving).",
        gatewayResult: gwResult.payload ?? null,
      });
    } catch (gwErr) {
      console.error("[Forked Daemon] Gateway call failed:", gwErr.message);
      pendingForks.delete(forkId);
      res.status(502).json({
        success: false,
        newRunId: newSessionId,
        message: `Gateway call failed: ${gwErr.message}`,
      });
    }
  } catch (error) {
    console.error("[Forked Daemon] Fork failed:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /api/config
app.get("/api/config", (_req, res) => {
  res.json({ retentionDays: retentionDays === -1 ? "never" : retentionDays });
});

app.get("/api/openclaw-config", (_req, res) => {
  try {
    const raw = readFileSync(OPENCLAW_CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);
    // Deep-clone then strip all sensitive fields
    const sanitized = JSON.parse(JSON.stringify(config));
    if (sanitized.env) {
      for (const key of Object.keys(sanitized.env)) sanitized.env[key] = "[REDACTED]";
    }
    if (sanitized.gateway?.auth?.token) sanitized.gateway.auth.token = "[REDACTED]";
    if (sanitized.channels) {
      for (const ch of Object.values(sanitized.channels)) {
        if (ch && typeof ch === "object") {
          for (const key of Object.keys(ch)) {
            if (/token|secret|key|password/i.test(key)) ch[key] = "[REDACTED]";
          }
        }
      }
    }
    if (sanitized.skills?.entries) {
      for (const skill of Object.values(sanitized.skills.entries)) {
        if (skill && typeof skill === "object") {
          for (const key of Object.keys(skill)) {
            if (/token|secret|key|password/i.test(key)) skill[key] = "[REDACTED]";
          }
        }
      }
    }
    res.json({ ok: true, config: sanitized });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.listen(API_PORT, "127.0.0.1", () => {
  console.log(`[Forked Daemon] API server listening at http://127.0.0.1:${API_PORT}`);
  console.log("[Forked Daemon] Ready. Waiting for tracer connections...");
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[Forked Daemon] Shutting down...");
  clearInterval(cleanupInterval);
  wss.close();
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[Forked Daemon] Shutting down...");
  clearInterval(cleanupInterval);
  wss.close();
  db.close();
  process.exit(0);
});
