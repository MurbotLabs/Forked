import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpWideNarrow, RotateCcw, Radar } from "lucide-react";
import type { TraceEvent, FileSnapshot } from "../../lib/types";
import { STREAM_DOT_COLORS } from "../../lib/constants";

type Props = {
  events: TraceEvent[];
  snapshots: FileSnapshot[];
  onRewindTo: (target: { runId: string; seq: number }) => void;
  sortOrder: "desc" | "asc";
  onSortChange: (order: "desc" | "asc") => void;
};

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function shortPath(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  return parts.slice(-3).join("/");
}

function summarizeSafePoint(ev: TraceEvent): { title: string; detail: string } {
  try {
    const data = JSON.parse(ev.data) as Record<string, unknown>;
    const type = typeof data.type === "string" ? data.type : ev.stream;
    const rawPath =
      typeof data.filePath === "string"
        ? data.filePath
        : (data.fileSnapshot as { filePath?: unknown } | undefined)?.filePath;
    const filePath = typeof rawPath === "string" && rawPath.length > 0 ? rawPath : null;

    if (type === "tool_call_start" || type === "tool_call_end") {
      const toolName = typeof data.toolName === "string" ? data.toolName : "tool";
      return {
        title: humanize(type),
        detail: filePath ? `${toolName} -> ${shortPath(filePath)}` : toolName,
      };
    }

    if (type === "config_change" || type === "setup_file_change") {
      return {
        title: humanize(type),
        detail: filePath ? shortPath(filePath) : "file update",
      };
    }

    if (type === "message_received" && typeof data.content === "string") {
      return { title: humanize(type), detail: data.content.slice(0, 90) };
    }

    if (type === "llm_input" && typeof data.prompt === "string") {
      return { title: humanize(type), detail: data.prompt.slice(0, 90) };
    }

    return { title: humanize(type), detail: `run ${ev.run_id.slice(0, 8)}` };
  } catch {
    return { title: humanize(ev.stream), detail: `run ${ev.run_id.slice(0, 8)}` };
  }
}

export function RewindBar({ events, snapshots, onRewindTo, sortOrder, onSortChange }: Props) {
  const [showSafePointPicker, setShowSafePointPicker] = useState(false);
  const snapshotKeys = useMemo(
    () => new Set(snapshots.map((s) => `${s.run_id}:${s.seq}`)),
    [snapshots]
  );
  const orderedEvents = useMemo(
    () => (sortOrder === "desc" ? [...events].reverse() : events),
    [events, sortOrder]
  );

  if (events.length === 0) return null;

  const hasSnapshots = snapshots.length > 0;

  const lastErrorEvent = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      try {
        const data = JSON.parse(ev.data);
        if (ev.stream === "error" || data.error || data.success === false) {
          return ev;
        }
      } catch { /* skip */ }
    }
    return null;
  }, [events]);

  const suggestedRewind = useMemo(() => {
    if (!lastErrorEvent) return null;
    let bestSeq = -1;
    for (const snap of snapshots) {
      if (snap.run_id !== lastErrorEvent.run_id) continue;
      if (snap.seq <= lastErrorEvent.seq && snap.seq > bestSeq) {
        bestSeq = snap.seq;
      }
    }
    return bestSeq >= 0 ? { runId: lastErrorEvent.run_id, seq: bestSeq } : null;
  }, [lastErrorEvent, snapshots]);

  const safePointOptions = useMemo(() => {
    const seen = new Set<string>();
    const points: Array<{
      runId: string;
      seq: number;
      ts: number;
      key: string;
      title: string;
      detail: string;
    }> = [];
    for (const ev of events) {
      const key = `${ev.run_id}:${ev.seq}`;
      if (!snapshotKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      const summary = summarizeSafePoint(ev);
      points.push({
        runId: ev.run_id,
        seq: ev.seq,
        ts: ev.ts,
        key,
        title: summary.title,
        detail: summary.detail,
      });
    }
    points.sort((a, b) => b.ts - a.ts || b.seq - a.seq || a.runId.localeCompare(b.runId));
    return points;
  }, [events, snapshotKeys]);

  return (
    <div className="px-5 py-3 border-b border-dashed border-border-default shrink-0 relative overflow-hidden">
      {/* Grid background */}
      <div className="absolute inset-0 grid-bg opacity-50" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Radar size={10} className="text-accent/50" />
              <span className="text-[9px] text-slate-600 uppercase tracking-[0.15em] font-mono">
                Timeline
              </span>
            </div>
            <span className="text-[9px] text-slate-700 font-mono">
              {events.length} events
            </span>
            {hasSnapshots && (
              <>
                <span className="text-slate-800">│</span>
                <span className="text-[9px] text-terminal-amber/50 font-mono">
                  {snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSortChange(sortOrder === "desc" ? "asc" : "desc")}
              className="retro-btn bg-surface-3 text-slate-400 border-border-default hover:bg-surface-4 px-3 py-1"
              title="Toggle timeline event order"
            >
              {sortOrder === "desc" ? (
                <>
                  <ArrowDownWideNarrow size={10} className="inline mr-1" />
                  Newest first
                </>
              ) : (
                <>
                  <ArrowUpWideNarrow size={10} className="inline mr-1" />
                  Oldest first
                </>
              )}
            </button>
            {safePointOptions.length > 0 && (
              <button
                onClick={() => setShowSafePointPicker((prev) => !prev)}
                className="retro-btn bg-rewind/15 text-rewind border-rewind/30 hover:bg-rewind/25 px-3 py-1 glow-rewind"
              >
                <RotateCcw size={10} className="inline mr-1" />
                {showSafePointPicker ? "Hide safe points" : "Fork & rewind to safe point"}
              </button>
            )}
          </div>
        </div>

        {showSafePointPicker && (
          <div className="mb-2 p-2 bg-surface-2 border border-border-default rounded-lg space-y-1">
            <div className="text-[9px] text-slate-600 uppercase tracking-[0.15em] font-mono px-1">
              Choose Safe Point ({safePointOptions.length})
            </div>
            <div className="max-h-36 overflow-y-auto pr-1 space-y-1">
              {safePointOptions.map((point) => {
                const isSuggested =
                  suggestedRewind !== null &&
                  suggestedRewind.runId === point.runId &&
                  suggestedRewind.seq === point.seq;
                return (
                  <button
                    key={point.key}
                    onClick={() => {
                      setShowSafePointPicker(false);
                      onRewindTo({ runId: point.runId, seq: point.seq });
                    }}
                    className={`w-full text-left px-2 py-1 rounded border font-mono text-[10px] ${
                      isSuggested
                        ? "bg-rewind/20 text-rewind border-rewind/40"
                        : "bg-surface-3 text-slate-300 border-border-default hover:bg-surface-4"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>{isSuggested ? "[Recommended] " : ""}#{point.seq}</span>
                      <span className="text-slate-500">{new Date(point.ts).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{point.title}</div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5" title={point.detail}>
                      {point.detail}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Mini timeline */}
        <div className="relative h-3 flex items-center gap-px">
          {orderedEvents.map((ev) => {
            const dotColor = STREAM_DOT_COLORS[ev.stream] ?? "bg-slate-700";
            const isSnapshot = snapshotKeys.has(`${ev.run_id}:${ev.seq}`);
            const isError =
              ev.stream === "error" ||
              (() => {
                try {
                  const d = JSON.parse(ev.data);
                  return !!d.error || d.success === false;
                } catch {
                  return false;
                }
              })();

            return (
              <div
                key={ev.id}
                className="flex-1 flex items-center justify-center group/dot relative"
              >
                <div
                  className={`transition-all ${isError
                      ? "w-2 h-2 bg-red-500 rounded-sm"
                      : isSnapshot
                        ? "w-1.5 h-1.5 bg-terminal-amber rounded-sm"
                        : `w-0.5 h-1.5 ${dotColor} opacity-30 rounded-sm`
                    }`}
                  style={
                    isError ? { boxShadow: "0 0 4px rgba(239,68,68,0.5)" }
                      : isSnapshot ? { boxShadow: "0 0 4px rgba(255,176,0,0.3)" }
                        : undefined
                  }
                />
                {isSnapshot && (
                  <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 hidden group-hover/dot:block z-10">
                    <button
                      onClick={() => onRewindTo({ runId: ev.run_id, seq: ev.seq })}
                      className="whitespace-nowrap text-[8px] text-rewind bg-surface-3 border border-border-default rounded px-1.5 py-0.5 cursor-pointer hover:bg-surface-4 font-mono tracking-wider"
                    >
                      #{ev.seq}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
