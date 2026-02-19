// No dependency on the openclaw package at runtime.
// `import type` is erased by jiti's transpiler — safe to keep for IDE support.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import WebSocket from "ws";
import { readFileSync, existsSync, watchFile, watch, readdirSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";

// Inline emptyPluginConfigSchema — removes the runtime dep on openclaw/plugin-sdk.
// Mirrors the implementation from openclaw/src/plugins/config-schema.ts exactly.
function emptyPluginConfigSchema() {
    return {
        safeParse(value: unknown) {
            if (value === undefined) return { success: true as const, data: undefined };
            if (!value || typeof value !== "object" || Array.isArray(value))
                return { success: false as const, error: { issues: [{ path: [] as (string | number)[], message: "expected config object" }] } };
            if (Object.keys(value as Record<string, unknown>).length > 0)
                return { success: false as const, error: { issues: [{ path: [] as (string | number)[], message: "config must be empty" }] } };
            return { success: true as const, data: value };
        },
        jsonSchema: { type: "object", additionalProperties: false, properties: {} },
    };
}

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
        if (!existsSync(filePath)) return { content: "", exists: false };
        const content = readFileSync(filePath, "utf-8");
        if (content.length > MAX_SNAPSHOT_BYTES)
            return { content: content.slice(0, MAX_SNAPSHOT_BYTES) + "\n[TRUNCATED]", exists: true };
        return { content, exists: true };
    } catch {
        return null;
    }
}

function readTextFileSafe(filePath: string): string | null {
    try {
        if (!existsSync(filePath)) return null;
        const content = readFileSync(filePath, "utf-8");
        if (content.length > MAX_SNAPSHOT_BYTES)
            return content.slice(0, MAX_SNAPSHOT_BYTES) + "\n[TRUNCATED]";
        return content;
    } catch {
        return null;
    }
}

function tryParseJson(raw: string | null): unknown {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function collectFilesRecursive(dirPath: string): string[] {
    const files: string[] = [];
    try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) files.push(...collectFilesRecursive(fullPath));
            else if (entry.isFile()) files.push(fullPath);
        }
    } catch { /* ignore unreadable dirs */ }
    return files;
}

type TracerLogger = { info?: (message: string) => void; error?: (message: string) => void };

function isDaemonRunning(): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get("http://127.0.0.1:8000/api/health", (res) => {
            resolve(res.statusCode === 200);
            res.resume();
        });
        req.on("error", () => resolve(false));
        req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
}

function spawnDaemon(logger: TracerLogger) {
    logger.info?.(`[Forked Tracer] Spawning daemon: node ${DAEMON_SCRIPT}`);
    const proc = spawn("node", [DAEMON_SCRIPT], { detached: true, stdio: "ignore" });
    proc.unref();
    logger.info?.(`[Forked Tracer] Daemon process started (pid: ${proc.pid})`);
}

async function ensureDaemonRunning(logger: TracerLogger) {
    const running = await isDaemonRunning();
    if (running) {
        logger.info?.("[Forked Tracer] Daemon already running, connecting...");
    } else {
        logger.info?.("[Forked Tracer] Daemon not running, starting it...");
        spawnDaemon(logger);
    }
    connect(logger);
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
        if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
    });
    ws.on("close", () => {
        logger.info?.("[Forked Tracer] Disconnected from daemon. Retrying in 5s...");
        ws = null;
        scheduleReconnect(logger);
    });
    ws.on("error", (err) => {
        const detail = (typeof err?.message === "string" && err.message.trim()) ? err.message : String(err);
        logger.error?.(`[Forked Tracer] WebSocket error: ${detail}`);
    });
}

function scheduleReconnect(logger: TracerLogger) {
    if (!reconnectTimer) reconnectTimer = setInterval(() => connect(logger), 5000);
}

function sendTrace(stream: string, data: Record<string, unknown>, runId?: string, sessionKey?: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (runId) lastRunId = runId;
    if (sessionKey) lastSessionKey = sessionKey;
    seq++;
    const payload = {
        runId: runId ?? lastRunId ?? sessionKey ?? lastSessionKey ?? "unknown",
        sessionKey: sessionKey ?? lastSessionKey ?? null,
        seq, stream, ts: Date.now(), data,
    };
    try { ws.send(JSON.stringify(payload)); } catch { /* dropped */ }
}

function sendBackgroundLifecycleTrace(data: Record<string, unknown>) {
    if (!lastSessionKey) return;
    const stamp = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    sendTrace("lifecycle", data, `bg_${lastSessionKey.slice(0, 8)}_${stamp}`, lastSessionKey);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PluginApi = { logger: TracerLogger; on: (event: string, handler: (event: any) => Promise<void>) => void };

const plugin = {
    id: "forked-tracer",
    name: "Forked Tracer",
    description: "Time-travel debugger tracer that captures agent execution events for Forked.",
    configSchema: emptyPluginConfigSchema(),

    register(api: PluginApi) {
        api.logger.info?.("[Forked Tracer] Extension loaded. Initializing...");

        void ensureDaemonRunning(api.logger);

        // --- Lifecycle ---

        api.on("gateway_start", async (event) => {
            sendTrace("lifecycle", { type: "gateway_start", port: event.port });
        });

        api.on("session_start", async (event) => {
            sendTrace("lifecycle", {
                type: "session_start", sessionId: event.sessionId, resumedFrom: event.resumedFrom,
            }, undefined, event.sessionId);
        });

        api.on("session_end", async (event) => {
            sendTrace("lifecycle", {
                type: "session_end", sessionId: event.sessionId,
                messageCount: event.messageCount, durationMs: event.durationMs,
            }, undefined, event.sessionId);
        });

        // --- LLM ---

        api.on("llm_input", async (event) => {
            sendTrace("assistant", {
                type: "llm_input", provider: event.provider, model: event.model,
                prompt: event.prompt, systemPromptLength: event.systemPrompt?.length ?? 0,
                historyMessageCount: event.historyMessages?.length ?? 0, imagesCount: event.imagesCount ?? 0,
            }, event.runId, event.sessionId);
        });

        api.on("llm_output", async (event) => {
            sendTrace("assistant", {
                type: "llm_output", provider: event.provider, model: event.model,
                assistantTexts: event.assistantTexts, usage: event.usage,
            }, event.runId, event.sessionId);
        });

        // --- Tools ---

        api.on("before_tool_call", async (event) => {
            const toolName = (event.toolName ?? "").toLowerCase();
            const params = event.params ?? {};
            let fileSnapshot: Record<string, unknown> | undefined;
            if (FILE_MODIFYING_TOOLS.has(toolName)) {
                const filePath = extractFilePath(params);
                if (filePath) {
                    const snap = snapshotFile(filePath);
                    if (snap) {
                        pendingToolSnapshots.set(buildToolSnapshotKey(event, toolName, filePath), {
                            filePath, contentBefore: snap.content, existedBefore: snap.exists,
                        });
                        fileSnapshot = { filePath, contentBefore: snap.content, existedBefore: snap.exists };
                    }
                }
            }
            sendTrace("tool", {
                type: "tool_call_start", toolName: event.toolName, params: event.params,
                ...(fileSnapshot ? { fileSnapshot } : {}),
            }, event.runId, event.sessionId);
        });

        api.on("after_tool_call", async (event) => {
            const toolName = (event.toolName ?? "").toLowerCase();
            const params = event.params ?? {};
            let fileSnapshot: Record<string, unknown> | undefined;
            if (FILE_MODIFYING_TOOLS.has(toolName)) {
                const filePath = extractFilePath(params);
                if (filePath) {
                    const snap = snapshotFile(filePath);
                    if (snap) {
                        const key = buildToolSnapshotKey(event, toolName, filePath);
                        const before = pendingToolSnapshots.get(key);
                        if (before) pendingToolSnapshots.delete(key);
                        fileSnapshot = {
                            filePath, contentBefore: before?.contentBefore,
                            existedBefore: before?.existedBefore, contentAfter: snap.content, existsAfter: snap.exists,
                        };
                    }
                }
            }
            sendTrace("tool", {
                type: "tool_call_end", toolName: event.toolName, params: event.params,
                result: event.result, error: event.error, durationMs: event.durationMs,
                ...(fileSnapshot ? { fileSnapshot } : {}),
            }, event.runId, event.sessionId);
        });

        // --- Messages ---

        api.on("message_received", async (event) => {
            sendTrace("lifecycle", {
                type: "message_received", from: event.from, content: event.content, timestamp: event.timestamp,
            }, event.runId, event.sessionId);
        });

        api.on("message_sent", async (event) => {
            sendTrace("lifecycle", {
                type: "message_sent", to: event.to, content: event.content,
            }, event.runId, event.sessionId);
        });

        // --- Agent End ---

        api.on("agent_end", async (event) => {
            sendTrace("lifecycle", {
                type: "agent_end", success: event.success, error: event.error,
                durationMs: event.durationMs, messageCount: event.messages?.length ?? 0,
            }, event.runId, event.sessionId);
        });

        // --- Config + Setup file watching ---

        const OPENCLAW_HOME = path.join(process.env.HOME ?? "", ".openclaw");
        const OPENCLAW_CONFIG = path.join(OPENCLAW_HOME, "openclaw.json");
        const OPENCLAW_SKILLS_DIR = path.join(OPENCLAW_HOME, "skills");
        const OPENCLAW_EXTENSIONS_DIR = path.join(OPENCLAW_HOME, "extensions");
        const watchedSetupDirs = [
            { dirPath: OPENCLAW_SKILLS_DIR, category: "skills" },
            { dirPath: OPENCLAW_EXTENSIONS_DIR, category: "extensions" },
        ];
        const configCache = new Map<string, string>();

        function onConfigChange(filePath: string) {
            const newContent = readTextFileSafe(filePath);
            const oldContent = configCache.get(filePath) ?? null;
            if (newContent === oldContent) return;
            configCache.set(filePath, newContent ?? "");
            let parsedOld: unknown = null, parsedNew: unknown = null;
            try { parsedOld = oldContent ? JSON.parse(oldContent) : null; } catch { /* skip */ }
            try { parsedNew = newContent ? JSON.parse(newContent) : null; } catch { /* skip */ }
            sendBackgroundLifecycleTrace({
                type: "config_change", filePath,
                previousRaw: oldContent, currentRaw: newContent,
                previousContent: parsedOld, currentContent: parsedNew,
                fileSnapshot: {
                    filePath, contentBefore: oldContent ?? "", contentAfter: newContent ?? "",
                    existedBefore: oldContent !== null, existsAfter: newContent !== null,
                },
            });
            api.logger.info?.(`[Forked Tracer] Config change detected: ${filePath}`);
        }

        function onSetupFileChange(filePath: string, category: string) {
            const newContent = readTextFileSafe(filePath);
            const oldContent = configCache.get(filePath) ?? null;
            if (newContent === oldContent) return;
            configCache.set(filePath, newContent ?? "");
            sendBackgroundLifecycleTrace({
                type: "setup_file_change", category, filePath,
                previousRaw: oldContent, currentRaw: newContent,
                previousContent: tryParseJson(oldContent), currentContent: tryParseJson(newContent),
                fileSnapshot: {
                    filePath, contentBefore: oldContent ?? "", contentAfter: newContent ?? "",
                    existedBefore: oldContent !== null, existsAfter: newContent !== null,
                },
            });
            api.logger.info?.(`[Forked Tracer] Setup file change detected (${category}): ${filePath}`);
        }

        function primeDir(entry: { dirPath: string; category: string }) {
            if (!existsSync(entry.dirPath)) return;
            for (const fp of collectFilesRecursive(entry.dirPath)) {
                const c = readTextFileSafe(fp);
                if (c !== null) configCache.set(fp, c);
            }
        }

        function syncDir(entry: { dirPath: string; category: string }) {
            const prefix = `${entry.dirPath}${path.sep}`;
            const current = existsSync(entry.dirPath) ? collectFilesRecursive(entry.dirPath) : [];
            const currentSet = new Set(current);
            for (const fp of current) onSetupFileChange(fp, entry.category);
            for (const fp of configCache.keys()) {
                if (fp.startsWith(prefix) && !currentSet.has(fp)) onSetupFileChange(fp, entry.category);
            }
        }

        const cfgContent = readTextFileSafe(OPENCLAW_CONFIG);
        if (cfgContent !== null) configCache.set(OPENCLAW_CONFIG, cfgContent);
        try {
            watchFile(OPENCLAW_CONFIG, { interval: 5000 }, () => onConfigChange(OPENCLAW_CONFIG));
        } catch {
            api.logger.error?.(`[Forked Tracer] Could not watch config: ${OPENCLAW_CONFIG}`);
        }

        for (const entry of watchedSetupDirs) {
            primeDir(entry);
            try {
                watch(entry.dirPath, { recursive: true }, (_type, fileName) => {
                    const rel = fileName ? String(fileName) : "";
                    if (!rel) return;
                    const fp = path.isAbsolute(rel) ? rel : path.join(entry.dirPath, rel);
                    onSetupFileChange(fp, entry.category);
                });
                api.logger.info?.(`[Forked Tracer] Watching setup directory: ${entry.dirPath}`);
            } catch {
                api.logger.error?.(`[Forked Tracer] Could not watch setup directory: ${entry.dirPath}`);
            }
        }

        setInterval(() => { for (const e of watchedSetupDirs) syncDir(e); }, 4000);

        api.logger.info?.("[Forked Tracer] All hooks attached. Waiting for agent activity.");
    },
};

export default plugin;
