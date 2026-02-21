import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import WebSocket from "ws";
import { readFileSync, existsSync, watchFile, watch, readdirSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";

const DAEMON_SCRIPT = (() => {
    try {
        const thisDir = path.dirname(fileURLToPath(import.meta.url));
        return path.resolve(thisDir, "../forked-daemon/index.js");
    } catch {
        return path.resolve(process.cwd(), "forked-daemon/index.js");
    }
})();

const DAEMON_WS_URL = "ws://127.0.0.1:7999";
const MAX_SNAPSHOT_BYTES = 512_000; // 512KB cap per file snapshot
const FILE_MODIFYING_TOOLS = new Set(["write", "edit", "apply_patch"]);

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setInterval> | null = null;
let seq = 0;
let lastRunId: string | undefined;
let lastSessionKey: string | undefined;
const pendingToolSnapshots = new Map<
    string,
    { filePath: string; contentBefore: string; existedBefore: boolean }
>();

function extractFilePath(params: Record<string, unknown>): string | null {
    const raw = params.file_path ?? params.path ?? params.filePath;
    return typeof raw === "string" ? raw : null;
}

function buildToolSnapshotKey(
    context: { runId?: string; sessionId?: string },
    toolName: string,
    filePath: string
): string {
    const runId = context.runId ?? lastRunId ?? "unknown";
    const sessionId = context.sessionId ?? lastSessionKey ?? "unknown";
    return `${runId}::${sessionId}::${toolName.toLowerCase()}::${filePath}`;
}

function snapshotFile(filePath: string): { content: string; exists: boolean } | null {
    try {
        if (!existsSync(filePath)) {
            return { content: "", exists: false };
        }
        const content = readFileSync(filePath, "utf-8");
        if (content.length > MAX_SNAPSHOT_BYTES) {
            return { content: content.slice(0, MAX_SNAPSHOT_BYTES) + "\n[TRUNCATED]", exists: true };
        }
        return { content, exists: true };
    } catch {
        return null;
    }
}

function readTextFileSafe(filePath: string): string | null {
    try {
        if (!existsSync(filePath)) return null;
        const content = readFileSync(filePath, "utf-8");
        if (content.length > MAX_SNAPSHOT_BYTES) {
            return content.slice(0, MAX_SNAPSHOT_BYTES) + "\n[TRUNCATED]";
        }
        return content;
    } catch {
        return null;
    }
}

function tryParseJson(raw: string | null): unknown {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function collectFilesRecursive(dirPath: string): string[] {
    const files: string[] = [];
    try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                files.push(...collectFilesRecursive(fullPath));
            } else if (entry.isFile()) {
                files.push(fullPath);
            }
        }
    } catch {
        // Ignore unreadable directories
    }
    return files;
}

type TracerLogger = {
    info?: (message: string) => void;
    error?: (message: string) => void;
};

function isDaemonRunning(): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get("http://127.0.0.1:8000/api/health", (res) => {
            resolve(res.statusCode === 200);
            res.resume();
        });
        req.on("error", () => resolve(false));
        req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

function spawnDaemon(logger: TracerLogger) {
    // Use process.execPath so the same Node.js binary that runs the gateway also
    // runs the daemon — this works even when the gateway runs as a launchctl
    // service where "node" may not be in PATH.
    logger.info?.(`[Forked Tracer] Spawning daemon: ${process.execPath} ${DAEMON_SCRIPT}`);
    const proc = spawn(process.execPath, [DAEMON_SCRIPT], {
        detached: true,
        stdio: "ignore",
    });
    proc.unref();
    logger.info?.(`[Forked Tracer] Daemon process started (pid: ${proc.pid})`);
}

async function ensureDaemonRunning(logger: TracerLogger) {
    const running = await isDaemonRunning();
    if (running) {
        logger.info?.("[Forked Tracer] Daemon already running, connecting...");
        connect(logger);
    } else {
        logger.info?.("[Forked Tracer] Daemon not running, starting it...");
        spawnDaemon(logger);
        // Give the daemon a moment to start before the first connection attempt.
        await new Promise<void>((resolve) => setTimeout(resolve, 1500));
        connect(logger);
    }
}

function connect(logger: TracerLogger) {
    logger.info?.(`[Forked Tracer] Connecting to daemon at ${DAEMON_WS_URL}`);

    try {
        ws = new WebSocket(DAEMON_WS_URL);
    } catch {
        scheduleReconnect(logger);
        return;
    }

    ws.on("open", () => {
        logger.info?.("[Forked Tracer] Connected to daemon.");
        if (reconnectTimer) {
            clearInterval(reconnectTimer);
            reconnectTimer = null;
        }
    });

    ws.on("close", () => {
        logger.info?.("[Forked Tracer] Disconnected from daemon. Retrying in 5s...");
        ws = null;
        scheduleReconnect(logger);
    });

    ws.on("error", (err) => {
        const detail =
            (typeof err?.message === "string" && err.message.trim()) ? err.message : String(err);
        logger.error?.(`[Forked Tracer] WebSocket error: ${detail}`);
    });
}

function scheduleReconnect(logger: TracerLogger) {
    if (!reconnectTimer) {
        reconnectTimer = setInterval(() => connect(logger), 5000);
    }
}

function sendTrace(stream: string, data: Record<string, unknown>, runId?: string, sessionKey?: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
    }
    if (runId) {
        lastRunId = runId;
    }
    if (sessionKey) {
        lastSessionKey = sessionKey;
    }
    seq++;
    const payload = {
        runId: runId ?? lastRunId ?? sessionKey ?? lastSessionKey ?? "unknown",
        sessionKey: sessionKey ?? lastSessionKey ?? null,
        seq,
        stream,
        ts: Date.now(),
        data,
    };
    try {
        ws.send(JSON.stringify(payload));
    } catch {
        // connection may have dropped mid-send
    }
}

function sendBackgroundLifecycleTrace(data: Record<string, unknown>) {
    // Background file watchers are outside active hooks; require a known session to avoid "unknown" noise.
    if (!lastSessionKey) return;
    const stamp = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const runId = `bg_${lastSessionKey.slice(0, 8)}_${stamp}`;
    sendTrace("lifecycle", data, runId, lastSessionKey);
}

const plugin = {
    id: "forked-tracer",
    name: "Forked Tracer",
    description: "Time-travel debugger tracer that captures agent execution events for Forked.",
    configSchema: emptyPluginConfigSchema(),

    register(api: OpenClawPluginApi) {
        api.logger.info?.("[Forked Tracer] Extension loaded. Initializing...");

        void ensureDaemonRunning(api.logger);

        // --- Lifecycle Hooks ---

        api.on("gateway_start", async (event) => {
            sendTrace("lifecycle", { type: "gateway_start", port: (event as any).port });
        });

        api.on("session_start", async (event) => {
            const e = event as any;
            sendTrace("lifecycle", {
                type: "session_start",
                sessionId: e.sessionId,
                resumedFrom: e.resumedFrom,
            }, undefined, e.sessionId);
        });

        api.on("session_end", async (event) => {
            const e = event as any;
            sendTrace("lifecycle", {
                type: "session_end",
                sessionId: e.sessionId,
                messageCount: e.messageCount,
                durationMs: e.durationMs,
            }, undefined, e.sessionId);
        });

        // --- LLM Hooks ---

        api.on("llm_input", async (event) => {
            const e = event as any;
            sendTrace("assistant", {
                type: "llm_input",
                provider: e.provider,
                model: e.model,
                prompt: e.prompt,
                systemPromptLength: e.systemPrompt?.length ?? 0,
                historyMessageCount: e.historyMessages?.length ?? 0,
                imagesCount: e.imagesCount ?? 0,
            }, e.runId, e.sessionId);
        });

        api.on("llm_output", async (event) => {
            const e = event as any;
            sendTrace("assistant", {
                type: "llm_output",
                provider: e.provider,
                model: e.model,
                assistantTexts: e.assistantTexts,
                usage: e.usage,
            }, e.runId, e.sessionId);
        });

        // --- Tool Hooks (with file snapshot capture) ---

        api.on("before_tool_call", async (event) => {
            const e = event as any;
            const toolName = (e.toolName ?? "").toLowerCase();
            const params = e.params ?? {};

            let fileSnapshot: Record<string, unknown> | undefined;
            if (FILE_MODIFYING_TOOLS.has(toolName)) {
                const filePath = extractFilePath(params);
                if (filePath) {
                    const snap = snapshotFile(filePath);
                    if (snap) {
                        pendingToolSnapshots.set(buildToolSnapshotKey(e, toolName, filePath), {
                            filePath,
                            contentBefore: snap.content,
                            existedBefore: snap.exists,
                        });
                        fileSnapshot = {
                            filePath,
                            contentBefore: snap.content,
                            existedBefore: snap.exists,
                        };
                    }
                }
            }

            sendTrace("tool", {
                type: "tool_call_start",
                toolName: e.toolName,
                params: e.params,
                ...(fileSnapshot ? { fileSnapshot } : {}),
            }, e.runId, e.sessionId);
        });

        api.on("after_tool_call", async (event) => {
            const e = event as any;
            const toolName = (e.toolName ?? "").toLowerCase();
            const params = e.params ?? {};

            let fileSnapshot: Record<string, unknown> | undefined;
            if (FILE_MODIFYING_TOOLS.has(toolName)) {
                const filePath = extractFilePath(params);
                if (filePath) {
                    const snap = snapshotFile(filePath);
                    if (snap) {
                        const key = buildToolSnapshotKey(e, toolName, filePath);
                        const before = pendingToolSnapshots.get(key);
                        if (before) {
                            pendingToolSnapshots.delete(key);
                        }
                        fileSnapshot = {
                            filePath,
                            contentBefore: before?.contentBefore,
                            existedBefore: before?.existedBefore,
                            contentAfter: snap.content,
                            existsAfter: snap.exists,
                        };
                    }
                }
            }

            sendTrace("tool", {
                type: "tool_call_end",
                toolName: e.toolName,
                params: e.params,
                result: e.result,
                error: e.error,
                durationMs: e.durationMs,
                ...(fileSnapshot ? { fileSnapshot } : {}),
            }, e.runId, e.sessionId);
        });

        // --- Message Hooks ---

        api.on("message_received", async (event) => {
            const e = event as any;
            sendTrace("lifecycle", {
                type: "message_received",
                from: e.from,
                content: e.content,
                timestamp: e.timestamp,
            }, e.runId, e.sessionId);
        });

        api.on("message_sent", async (event) => {
            const e = event as any;
            sendTrace("lifecycle", {
                type: "message_sent",
                to: e.to,
                content: e.content,
            }, e.runId, e.sessionId);
        });

        // --- Agent End ---

        api.on("agent_end", async (event) => {
            const e = event as any;
            sendTrace("lifecycle", {
                type: "agent_end",
                success: e.success,
                error: e.error,
                durationMs: e.durationMs,
                messageCount: e.messages?.length ?? 0,
            }, e.runId, e.sessionId);
        });

        // --- Config Watching ---
        const OPENCLAW_HOME = path.join(process.env.HOME ?? "", ".openclaw");
        const OPENCLAW_CONFIG = path.join(OPENCLAW_HOME, "openclaw.json");
        const OPENCLAW_SKILLS_DIR = path.join(OPENCLAW_HOME, "skills");
        const OPENCLAW_EXTENSIONS_DIR = path.join(OPENCLAW_HOME, "extensions");
        const watchedConfigs: string[] = [OPENCLAW_CONFIG];
        const watchedSetupDirs: Array<{ dirPath: string; category: string }> = [
            { dirPath: OPENCLAW_SKILLS_DIR, category: "skills" },
            { dirPath: OPENCLAW_EXTENSIONS_DIR, category: "extensions" },
        ];
        const setupPollIntervalMs = 4000;

        // Track last known content for diffing
        const configCache = new Map<string, string>();

        function readConfigSafe(filePath: string): string | null {
            return readTextFileSafe(filePath);
        }

        function onConfigChange(filePath: string) {
            const newContent = readConfigSafe(filePath);
            const oldContent = configCache.get(filePath) ?? null;
            if (newContent === oldContent) return; // no actual change

            configCache.set(filePath, newContent ?? "");

            let parsedOld: unknown = null;
            let parsedNew: unknown = null;
            try { parsedOld = oldContent ? JSON.parse(oldContent) : null; } catch { /* skip */ }
            try { parsedNew = newContent ? JSON.parse(newContent) : null; } catch { /* skip */ }

            sendBackgroundLifecycleTrace({
                type: "config_change",
                filePath,
                previousRaw: oldContent,
                currentRaw: newContent,
                previousContent: parsedOld,
                currentContent: parsedNew,
                fileSnapshot: {
                    filePath,
                    contentBefore: oldContent ?? "",
                    contentAfter: newContent ?? "",
                    existedBefore: oldContent !== null,
                    existsAfter: newContent !== null,
                },
            });

            api.logger.info?.(`[Forked Tracer] Config change detected: ${filePath}`);
        }

        function onSetupFileChange(filePath: string, category: string) {
            const newContent = readTextFileSafe(filePath);
            const oldContent = configCache.get(filePath) ?? null;
            if (newContent === oldContent) return; // no actual change

            configCache.set(filePath, newContent ?? "");

            sendBackgroundLifecycleTrace({
                type: "setup_file_change",
                category,
                filePath,
                previousRaw: oldContent,
                currentRaw: newContent,
                previousContent: tryParseJson(oldContent),
                currentContent: tryParseJson(newContent),
                fileSnapshot: {
                    filePath,
                    contentBefore: oldContent ?? "",
                    contentAfter: newContent ?? "",
                    existedBefore: oldContent !== null,
                    existsAfter: newContent !== null,
                },
            });

            api.logger.info?.(`[Forked Tracer] Setup file change detected (${category}): ${filePath}`);
        }

        function primeSetupDirectory(entry: { dirPath: string; category: string }) {
            const dirPath = entry.dirPath;
            if (!existsSync(dirPath)) return;
            for (const filePath of collectFilesRecursive(dirPath)) {
                const content = readTextFileSafe(filePath);
                if (content !== null) {
                    configCache.set(filePath, content);
                }
            }
        }

        function syncSetupDirectory(entry: { dirPath: string; category: string }) {
            const dirPath = entry.dirPath;
            const prefix = `${dirPath}${path.sep}`;
            const currentFiles = existsSync(dirPath) ? collectFilesRecursive(dirPath) : [];
            const currentSet = new Set(currentFiles);

            for (const filePath of currentFiles) {
                onSetupFileChange(filePath, entry.category);
            }

            // Detect deletions: cached file existed before but no longer in filesystem.
            for (const cachedPath of configCache.keys()) {
                if (!cachedPath.startsWith(prefix)) continue;
                if (!currentSet.has(cachedPath)) {
                    onSetupFileChange(cachedPath, entry.category);
                }
            }
        }

        // Initialize cache and start watching
        for (const cfgPath of watchedConfigs) {
            const content = readConfigSafe(cfgPath);
            if (content !== null) {
                configCache.set(cfgPath, content);
            }
            try {
                watchFile(cfgPath, { interval: 5000 }, () => onConfigChange(cfgPath));
            } catch {
                api.logger.error?.(`[Forked Tracer] Could not watch config: ${cfgPath}`);
            }
        }

        for (const entry of watchedSetupDirs) {
            const dirPath = entry.dirPath;
            primeSetupDirectory(entry);

            try {
                watch(dirPath, { recursive: true }, (_eventType, fileName) => {
                    const relative = fileName ? String(fileName) : "";
                    if (!relative) return;
                    const filePath = path.isAbsolute(relative) ? relative : path.join(dirPath, relative);
                    onSetupFileChange(filePath, entry.category);
                });
                api.logger.info?.(`[Forked Tracer] Watching setup directory: ${dirPath}`);
            } catch {
                api.logger.error?.(`[Forked Tracer] Could not watch setup directory: ${dirPath} (polling fallback still active)`);
            }
        }

        setInterval(() => {
            for (const entry of watchedSetupDirs) {
                syncSetupDirectory(entry);
            }
        }, setupPollIntervalMs);

        api.logger.info?.("[Forked Tracer] All hooks attached. Waiting for agent activity.");
    },
};

export default plugin;
