import { useState } from "react";
import { motion } from "framer-motion";
import {
  GitFork,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  FileCode,
  AlertCircle,
  Wrench,
  MessageSquare,
  Bot,
  Play,
  Square,
  Cpu,
} from "lucide-react";
import type { TraceEvent, ParsedEventData } from "../../lib/types";
import { STREAM_DOT_COLORS, STREAM_CONFIG, DEFAULT_STREAM_CONFIG, FILE_MODIFYING_TOOLS } from "../../lib/constants";
import { Badge } from "../common/Badge";
import { DataInspector } from "./DataInspector";

type Props = {
  event: TraceEvent;
  pairedEndEvent?: TraceEvent | null;
  hasFileSnapshot: boolean;
  isErrorEvent: boolean;
  onFork: () => void;
  onRewind: () => void;
};

function getEventIcon(stream: string, type?: string) {
  if (stream === "error") return <AlertCircle size={12} />;
  if (stream === "tool") return <Wrench size={12} />;
  if (stream === "assistant") return <Bot size={12} />;
  if (type === "session_start" || type === "gateway_start") return <Play size={12} />;
  if (type === "session_end" || type === "agent_end") return <Square size={12} />;
  if (type === "message_received" || type === "message_sent") return <MessageSquare size={12} />;
  return <Play size={12} />;
}

function getEventLabel(parsed: ParsedEventData): string {
  const raw = parsed as Record<string, unknown>;
  if (
    parsed.type === "message_sent" &&
    typeof raw.content === "string" &&
    raw.content.startsWith("FORKED (YOU):")
  ) {
    return "forked user echo";
  }
  if (parsed.type === "tool_call_start" || parsed.type === "tool_call_end") {
    return `${parsed.toolName ?? "unknown"}`;
  }
  return ((parsed.type as string) ?? "event").replaceAll("_", " ");
}

function toTokenNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getTokenUsage(usage: ParsedEventData["usage"] | undefined): {
  input: number | null;
  output: number | null;
  total: number | null;
} {
  if (!usage) return { input: null, output: null, total: null };
  const usageRecord = usage as Record<string, unknown>;
  const input = toTokenNumber(usageRecord.input_tokens ?? usageRecord.prompt_tokens ?? usageRecord.input);
  const output = toTokenNumber(usageRecord.output_tokens ?? usageRecord.completion_tokens ?? usageRecord.output);
  const total = toTokenNumber(usageRecord.total_tokens ?? usageRecord.total);
  return { input, output, total };
}

function getEventSummary(parsed: ParsedEventData): string | null {
  const raw = parsed as Record<string, unknown>;
  const type = parsed.type;

  if (type === "llm_input" && typeof raw.prompt === "string") return raw.prompt;
  if (type === "message_received" && typeof raw.content === "string") return raw.content;
  if (type === "message_sent" && typeof raw.content === "string") return raw.content;

  if (type === "llm_output") {
    if (typeof raw.content === "string") return raw.content;
    if (Array.isArray(raw.assistantTexts)) {
      const firstText = raw.assistantTexts.find((item) => typeof item === "string");
      if (typeof firstText === "string") return firstText;
    }
  }

  if (type === "tool_call_start" || type === "tool_call_end") {
    const filePath = parsed.fileSnapshot?.filePath;
    if (typeof filePath === "string" && filePath.length > 0) {
      const shortPath = filePath.split("/").slice(-2).join("/");
      return `${parsed.toolName ?? "tool"} -> ${shortPath}`;
    }
    if (typeof raw.error === "string" && raw.error.length > 0) return raw.error;
  }

  if (type === "config_change") {
    const filePath = typeof raw.filePath === "string" ? raw.filePath : null;
    const shortPath = filePath ? filePath.split("/").slice(-2).join("/") : "config";
    const modelDelta = getConfigModelDelta(parsed);
    if (modelDelta) return `${shortPath} model: ${modelDelta.previous} -> ${modelDelta.current}`;
    return `Updated ${shortPath}`;
  }

  if (type === "setup_file_change") {
    const filePath = typeof raw.filePath === "string" ? raw.filePath : null;
    const shortPath = filePath ? filePath.split("/").slice(-3).join("/") : "setup file";
    const category = typeof raw.category === "string" ? raw.category : "setup";
    return `${category}: ${shortPath}`;
  }

  return null;
}

function findModelValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const model = findModelValue(item);
      if (model) return model;
    }
    return null;
  }

  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;

  for (const [key, field] of Object.entries(obj)) {
    if (key.toLowerCase().includes("model") && typeof field === "string" && field.trim().length > 0) {
      return field;
    }
  }

  for (const field of Object.values(obj)) {
    const model = findModelValue(field);
    if (model) return model;
  }

  return null;
}

function getConfigModelDelta(parsed: ParsedEventData): { previous: string; current: string } | null {
  const raw = parsed as Record<string, unknown>;
  const previous = findModelValue(raw.previousContent);
  const current = findModelValue(raw.currentContent);
  if (!previous || !current || previous === current) return null;
  return { previous, current };
}

function shortenModel(model: string): string {
  return model.length > 24 ? `${model.slice(0, 16)}…${model.slice(-6)}` : model;
}

const FORKABLE_TYPES = new Set(["llm_input", "message_received", "tool_call_start", "config_change", "setup_file_change"]);

export function TimelineEvent({ event, pairedEndEvent, hasFileSnapshot, isErrorEvent, onFork, onRewind }: Props) {
  const [expanded, setExpanded] = useState(false);

  let parsed: ParsedEventData;
  try {
    parsed = JSON.parse(event.data);
  } catch {
    parsed = { raw: event.data } as unknown as ParsedEventData;
  }

  // Merged tool call (start + end paired)
  const isMerged = pairedEndEvent != null && parsed.type === "tool_call_start";
  let endParsed: ParsedEventData | null = null;
  if (isMerged && pairedEndEvent) {
    try { endParsed = JSON.parse(pairedEndEvent.data); } catch { /* ignore */ }
  }

  const dotColor = STREAM_DOT_COLORS[event.stream] ?? "bg-slate-600";
  const config = STREAM_CONFIG[event.stream] ?? DEFAULT_STREAM_CONFIG;
  const filePath = parsed.fileSnapshot?.filePath;
  const isToolCall = parsed.type === "tool_call_start" || parsed.type === "tool_call_end";
  const isFileModifying = isToolCall && FILE_MODIFYING_TOOLS.has((parsed.toolName ?? "").toLowerCase());
  const hasEndError = endParsed?.error != null || endParsed?.success === false;
  const hasError = isErrorEvent || parsed.error || parsed.success === false || hasEndError;
  const tokenUsage = getTokenUsage(parsed.usage);
  const summary = getEventSummary(parsed);
  const configModelDelta = getConfigModelDelta(parsed);

  // For merged: derive status from end event
  const durationMs = isMerged
    ? (endParsed?.durationMs ?? parsed.durationMs)
    : parsed.durationMs;

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15 }}
      className="flex gap-3 group"
    >
      {/* Timeline connector */}
      <div className="flex flex-col items-center shrink-0 pt-1.5">
        <div
          className={`w-2 h-2 rounded-sm shrink-0 ${hasError ? "bg-red-500" : dotColor}`}
          style={{
            boxShadow: hasError
              ? "0 0 6px rgba(239,68,68,0.5)"
              : `0 0 4px ${dotColor.includes("emerald") ? "rgba(0,255,136,0.3)" :
                dotColor.includes("blue") ? "rgba(59,130,246,0.3)" :
                  dotColor.includes("violet") ? "rgba(139,92,246,0.3)" :
                    dotColor.includes("amber") ? "rgba(255,176,0,0.3)" :
                      "rgba(100,116,139,0.2)"}`,
          }}
        />
        <div className="w-px flex-1 bg-border-default min-h-[12px]" style={{ borderLeft: "1px dashed #1a1a30" }} />
      </div>

      {/* Event card */}
      <div
        className={`flex-1 min-w-0 mb-2 transition-all duration-150 ${hasError
          ? "retro-card !border-red-500/30 glow-error"
          : "retro-card"
          }`}
      >
        {/* Card header */}
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none flex-wrap"
          onClick={() => setExpanded(!expanded)}
        >
          <span className={`${config.color} opacity-60`}>
            {getEventIcon(event.stream, parsed.type as string)}
          </span>
          <Badge stream={event.stream} eventType={isMerged ? "tool_call_start" : (parsed.type as string)} />
          <span className="text-[10px] font-mono text-slate-400 truncate tracking-wide">
            {getEventLabel(parsed)}
          </span>

          {/* Model tag */}
          {parsed.model && (
            <span className="retro-badge text-slate-500 bg-surface-3 border-border-default">
              {parsed.model}
            </span>
          )}

          {configModelDelta && (
            <span
              className="retro-badge text-terminal-cyan bg-cyan-500/5 border-cyan-500/20"
              title={`${configModelDelta.previous} -> ${configModelDelta.current}`}
            >
              <Cpu size={9} className="inline mr-1" />
              {shortenModel(configModelDelta.previous)}
              {" -> "}
              {shortenModel(configModelDelta.current)}
            </span>
          )}

          {/* Token usage */}
          {parsed.type === "llm_output" && parsed.usage && (
            <span className="retro-badge text-terminal-cyan bg-cyan-500/5 border-cyan-500/20"
              style={{ textShadow: '0 0 4px rgba(0,229,255,0.2)' }}>
              {tokenUsage.input != null && tokenUsage.output != null
                ? `${tokenUsage.input}↓ ${tokenUsage.output}↑`
                : tokenUsage.total != null
                  ? `${tokenUsage.total}tk`
                  : "—"}
            </span>
          )}

          {/* Tool result indicator — for merged show OK/FAIL from end event */}
          {isMerged && endParsed && (
            <span className={`retro-badge ${hasEndError
              ? "text-red-400 bg-red-500/10 border-red-500/30"
              : "text-terminal-green bg-emerald-500/10 border-emerald-500/30"
              }`}
              style={!hasEndError ? { textShadow: '0 0 4px rgba(0,255,136,0.3)' } : undefined}>
              {hasEndError ? "FAIL" : "OK"}
            </span>
          )}

          {/* For non-merged tool_call_end, show OK/FAIL as before */}
          {!isMerged && parsed.type === "tool_call_end" && (
            <span className={`retro-badge ${parsed.error
              ? "text-red-400 bg-red-500/10 border-red-500/30"
              : "text-terminal-green bg-emerald-500/10 border-emerald-500/30"
              }`}
              style={!parsed.error ? { textShadow: '0 0 4px rgba(0,255,136,0.3)' } : undefined}>
              {parsed.error ? "FAIL" : "OK"}
            </span>
          )}

          {isFileModifying && (
            <FileCode size={10} className="text-terminal-amber/60" />
          )}

          {hasFileSnapshot && filePath && (
            <span className="text-[9px] text-slate-700 font-mono truncate max-w-[180px]" title={filePath}>
              {filePath.split("/").slice(-2).join("/")}
            </span>
          )}

          {typeof durationMs === "number" && (
            <span className="text-[9px] text-slate-700 font-mono">
              {durationMs < 1000
                ? `${durationMs}ms`
                : `${(durationMs / 1000).toFixed(1)}s`}
            </span>
          )}

          <span className="flex-1" />

          <span className="font-mono text-[9px] text-slate-800 tracking-wider">
            #{event.seq}
          </span>
          <span className="font-mono text-[9px] text-slate-800">
            {new Date(event.ts).toLocaleTimeString()}
          </span>

          {/* Action buttons */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {FORKABLE_TYPES.has(parsed.type as string) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFork();
                }}
                className="retro-btn text-accent bg-accent/10 border-accent/30 hover:bg-accent/20 px-2 py-0.5"
                title="Fork from this event"
              >
                <GitFork size={9} className="inline mr-1" />
                Fork
              </button>
            )}
            {hasFileSnapshot && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRewind();
                }}
                className="retro-btn text-rewind bg-rewind/10 border-rewind/30 hover:bg-rewind/20 px-2 py-0.5"
                title="Fork & rewind to before this event"
              >
                <RotateCcw size={9} className="inline mr-1" />
                Fork & Rewind
              </button>
            )}
          </div>

          <span className="text-slate-700">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>

          {/* Summary preview — expands on hover (feature 15) */}
          {summary && (
            <div className="basis-full min-w-0 pl-5 overflow-hidden transition-[max-height] duration-200 ease-out max-h-[1.6em] group-hover:max-h-[5em]">
              <span className="text-[9px] text-slate-600 font-mono break-words whitespace-pre-wrap">
                {summary}
              </span>
            </div>
          )}
        </div>

        {/* Error banner */}
        {hasError && parsed.error && typeof parsed.error === "string" && (
          <div className="mx-3 mb-2 px-3 py-1.5 bg-red-500/5 border border-dashed border-red-500/20 rounded flex items-center gap-2">
            {(() => {
              const codeMatch = parsed.error!.match(/\b(E[A-Z_]+\d*|TIMEOUT|ENOENT|EACCES|EPERM|ENOMEM|ERR_[A-Z_]+)\b/);
              return codeMatch ? (
                <span className="retro-badge text-red-300 bg-red-500/15 border-red-500/30 shrink-0">
                  {codeMatch[1]}
                </span>
              ) : null;
            })()}
            <span className="text-[10px] text-red-400/80 break-all font-mono">{parsed.error}</span>
          </div>
        )}

        {/* Expanded content */}
        {expanded && (
          <div className="px-3 pb-3 border-t border-dashed border-border-default mt-0.5 pt-2">
            <DataInspector data={parsed} />
            {/* For merged tool calls, also show the end event */}
            {isMerged && endParsed && (
              <div className="mt-2 pt-2 border-t border-dashed border-border-default">
                <div className="text-[9px] text-slate-700 font-mono uppercase tracking-widest mb-1.5">Result</div>
                <DataInspector data={endParsed} />
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
