import { useMemo } from "react";
import { GitFork } from "lucide-react";
import type { TraceEvent, FileSnapshot, ParsedEventData } from "../../lib/types";
import { TimelineEvent } from "./TimelineEvent";

type LaneData = {
    runId: string;
    label: string;
    events: TraceEvent[];
    snapshots: FileSnapshot[];
    forkFromSeq: number | null;
    parentRunId: string | null;
    children: LaneData[];
};

type Props = {
    lane: LaneData;
    depth: number;
    isMain: boolean;
    sortOrder: "desc" | "asc";
    typeFilters: Set<string>;
    searchQuery: string;
    onFork: (event: TraceEvent) => void;
    onRewind: (target: { runId: string; seq: number }) => void;
};

type DisplayItem = {
    event: TraceEvent;
    pairedEndEvent?: TraceEvent;
    parsed: ParsedEventData;
};

function safeParse(data: string): ParsedEventData {
    try { return JSON.parse(data) as ParsedEventData; } catch { return {} as ParsedEventData; }
}

/** Pair tool_call_start events with their matching tool_call_end by toolCallId */
function mergeToolCalls(events: TraceEvent[]): DisplayItem[] {
    const items: DisplayItem[] = [];
    // Map from toolCallId → index in items array where the start placeholder lives
    const pendingByCallId = new Map<string, number>();
    // Fallback: sequential pairing by tool name when no callId
    const pendingByName = new Map<string, number[]>();

    for (const event of events) {
        const parsed = safeParse(event.data);

        if (parsed.type === "tool_call_start") {
            const rawParsed = parsed as Record<string, unknown>;
            const callId = typeof rawParsed.toolCallId === "string" ? rawParsed.toolCallId : null;
            const toolName = typeof parsed.toolName === "string" ? parsed.toolName : "__unknown__";

            const idx = items.length;
            items.push({ event, parsed });

            if (callId) {
                pendingByCallId.set(callId, idx);
            } else {
                const list = pendingByName.get(toolName) ?? [];
                list.push(idx);
                pendingByName.set(toolName, list);
            }
            continue;
        }

        if (parsed.type === "tool_call_end") {
            const rawParsed = parsed as Record<string, unknown>;
            const callId = typeof rawParsed.toolCallId === "string" ? rawParsed.toolCallId : null;
            const toolName = typeof parsed.toolName === "string" ? parsed.toolName : "__unknown__";

            // Try to match by callId first
            if (callId && pendingByCallId.has(callId)) {
                const idx = pendingByCallId.get(callId)!;
                pendingByCallId.delete(callId);
                items[idx] = { ...items[idx], pairedEndEvent: event };
                continue;
            }

            // Fallback: match by toolName (FIFO)
            const nameQueue = pendingByName.get(toolName);
            if (nameQueue && nameQueue.length > 0) {
                const idx = nameQueue.shift()!;
                if (nameQueue.length === 0) pendingByName.delete(toolName);
                items[idx] = { ...items[idx], pairedEndEvent: event };
                continue;
            }

            // No matching start — show as standalone
            items.push({ event, parsed });
            continue;
        }

        items.push({ event, parsed });
    }

    return items;
}

/** Check if an event matches the active type filter set */
function matchesTypeFilter(parsed: ParsedEventData, typeFilters: Set<string>): boolean {
    if (typeFilters.size === 0) return true;
    const type = parsed.type ?? "";

    if (typeFilters.has("llm") && (type === "llm_input" || type === "llm_output")) return true;
    if (typeFilters.has("tool") && (type === "tool_call_start" || type === "tool_call_end")) return true;
    if (typeFilters.has("message") && (type === "message_received" || type === "message_sent")) return true;
    if (typeFilters.has("system") && (
        type === "session_start" || type === "session_end" ||
        type === "gateway_start" || type === "agent_end"
    )) return true;

    return false;
}

/** Check if event data contains the search query */
function matchesSearch(event: TraceEvent, endEvent: TraceEvent | undefined, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    if (event.data.toLowerCase().includes(q)) return true;
    if (endEvent && endEvent.data.toLowerCase().includes(q)) return true;
    return false;
}

export function TimelineLane({ lane, depth, isMain, sortOrder, typeFilters, searchQuery, onFork, onRewind }: Props) {
    const snapshotKeys = useMemo(
        () => new Set(lane.snapshots.map((s) => `${s.run_id}:${s.seq}`)),
        [lane.snapshots]
    );

    const errorEvents = useMemo(() => {
        const set = new Set<number>();
        for (const ev of lane.events) {
            try {
                const data = JSON.parse(ev.data);
                if (ev.stream === "error" || data.error || data.success === false) {
                    set.add(ev.id);
                }
            } catch { /* skip */ }
        }
        return set;
    }, [lane.events]);

    // Filter out fork_info events, then merge tool call pairs
    const mergedItems = useMemo(() => {
        const base = lane.events.filter((ev) => ev.stream !== "fork_info");
        const sorted = sortOrder === "desc" ? [...base].reverse() : base;
        return mergeToolCalls(sorted);
    }, [lane.events, sortOrder]);

    // Apply type filters and search
    const displayItems = useMemo(() => {
        return mergedItems.filter((item) => {
            if (!matchesTypeFilter(item.parsed, typeFilters)) return false;
            if (!matchesSearch(item.event, item.pairedEndEvent, searchQuery)) return false;
            return true;
        });
    }, [mergedItems, typeFilters, searchQuery]);

    const shortId = (id: string) =>
        id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;

    return (
        <div
            className={`retro-card overflow-hidden ${isMain ? "border-border-default" : "border-terminal-amber/25"}`}
        >
            {/* Lane header */}
            <div className={`px-4 py-2.5 border-b border-dashed shrink-0 ${isMain ? "border-border-default" : "border-terminal-amber/20 bg-terminal-amber/[0.03]"}`}>
                <div className="flex items-center gap-2">
                    {isMain ? (
                        <>
                            <span
                                className="w-2 h-2 rounded-sm bg-terminal-green shrink-0"
                                style={{ boxShadow: "0 0 4px rgba(0,255,136,0.4)" }}
                            />
                            <span className="text-[10px] text-slate-400 font-mono tracking-wider uppercase font-semibold">
                                Main Timeline
                            </span>
                        </>
                    ) : (
                        <>
                            <GitFork size={11} className="text-terminal-amber/70 shrink-0" />
                            <span className="text-[10px] text-terminal-amber/70 font-mono tracking-wider uppercase font-semibold">
                                Fork {depth > 0 ? `L${depth}` : ""}
                            </span>
                            <span className="text-[9px] text-slate-600 font-mono truncate">
                                {shortId(lane.runId)}
                            </span>
                        </>
                    )}
                    <span className="flex-1" />
                    <span className="text-[9px] text-slate-700 font-mono">
                        {displayItems.length}{mergedItems.length !== displayItems.length ? `/${mergedItems.length}` : ""} events
                    </span>
                </div>
                {!isMain && lane.forkFromSeq !== null && (
                    <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-[8px] text-slate-700 font-mono tracking-wider">
                            BRANCHED AT #{lane.forkFromSeq}
                            {lane.parentRunId && ` • from ${shortId(lane.parentRunId)}`}
                        </span>
                    </div>
                )}
            </div>

            {/* Events */}
            <div className="px-4 py-3">
                <div>
                    {displayItems.map((item) => (
                        <TimelineEvent
                            key={item.event.id}
                            event={item.event}
                            pairedEndEvent={item.pairedEndEvent ?? null}
                            hasFileSnapshot={snapshotKeys.has(`${item.event.run_id}:${item.event.seq}`)}
                            isErrorEvent={errorEvents.has(item.event.id)}
                            onFork={() => onFork(item.event)}
                            onRewind={() => onRewind({ runId: item.event.run_id, seq: item.event.seq })}
                        />
                    ))}

                    {displayItems.length > 0 && (
                        <div className="flex gap-3 mt-1">
                            <div className="flex flex-col items-center shrink-0">
                                <div className="w-2 h-2 rounded-sm bg-slate-800 border border-border-default" />
                            </div>
                            <span className="text-[9px] text-slate-800 pt-0.5 font-mono tracking-wider uppercase">
                                End of {isMain ? "trace" : "fork"}
                            </span>
                        </div>
                    )}

                    {displayItems.length === 0 && (
                        <div className="py-8 text-center">
                            <span className="text-[10px] text-slate-700 font-mono">
                                {mergedItems.length === 0 ? "No events recorded" : "No events match filters"}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
