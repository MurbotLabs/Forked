import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Loader2, MousePointerClick, Search, X } from "lucide-react";
import type { TraceEvent, FileSnapshot, Session } from "../../lib/types";
import { fetchTraces, fetchSnapshots, createFork, fetchOpenClawConfig } from "../../lib/api";
import { EmptyState } from "../common/EmptyState";
import { TimelineLane } from "./TimelineLane";
import { RewindBar } from "../rewind/RewindBar";
import { RewindModal } from "../rewind/RewindModal";
import { ForkModal } from "../fork/ForkModal";

type LaneData = {
  runId: string;
  label: string;
  events: TraceEvent[];
  snapshots: FileSnapshot[];
  forkFromSeq: number | null;
  parentRunId: string | null;
  branchedAtTs: number | null;
  children: LaneData[];
};

type LaneWithDepth = {
  lane: LaneData;
  depth: number;
  isMain: boolean;
};

type RewindTarget = {
  runId: string;
  seq: number;
};

type RunNode = {
  runId: string;
  parentRunId: string | null;
  isFork: boolean;
  hasForkInfo: boolean;
  forkFromSeq: number | null;
  branchedAtTs: number | null;
  events: TraceEvent[];
  snapshots: FileSnapshot[];
};

type Props = {
  sessionId: string | null;
  sessions: Session[];
  onForkCreated: () => void;
};

// ─── Filter types ──────────────────────────────────────────────────────────────

type FilterKey = "llm" | "tool" | "message" | "system";

const FILTER_LABELS: Record<FilterKey, string> = {
  llm: "LLM",
  tool: "Tools",
  message: "Messages",
  system: "System",
};

const FILTER_COLORS: Record<FilterKey, string> = {
  llm: "text-terminal-cyan border-terminal-cyan/40 bg-terminal-cyan/10",
  tool: "text-terminal-amber border-terminal-amber/40 bg-terminal-amber/10",
  message: "text-blue-400 border-blue-400/40 bg-blue-400/10",
  system: "text-slate-400 border-slate-600 bg-slate-800/40",
};

const FILTER_COLORS_INACTIVE = "text-slate-700 border-slate-800 bg-transparent hover:border-slate-700 hover:text-slate-600";

// ─── Stats helpers ─────────────────────────────────────────────────────────────

function computeStats(events: TraceEvent[]) {
  let llmCalls = 0;
  let toolCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let firstTs: number | null = null;
  let lastTs: number | null = null;

  for (const ev of events) {
    if (ev.stream === "fork_info") continue;
    if (firstTs === null || ev.ts < firstTs) firstTs = ev.ts;
    if (lastTs === null || ev.ts > lastTs) lastTs = ev.ts;

    try {
      const data = JSON.parse(ev.data) as Record<string, unknown>;
      const type = data.type;
      if (type === "llm_input") llmCalls++;
      if (type === "tool_call_start") toolCalls++;
      if (type === "llm_output" && data.usage) {
        const u = data.usage as Record<string, unknown>;
        const inp = Number(u.input_tokens ?? u.prompt_tokens ?? u.input ?? 0);
        const out = Number(u.output_tokens ?? u.completion_tokens ?? u.output ?? 0);
        if (Number.isFinite(inp)) totalInputTokens += inp;
        if (Number.isFinite(out)) totalOutputTokens += out;
      }
    } catch { /* skip */ }
  }

  const durationMs = firstTs !== null && lastTs !== null ? lastTs - firstTs : null;
  const totalTokens = totalInputTokens + totalOutputTokens;

  return { llmCalls, toolCalls, totalTokens, totalInputTokens, totalOutputTokens, durationMs };
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

// ─── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ events }: { events: TraceEvent[] }) {
  const stats = useMemo(() => computeStats(events), [events]);

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 border-b border-dashed border-border-default bg-surface-1/30 shrink-0 flex-wrap">
      <StatPill label="LLM calls" value={String(stats.llmCalls)} color="text-terminal-cyan/70" />
      <StatPill label="Tool calls" value={String(stats.toolCalls)} color="text-terminal-amber/70" />
      <StatPill label="Tokens" value={fmtTokens(stats.totalTokens)}
        title={`↓${fmtTokens(stats.totalInputTokens)} in / ↑${fmtTokens(stats.totalOutputTokens)} out`}
        color="text-terminal-green/70" />
      {stats.durationMs !== null && (
        <StatPill label="Duration" value={fmtDuration(stats.durationMs)} color="text-slate-400" />
      )}
    </div>
  );
}

function StatPill({ label, value, color, title }: { label: string; value: string; color: string; title?: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[9px]" title={title}>
      <span className="text-slate-700 uppercase tracking-widest">{label}</span>
      <span className={`${color} font-semibold tracking-wide`}>{value}</span>
    </span>
  );
}

// ─── Filter + search bar ──────────────────────────────────────────────────────

function FilterBar({
  activeFilters,
  onToggle,
  searchQuery,
  onSearch,
}: {
  activeFilters: Set<string>;
  onToggle: (key: string) => void;
  searchQuery: string;
  onSearch: (q: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-dashed border-border-default bg-surface-1/20 shrink-0 flex-wrap">
      <span className="text-[9px] text-slate-700 font-mono uppercase tracking-widest shrink-0">Filter</span>
      {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => {
        const active = activeFilters.has(key);
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className={`retro-badge cursor-pointer transition-all duration-100 ${active ? FILTER_COLORS[key] : FILTER_COLORS_INACTIVE}`}
          >
            {FILTER_LABELS[key]}
          </button>
        );
      })}
      <span className="flex-1" />
      {/* Search */}
      <div className="relative flex items-center">
        <Search size={9} className="absolute left-2 text-slate-700 pointer-events-none" />
        <input
          type="text"
          placeholder="search events..."
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
          className="pl-6 pr-6 py-0.5 text-[9px] retro-input w-36 tracking-wide"
        />
        {searchQuery && (
          <button
            onClick={() => onSearch("")}
            className="absolute right-1.5 text-slate-700 hover:text-slate-400 transition-colors"
          >
            <X size={9} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const MAIN_BRANCH = "__main__";
const SORT_KEY = "forked.timeline.sortOrder";

export function Timeline({ sessionId, sessions, onForkCreated }: Props) {
  const [sessionEvents, setSessionEvents] = useState<TraceEvent[]>([]);
  const [sessionSnapshots, setSessionSnapshots] = useState<FileSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [forkEvent, setForkEvent] = useState<TraceEvent | null>(null);
  const [rewindTarget, setRewindTarget] = useState<RewindTarget | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; alias?: string; isPrimary: boolean }>>([]);

  // Filter + search state
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // Auto-scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    fetchOpenClawConfig()
      .then((res) => {
        if (!res.ok || !res.config) return;
        const defaults = res.config.agents?.defaults;
        const primary = defaults?.model?.primary ?? "";
        const models = Object.entries(defaults?.models ?? {}).map(([id, meta]) => ({
          id,
          alias: meta.alias,
          isPrimary: id === primary,
        }));
        setAvailableModels(models);
      })
      .catch(() => { /* silently ignore */ });
  }, []);

  const [sortOrder, setSortOrder] = useState<"desc" | "asc">(() => {
    if (typeof window === "undefined") return "desc";
    const stored = window.localStorage.getItem(SORT_KEY);
    return stored === "asc" ? "asc" : "desc";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SORT_KEY, sortOrder);
  }, [sortOrder]);

  const conversationSessions = useMemo(() => {
    const unique = dedupeSessionsByRunId(sessions);
    return getConversationSessions(sessionId, unique);
  }, [sessionId, sessions]);

  const conversationSessionByRun = useMemo(() => {
    const map = new Map<string, Session>();
    for (const row of conversationSessions) {
      map.set(row.run_id, row);
    }
    return map;
  }, [conversationSessions]);

  const loadSessionData = useCallback((opts?: { silent?: boolean }) => {
    if (!sessionId) {
      setSessionEvents([]);
      setSessionSnapshots([]);
      return;
    }

    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
    }
    Promise.all([fetchTraces(sessionId), fetchSnapshots(sessionId)])
      .then(([traces, snaps]) => {
        setSessionEvents(traces);
        setSessionSnapshots(snaps);
      })
      .catch((err) => console.error("Failed to fetch:", err))
      .finally(() => {
        if (!silent) {
          setLoading(false);
        }
      });
  }, [sessionId]);

  useEffect(() => {
    loadSessionData();
  }, [loadSessionData]);

  // Polling for live sessions
  useEffect(() => {
    if (!sessionId) return;
    const intervalId = window.setInterval(() => {
      loadSessionData({ silent: true });
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [sessionId, loadSessionData]);

  // Auto-scroll: when new events arrive and user is at bottom, scroll to bottom
  useEffect(() => {
    if (!scrollRef.current || !isAtBottomRef.current) return;
    if (sortOrder === "desc") {
      // desc = newest first at top, so scroll to top
      scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      // asc = newest at bottom, scroll to bottom
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [sessionEvents, sortOrder]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const distFromTop = el.scrollTop;
    if (sortOrder === "desc") {
      isAtBottomRef.current = distFromTop < 80;
    } else {
      isAtBottomRef.current = distFromBottom < 80;
    }
  }, [sortOrder]);

  const laneRoot = useMemo(
    () => buildLaneTree(sessionId, sessionEvents, sessionSnapshots, conversationSessionByRun),
    [sessionId, sessionEvents, sessionSnapshots, conversationSessionByRun]
  );

  const lanes = useMemo(
    () => (laneRoot ? flattenLanes(laneRoot, sortOrder) : []),
    [laneRoot, sortOrder]
  );

  const mainEvents = laneRoot?.events ?? [];
  const mainSnapshots = laneRoot?.snapshots ?? [];

  const handleFork = async (modifiedData: Record<string, unknown>) => {
    if (!forkEvent) return { success: false, message: "No event selected" };
    const result = await createFork(forkEvent.run_id, forkEvent.seq, modifiedData);
    if (result.success) {
      onForkCreated();
      setTimeout(() => loadSessionData({ silent: true }), 900);
    }
    return result;
  };

  const handleForkRewindCreated = useCallback(() => {
    onForkCreated();
    setTimeout(() => loadSessionData({ silent: true }), 900);
  }, [onForkCreated, loadSessionData]);

  const toggleFilter = useCallback((key: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-0">
        <EmptyState
          icon={<MousePointerClick size={32} strokeWidth={1} className="text-slate-700" />}
          title="Select a session"
          description="Choose a session from the sidebar to view its execution trace."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-0">
        <Loader2 size={20} className="text-accent animate-spin" />
        <span className="ml-2 text-[10px] text-slate-600 font-mono tracking-wider">Loading trace...</span>
      </div>
    );
  }

  if (sessionEvents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-0">
        <EmptyState
          icon={<MousePointerClick size={32} strokeWidth={1} className="text-slate-700" />}
          title="No timeline data"
          description="No events were found for this conversation yet."
        />
      </div>
    );
  }

  if (!laneRoot) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-0">
        <EmptyState
          icon={<MousePointerClick size={32} strokeWidth={1} className="text-slate-700" />}
          title="Timeline unavailable"
          description="Could not build timeline lanes for this conversation."
        />
      </div>
    );
  }

  return (
    <section className="flex-1 flex flex-col h-full bg-surface-0 overflow-hidden relative">
      <div className="absolute inset-0 grid-bg opacity-40" />

      <div className="relative z-10 flex flex-col h-full">
        <RewindBar
          events={mainEvents}
          snapshots={mainSnapshots}
          onRewindTo={(target) => setRewindTarget(target)}
          sortOrder={sortOrder}
          onSortChange={setSortOrder}
        />

        {/* Stats bar */}
        <StatsBar events={sessionEvents} />

        {/* Filter + search bar */}
        <FilterBar
          activeFilters={activeFilters}
          onToggle={toggleFilter}
          searchQuery={searchQuery}
          onSearch={setSearchQuery}
        />

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3"
        >
          <div className="space-y-3 pb-4">
            {lanes.map((entry) => (
              <div key={`${entry.lane.runId}:${entry.depth}`} style={{ marginLeft: entry.depth * 20 }}>
                <TimelineLane
                  lane={entry.lane}
                  depth={entry.depth}
                  isMain={entry.isMain}
                  sortOrder={sortOrder}
                  typeFilters={activeFilters}
                  searchQuery={searchQuery}
                  onFork={(event) => setForkEvent(event)}
                  onRewind={(target) => setRewindTarget(target)}
                />
              </div>
            ))}
          </div>
        </div>

        <ForkModal
          open={forkEvent !== null}
          event={forkEvent}
          events={lanes.flatMap((entry) => entry.lane.events)}
          onClose={() => setForkEvent(null)}
          onFork={handleFork}
          availableModels={availableModels}
        />

        {rewindTarget && (
          <RewindModal
            open={rewindTarget !== null}
            onClose={() => setRewindTarget(null)}
            runId={rewindTarget.runId}
            targetSeq={rewindTarget.seq}
            onForkRewindCreated={handleForkRewindCreated}
          />
        )}
      </div>
    </section>
  );
}

function buildLaneTree(
  sessionId: string | null,
  events: TraceEvent[],
  snapshots: FileSnapshot[],
  sessionRowsByRun: Map<string, Session>
): LaneData | null {
  if (!sessionId || events.length === 0) return null;

  const runEvents = new Map<string, TraceEvent[]>();
  for (const event of events) {
    const list = runEvents.get(event.run_id);
    if (list) {
      list.push(event);
    } else {
      runEvents.set(event.run_id, [event]);
    }
  }

  const runSnapshots = new Map<string, FileSnapshot[]>();
  for (const snap of snapshots) {
    const list = runSnapshots.get(snap.run_id);
    if (list) {
      list.push(snap);
    } else {
      runSnapshots.set(snap.run_id, [snap]);
    }
  }

  const runs = new Map<string, RunNode>();
  for (const [runId, runEventList] of runEvents.entries()) {
    const sortedEvents = [...runEventList].sort((a, b) => a.ts - b.ts || a.seq - b.seq || a.id - b.id);
    const sortedSnapshots = [...(runSnapshots.get(runId) ?? [])].sort((a, b) => a.seq - b.seq || a.id - b.id);

    const firstParentFromEvent = sortedEvents.find((e) => !!e.forked_from_run_id)?.forked_from_run_id ?? null;
    const sessionRow = sessionRowsByRun.get(runId);
    const parentRunId = firstParentFromEvent ?? sessionRow?.forked_from_run_id ?? null;
    const explicitForkMeta = getForkMetadata(sortedEvents);
    const isForkFromEvent = sortedEvents.some((e) => Boolean(e.is_fork) || Boolean(e.forked_from_run_id));

    runs.set(runId, {
      runId,
      parentRunId,
      isFork: isForkFromEvent || Boolean(sessionRow?.is_fork) || Boolean(parentRunId),
      hasForkInfo: explicitForkMeta.hasForkInfo,
      forkFromSeq: explicitForkMeta.forkFromSeq,
      branchedAtTs: explicitForkMeta.forkInfoTs ?? sortedEvents[0]?.ts ?? null,
      events: sortedEvents,
      snapshots: sortedSnapshots,
    });
  }

  const nearestExplicitAncestorCache = new Map<string, string | null>();
  const nearestExplicitAncestor = (runId: string | null): string | null => {
    if (!runId) return null;
    if (nearestExplicitAncestorCache.has(runId)) {
      return nearestExplicitAncestorCache.get(runId) ?? null;
    }

    const seen = new Set<string>();
    let cursor: string | null = runId;
    while (cursor) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const node = runs.get(cursor);
      if (!node) break;
      if (node.hasForkInfo) {
        nearestExplicitAncestorCache.set(runId, node.runId);
        return node.runId;
      }
      cursor = node.parentRunId;
    }

    nearestExplicitAncestorCache.set(runId, null);
    return null;
  };

  const branchEvents = new Map<string, TraceEvent[]>();
  const branchSnapshots = new Map<string, FileSnapshot[]>();
  const explicitRuns = new Map<string, RunNode>();

  for (const node of runs.values()) {
    if (node.hasForkInfo) {
      explicitRuns.set(node.runId, node);
    }
    const branchKey = node.hasForkInfo
      ? node.runId
      : node.isFork
        ? nearestExplicitAncestor(node.parentRunId) ?? MAIN_BRANCH
        : MAIN_BRANCH;

    const evList = branchEvents.get(branchKey);
    if (evList) evList.push(...node.events);
    else branchEvents.set(branchKey, [...node.events]);

    const snapList = branchSnapshots.get(branchKey);
    if (snapList) snapList.push(...node.snapshots);
    else branchSnapshots.set(branchKey, [...node.snapshots]);
  }

  const childrenByBranch = new Map<string, string[]>();
  for (const node of explicitRuns.values()) {
    const parentBranch = nearestExplicitAncestor(node.parentRunId) ?? MAIN_BRANCH;
    const list = childrenByBranch.get(parentBranch);
    if (list) list.push(node.runId);
    else childrenByBranch.set(parentBranch, [node.runId]);
  }

  const sortBranchChildren = (branchIds: string[]) =>
    [...branchIds].sort((a, b) => {
      const nodeA = explicitRuns.get(a);
      const nodeB = explicitRuns.get(b);
      const tsA = nodeA?.branchedAtTs ?? 0;
      const tsB = nodeB?.branchedAtTs ?? 0;
      if (tsA !== tsB) return tsA - tsB;
      const seqA = nodeA?.forkFromSeq ?? 0;
      const seqB = nodeB?.forkFromSeq ?? 0;
      if (seqA !== seqB) return seqA - seqB;
      return a.localeCompare(b);
    });

  const normalizeEvents = (items: TraceEvent[]) => {
    const byId = new Map<number, TraceEvent>();
    for (const item of items) {
      byId.set(item.id, item);
    }
    return Array.from(byId.values()).sort((a, b) => a.ts - b.ts || a.seq - b.seq || a.id - b.id);
  };

  const normalizeSnapshots = (items: FileSnapshot[]) => {
    const byId = new Map<number, FileSnapshot>();
    for (const item of items) {
      byId.set(item.id, item);
    }
    return Array.from(byId.values()).sort((a, b) => a.seq - b.seq || a.id - b.id);
  };

  const buildExplicitLane = (runId: string, visited: Set<string> = new Set()): LaneData => {
    if (visited.has(runId)) {
      return {
        runId,
        label: runId,
        events: normalizeEvents(branchEvents.get(runId) ?? []),
        snapshots: normalizeSnapshots(branchSnapshots.get(runId) ?? []),
        forkFromSeq: explicitRuns.get(runId)?.forkFromSeq ?? null,
        parentRunId: explicitRuns.get(runId)?.parentRunId ?? null,
        branchedAtTs: explicitRuns.get(runId)?.branchedAtTs ?? null,
        children: [],
      };
    }
    const nextVisited = new Set(visited);
    nextVisited.add(runId);

    const node = explicitRuns.get(runId);
    const childRunIds = sortBranchChildren(childrenByBranch.get(runId) ?? []);
    return {
      runId,
      label: runId,
      events: normalizeEvents(branchEvents.get(runId) ?? []),
      snapshots: normalizeSnapshots(branchSnapshots.get(runId) ?? []),
      forkFromSeq: node?.forkFromSeq ?? null,
      parentRunId: node?.parentRunId ?? null,
      branchedAtTs: node?.branchedAtTs ?? null,
      children: childRunIds.map((child) => buildExplicitLane(child, nextVisited)),
    };
  };

  const rootChildren = sortBranchChildren(childrenByBranch.get(MAIN_BRANCH) ?? []).map((runId) =>
    buildExplicitLane(runId)
  );
  return {
    runId: sessionId,
    label: "Main Timeline",
    events: normalizeEvents(branchEvents.get(MAIN_BRANCH) ?? []),
    snapshots: normalizeSnapshots(branchSnapshots.get(MAIN_BRANCH) ?? []),
    forkFromSeq: null,
    parentRunId: null,
    branchedAtTs: events[0]?.ts ?? null,
    children: rootChildren,
  };
}

function flattenLanes(root: LaneData, sortOrder: "asc" | "desc", depth = 0): LaneWithDepth[] {
  const placeRootAtEnd = depth === 0 && sortOrder === "desc";
  const placeNodeAfterChildren = depth > 0 && sortOrder === "desc";
  const result: LaneWithDepth[] =
    placeRootAtEnd || placeNodeAfterChildren ? [] : [{ lane: root, depth, isMain: depth === 0 }];

  const sortedChildren = [...root.children].sort((a, b) => {
    const tsA = latestLaneActivityTs(a);
    const tsB = latestLaneActivityTs(b);
    if (tsA !== tsB) return tsA - tsB;
    const seqA = a.forkFromSeq ?? 0;
    const seqB = b.forkFromSeq ?? 0;
    if (seqA !== seqB) return seqA - seqB;
    return a.runId.localeCompare(b.runId);
  });

  if (sortOrder === "desc") {
    sortedChildren.reverse();
  }

  for (const child of sortedChildren) {
    result.push(...flattenLanes(child, sortOrder, depth + 1));
  }

  if (placeRootAtEnd || placeNodeAfterChildren) {
    result.push({ lane: root, depth, isMain: depth === 0 });
  }
  return result;
}

function latestLaneActivityTs(lane: LaneData): number {
  const laneEventTs = lane.events.length > 0 ? lane.events[lane.events.length - 1].ts : 0;
  let maxChildTs = 0;
  for (const child of lane.children) {
    const childTs = latestLaneActivityTs(child);
    if (childTs > maxChildTs) {
      maxChildTs = childTs;
    }
  }
  return Math.max(laneEventTs, maxChildTs, lane.branchedAtTs ?? 0);
}

function dedupeSessionsByRunId(rows: Session[]): Session[] {
  const byRunId = new Map<string, Session>();
  for (const row of rows) {
    const prev = byRunId.get(row.run_id);
    if (!prev) {
      byRunId.set(row.run_id, row);
      continue;
    }
    if (!prev.session_key && row.session_key) {
      byRunId.set(row.run_id, row);
    }
  }
  return Array.from(byRunId.values());
}

function getConversationSessions(sessionId: string | null, allSessions: Session[]): Session[] {
  if (!sessionId) return [];

  const grouped = allSessions.filter((row) => (row.session_key ?? row.run_id) === sessionId);
  if (grouped.length > 0) return grouped;

  const byRunId = allSessions.find((row) => row.run_id === sessionId);
  if (!byRunId) return [];

  if (byRunId.session_key) {
    return allSessions.filter((row) => row.session_key === byRunId.session_key);
  }

  return [byRunId];
}

function getForkMetadata(events: TraceEvent[]): {
  hasForkInfo: boolean;
  forkFromSeq: number | null;
  forkInfoTs: number | null;
} {
  for (const ev of events) {
    if (ev.stream !== "fork_info") continue;
    try {
      const data = JSON.parse(ev.data) as { forkFromSeq?: number };
      return {
        hasForkInfo: true,
        forkFromSeq: data.forkFromSeq ?? null,
        forkInfoTs: ev.ts,
      };
    } catch {
      return { hasForkInfo: true, forkFromSeq: null, forkInfoTs: ev.ts };
    }
  }
  return { hasForkInfo: false, forkFromSeq: null, forkInfoTs: null };
}
