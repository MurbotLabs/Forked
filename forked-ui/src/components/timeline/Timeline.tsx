import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, MousePointerClick } from "lucide-react";
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

const MAIN_BRANCH = "__main__";
const SORT_KEY = "forked.timeline.sortOrder";

export function Timeline({ sessionId, sessions, onForkCreated }: Props) {
  const [sessionEvents, setSessionEvents] = useState<TraceEvent[]>([]);
  const [sessionSnapshots, setSessionSnapshots] = useState<FileSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [forkEvent, setForkEvent] = useState<TraceEvent | null>(null);
  const [rewindTarget, setRewindTarget] = useState<RewindTarget | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; alias?: string; isPrimary: boolean }>>([]);

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
      .catch(() => { /* silently ignore — model picker is optional */});
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

  useEffect(() => {
    if (!sessionId) return;
    const intervalId = window.setInterval(() => {
      loadSessionData({ silent: true });
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [sessionId, loadSessionData]);

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

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
          <div className="space-y-3 pb-4">
            {lanes.map((entry) => (
              <div key={`${entry.lane.runId}:${entry.depth}`} style={{ marginLeft: entry.depth * 20 }}>
                <TimelineLane
                  lane={entry.lane}
                  depth={entry.depth}
                  isMain={entry.isMain}
                  sortOrder={sortOrder}
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
