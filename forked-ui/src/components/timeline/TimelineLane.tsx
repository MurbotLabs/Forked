import { useMemo } from "react";
import { GitFork } from "lucide-react";
import type { TraceEvent, FileSnapshot } from "../../lib/types";
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
    onFork: (event: TraceEvent) => void;
    onRewind: (target: { runId: string; seq: number }) => void;
};

export function TimelineLane({ lane, depth, isMain, sortOrder, onFork, onRewind }: Props) {
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

    // Filter out fork_info events — they're metadata, not user-facing
    const displayEvents = useMemo(() => {
        const base = lane.events.filter((ev) => ev.stream !== "fork_info");
        return sortOrder === "desc" ? [...base].reverse() : base;
    }, [lane.events, sortOrder]);

    const shortId = (id: string) =>
        id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;

    return (
        <div
            className={`retro-card overflow-hidden ${isMain ? "border-border-default" : "border-terminal-amber/25"
                }`}
        >
            {/* Lane header */}
            <div className={`px-4 py-2.5 border-b border-dashed shrink-0 ${isMain ? "border-border-default" : "border-terminal-amber/20 bg-terminal-amber/[0.03]"
                }`}>
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
                        {displayEvents.length} events
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
                    {displayEvents.map((event) => (
                        <TimelineEvent
                            key={event.id}
                            event={event}
                            hasFileSnapshot={snapshotKeys.has(`${event.run_id}:${event.seq}`)}
                            isErrorEvent={errorEvents.has(event.id)}
                            onFork={() => onFork(event)}
                            onRewind={() => onRewind({ runId: event.run_id, seq: event.seq })}
                        />
                    ))}

                    {displayEvents.length > 0 && (
                        <div className="flex gap-3 mt-1">
                            <div className="flex flex-col items-center shrink-0">
                                <div className="w-2 h-2 rounded-sm bg-slate-800 border border-border-default" />
                            </div>
                            <span className="text-[9px] text-slate-800 pt-0.5 font-mono tracking-wider uppercase">
                                End of {isMain ? "trace" : "fork"}
                            </span>
                        </div>
                    )}

                    {displayEvents.length === 0 && (
                        <div className="py-8 text-center">
                            <span className="text-[10px] text-slate-700 font-mono">No events recorded</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
