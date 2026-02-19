import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check, MessageSquare, Bot, Wrench, FileText, Zap, ArrowRight, AlertCircle } from "lucide-react";

// ─── Diff helpers ────────────────────────────────────────────────────────────

type DiffLine = { kind: "context" | "add" | "remove"; text: string };

function splitLines(input: string): string[] {
  return input.replaceAll("\r\n", "\n").split("\n");
}

function buildLineDiff(beforeText: string, afterText: string): DiffLine[] | "too_large" {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);
  const MAX = 240;
  if (before.length > MAX || after.length > MAX) return "too_large";
  const n = before.length, m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const diff: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) { diff.push({ kind: "context", text: before[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { diff.push({ kind: "remove", text: before[i] }); i++; }
    else { diff.push({ kind: "add", text: after[j] }); j++; }
  }
  while (i < n) diff.push({ kind: "remove", text: before[i++] });
  while (j < m) diff.push({ kind: "add", text: after[j++] });
  return diff;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>) : null;
}

// ─── Pill / Label helpers ─────────────────────────────────────────────────────

function Pill({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border ${accent ? "bg-terminal-green/10 border-terminal-green/20 text-terminal-green/80" : "bg-surface-1 border-border-subtle text-slate-400"}`}>
      <span className="text-slate-500">{label}</span>
      <span className={accent ? "text-terminal-green/90" : "text-slate-300"}>{value}</span>
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[9px] uppercase tracking-widest text-slate-600 font-mono mb-1">{children}</div>;
}

// ─── Extract real user message from llm_input prompt ─────────────────────────

function extractUserMessage(prompt: string): { meta: Record<string, string> | null; message: string } {
  // Strip the "Conversation info (untrusted metadata):\n```json\n...\n```\n\n" prefix
  const metaMatch = prompt.match(/^Conversation info \(untrusted metadata\):\s*```json\s*([\s\S]*?)```\s*([\s\S]*)$/);
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1]);
      return { meta, message: metaMatch[2].trim() };
    } catch { /* fall through */ }
  }
  return { meta: null, message: prompt.trim() };
}

// ─── Friendly event card renderers ───────────────────────────────────────────

function LlmInputCard({ data }: { data: Record<string, unknown> }) {
  const prompt = typeof data.prompt === "string" ? data.prompt : "";
  const { meta, message } = extractUserMessage(prompt);
  const provider = typeof data.provider === "string" ? data.provider : null;
  const model = typeof data.model === "string" ? data.model : null;
  const historyCount = typeof data.historyMessageCount === "number" ? data.historyMessageCount : null;
  const sysLen = typeof data.systemPromptLength === "number" ? data.systemPromptLength : null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-medium">
        <Bot size={13} className="text-terminal-green/70" />
        AI received a message
      </div>

      {message && (
        <div>
          <SectionLabel>Message</SectionLabel>
          <div className="bg-surface-0 border border-border-subtle rounded p-2.5 text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
            {message}
          </div>
        </div>
      )}

      {meta && (
        <div>
          <SectionLabel>Sender info</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(meta).map(([k, v]) => (
              <Pill key={k} label={k} value={String(v)} />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {provider && model && <Pill label="model" value={`${provider} / ${model}`} accent />}
        {historyCount !== null && <Pill label="context" value={`${historyCount} prior messages`} />}
        {sysLen !== null && <Pill label="system prompt" value={`${(sysLen / 1000).toFixed(1)}k chars`} />}
      </div>
    </div>
  );
}

function LlmOutputCard({ data }: { data: Record<string, unknown> }) {
  const content = typeof data.content === "string" ? data.content
    : Array.isArray(data.content) ? data.content.map((c: unknown) => (toRecord(c)?.text ?? "")).join("\n")
      : typeof data.text === "string" ? data.text : null;
  const inputTokens = typeof data.inputTokens === "number" ? data.inputTokens : null;
  const outputTokens = typeof data.outputTokens === "number" ? data.outputTokens : null;
  const stopReason = typeof data.stopReason === "string" ? data.stopReason : null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-medium">
        <Zap size={13} className="text-terminal-green/70" />
        AI generated a response
      </div>
      {content && (
        <div>
          <SectionLabel>Response</SectionLabel>
          <div className="bg-surface-0 border border-border-subtle rounded p-2.5 text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
            {content}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {inputTokens !== null && <Pill label="input tokens" value={inputTokens.toLocaleString()} />}
        {outputTokens !== null && <Pill label="output tokens" value={outputTokens.toLocaleString()} accent />}
        {stopReason && <Pill label="stop reason" value={stopReason} />}
      </div>
    </div>
  );
}

function ToolCallCard({ data }: { data: Record<string, unknown> }) {
  const toolName = typeof data.toolName === "string" ? data.toolName
    : typeof data.name === "string" ? data.name : "unknown tool";
  const params = toRecord(data.input) ?? toRecord(data.params) ?? toRecord(data.arguments) ?? null;

  // Pick the 2-3 most useful params to highlight
  const keyParams = params
    ? Object.entries(params).slice(0, 3).filter(([, v]) => typeof v !== "object")
    : [];

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-medium">
        <Wrench size={13} className="text-amber-400/70" />
        AI used a tool
      </div>
      <div className="flex items-center gap-2">
        <span className="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[12px] font-mono font-semibold">
          {toolName}
        </span>
      </div>
      {keyParams.length > 0 && (
        <div>
          <SectionLabel>Parameters</SectionLabel>
          <div className="space-y-1">
            {keyParams.map(([k, v]) => (
              <div key={k} className="flex items-start gap-2 text-[10px] font-mono">
                <span className="text-slate-500 shrink-0">{k}</span>
                <ArrowRight size={8} className="text-slate-600 mt-0.5 shrink-0" />
                <span className="text-slate-300 break-all">{String(v).slice(0, 120)}{String(v).length > 120 ? "…" : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolResultCard({ data }: { data: Record<string, unknown> }) {
  const toolName = typeof data.toolName === "string" ? data.toolName
    : typeof data.name === "string" ? data.name : null;
  const isError = data.isError === true;
  const output = typeof data.output === "string" ? data.output
    : typeof data.content === "string" ? data.content
      : null;
  const durationMs = typeof data.durationMs === "number" ? data.durationMs : null;

  return (
    <div className="space-y-2.5">
      <div className={`flex items-center gap-1.5 text-[11px] font-medium ${isError ? "text-red-400" : "text-slate-400"}`}>
        {isError ? <AlertCircle size={13} className="text-red-400" /> : <Check size={13} className="text-terminal-green/70" />}
        Tool {isError ? "failed" : "completed"}{toolName ? `: ${toolName}` : ""}
      </div>
      {output && (
        <div>
          <SectionLabel>Output</SectionLabel>
          <div className={`rounded p-2.5 text-[10px] font-mono leading-relaxed whitespace-pre-wrap break-words max-h-36 overflow-y-auto border ${isError ? "bg-red-500/5 border-red-500/20 text-red-300" : "bg-surface-0 border-border-subtle text-slate-400"}`}>
            {output.slice(0, 800)}{output.length > 800 ? "\n…(truncated)" : ""}
          </div>
        </div>
      )}
      {durationMs !== null && (
        <Pill label="took" value={durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`} />
      )}
    </div>
  );
}

function MessageCard({ data, type }: { data: Record<string, unknown>; type: "received" | "sent" }) {
  const content = typeof data.content === "string" ? data.content : null;
  const from = typeof data.from === "string" ? data.from : null;
  const to = typeof data.to === "string" ? data.to : null;

  // Friendly format: "telegram:group:-100123" → "Telegram Group"
  const formatAddress = (addr: string) => {
    const parts = addr.split(":");
    if (parts.length >= 2) {
      const ch = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      const kind = parts[1] === "group" ? "Group" : parts[1] === "direct" ? "Direct" : parts[1];
      return `${ch} ${kind}`;
    }
    return addr;
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-medium">
        <MessageSquare size={13} className={type === "received" ? "text-blue-400/70" : "text-terminal-green/70"} />
        {type === "received" ? "Message received from user" : "AI replied to user"}
      </div>
      {(from || to) && (
        <div className="flex flex-wrap gap-1.5">
          {from && <Pill label={type === "received" ? "from" : "to"} value={formatAddress(from || to!)} accent={type === "received"} />}
          {to && type === "received" && <Pill label="to" value={formatAddress(to)} />}
        </div>
      )}
      {content && (
        <div>
          <SectionLabel>Content</SectionLabel>
          <div className="bg-surface-0 border border-border-subtle rounded p-2.5 text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

function FileChangeCard({ data }: { data: Record<string, unknown> }) {
  const filePath = typeof data.filePath === "string" ? data.filePath : null;
  const category = typeof data.category === "string" ? data.category : null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-medium">
        <FileText size={13} className="text-purple-400/70" />
        Configuration file changed
      </div>
      {filePath && (
        <div>
          <SectionLabel>File</SectionLabel>
          <div className="bg-surface-0 border border-border-subtle rounded px-2.5 py-1.5 text-[10px] font-mono text-slate-300 break-all">
            {filePath}
          </div>
        </div>
      )}
      {category && <Pill label="category" value={category} accent />}
    </div>
  );
}

// ─── Friendly card dispatcher ─────────────────────────────────────────────────

function FriendlyCard({ data }: { data: Record<string, unknown> }) {
  const type = typeof data.type === "string" ? data.type : null;

  if (type === "llm_input") return <LlmInputCard data={data} />;
  if (type === "llm_output") return <LlmOutputCard data={data} />;
  if (type === "tool_call") return <ToolCallCard data={data} />;
  if (type === "tool_result") return <ToolResultCard data={data} />;
  if (type === "message_received") return <MessageCard data={data} type="received" />;
  if (type === "message_sent") return <MessageCard data={data} type="sent" />;
  if (type === "config_change" || type === "setup_file_change") return <FileChangeCard data={data} />;

  return null; // fall through to raw JSON
}

// ─── Diff view ────────────────────────────────────────────────────────────────

function DiffView({ beforeRaw, afterRaw, filePath }: { beforeRaw: string; afterRaw: string; filePath: string | null }) {
  const lineDiff = useMemo(() => {
    if (beforeRaw === afterRaw) return [];
    return buildLineDiff(beforeRaw, afterRaw);
  }, [beforeRaw, afterRaw]);

  return (
    <div className="mb-2 border border-dashed border-border-default rounded bg-surface-1/70 overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-dashed border-border-default flex items-center justify-between gap-2">
        <span className="text-[9px] text-slate-500 uppercase tracking-wider font-mono">Diff Preview</span>
        {filePath && (
          <span className="text-[9px] text-slate-600 font-mono truncate max-w-[60%]" title={filePath}>
            {filePath}
          </span>
        )}
      </div>
      {lineDiff === "too_large" ? (
        <div className="px-3 py-2 text-[10px] text-slate-500 font-mono">Diff hidden: change is too large for inline preview.</div>
      ) : lineDiff.length === 0 ? (
        <div className="px-3 py-2 text-[10px] text-slate-500 font-mono">No text changes.</div>
      ) : (
        <div className="max-h-44 overflow-auto">
          {lineDiff.map((line, idx) => {
            const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
            const lineClass = line.kind === "add" ? "bg-emerald-500/8 text-emerald-300"
              : line.kind === "remove" ? "bg-red-500/8 text-red-300"
                : "text-slate-500";
            return (
              <pre key={`${idx}:${prefix}`} className={`px-3 py-0.5 text-[10px] font-mono whitespace-pre-wrap break-all ${lineClass}`}>
                <span className="opacity-70 mr-1">{prefix}</span>{line.text}
              </pre>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DataInspector({ data }: { data: Record<string, unknown> }) {
  const [rawOpen, setRawOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const snapshot = toRecord(data.fileSnapshot);
  const filePath =
    (typeof snapshot?.filePath === "string" && snapshot.filePath) ||
    (typeof data.filePath === "string" && data.filePath) ||
    null;

  const beforeRaw =
    (typeof snapshot?.contentBefore === "string" ? snapshot.contentBefore : null) ??
    (typeof data.previousRaw === "string" ? data.previousRaw : null);
  const afterRaw =
    (typeof snapshot?.contentAfter === "string" ? snapshot.contentAfter : null) ??
    (typeof data.currentRaw === "string" ? data.currentRaw : null);

  const displayData = { ...data };
  delete displayData.fileSnapshot;
  const jsonStr = JSON.stringify(displayData, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const hasFriendlyCard = (
    typeof data.type === "string" &&
    ["llm_input", "llm_output", "tool_call", "tool_result", "message_received", "message_sent", "config_change", "setup_file_change"].includes(data.type)
  );

  return (
    <div className="space-y-2.5">
      {/* Diff view for file changes */}
      {typeof beforeRaw === "string" && typeof afterRaw === "string" && (
        <DiffView beforeRaw={beforeRaw} afterRaw={afterRaw} filePath={filePath} />
      )}

      {/* Friendly card */}
      {hasFriendlyCard && (
        <div className="rounded border border-border-subtle bg-surface-1/50 p-3">
          <FriendlyCard data={data} />
        </div>
      )}

      {/* Raw JSON toggle */}
      <div>
        <button
          onClick={() => setRawOpen(!rawOpen)}
          className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 transition-colors cursor-pointer font-mono tracking-wider uppercase mb-1"
        >
          {rawOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          {rawOpen ? "Hide" : "Show"} raw data
        </button>

        {rawOpen && (
          <div className="relative">
            <pre
              className="bg-surface-0 border border-border-subtle rounded p-3 text-[10px] text-terminal-green/50 overflow-x-hidden whitespace-pre-wrap break-all max-w-full font-mono leading-relaxed max-h-64 overflow-y-auto"
              style={{ textShadow: "0 0 2px rgba(0,255,136,0.1)" }}
            >
              {jsonStr}
            </pre>
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 transition-colors cursor-pointer font-mono tracking-wider uppercase bg-surface-0 px-1.5 py-0.5 rounded border border-border-subtle"
            >
              {copied ? <Check size={9} className="text-terminal-green" /> : <Copy size={9} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        {!rawOpen && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 transition-colors cursor-pointer font-mono tracking-wider uppercase"
          >
            {copied ? <Check size={9} className="text-terminal-green" /> : <Copy size={9} />}
            {copied ? "Copied" : "Copy raw"}
          </button>
        )}
      </div>
    </div>
  );
}
