import { useMemo, useState } from "react";
import { Search, Layers, Terminal } from "lucide-react";
import type { Session } from "../../lib/types";
import { SessionCard } from "../sessions/SessionCard";
import { EmptyState } from "../common/EmptyState";

type Props = {
  sessions: Session[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
};

export function Sidebar({ sessions, selectedSessionId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();

  const groupedSessions = useMemo(() => {
    const byRunId = new Map<string, Session>();

    // Defensive dedupe: if a run appears multiple times, prefer the row with session_key.
    for (const session of sessions) {
      const prev = byRunId.get(session.run_id);
      if (!prev) {
        byRunId.set(session.run_id, session);
        continue;
      }
      const prevHasKey = Boolean(prev.session_key);
      const nextHasKey = Boolean(session.session_key);
      if (!prevHasKey && nextHasKey) {
        byRunId.set(session.run_id, session);
      }
    }

    const groups = new Map<string, Session[]>();
    for (const session of byRunId.values()) {
      if (session.run_id === "unknown") {
        continue;
      }
      const groupId = session.session_key ?? session.run_id;
      const list = groups.get(groupId);
      if (list) {
        list.push(session);
      } else {
        groups.set(groupId, [session]);
      }
    }

    return Array.from(groups.entries())
      .map(([id, runs]) => {
        const sorted = [...runs].sort((a, b) => dateToMs(b.last_activity) - dateToMs(a.last_activity));
        const representative =
          sorted.find((r) => !Boolean(r.is_fork) && !r.forked_from_run_id) ?? sorted[0];
        const runIds = sorted.map((r) => r.run_id);
        const isForkOnly = sorted.every((r) => Boolean(r.is_fork) || Boolean(r.forked_from_run_id));
        const startTime = sorted.reduce(
          (min, r) => (dateToMs(r.start_time) < dateToMs(min) ? r.start_time : min),
          sorted[0].start_time
        );
        const eventCount = sorted.reduce((sum, r) => sum + r.event_count, 0);
        const llmInputCount = sorted.reduce((sum, r) => sum + (r.llm_input_count ?? 0), 0);
        const llmOutputCount = sorted.reduce((sum, r) => sum + (r.llm_output_count ?? 0), 0);
        const forkCount = sorted.filter(
          (r) => Boolean(r.is_fork) || Boolean(r.forked_from_run_id)
        ).length;

        return {
          id,
          sessionKey: representative.session_key,
          representativeRunId: representative.run_id,
          runIds,
          startTime,
          lastActivity: sorted[0].last_activity,
          runCount: sorted.length,
          eventCount,
          llmInputCount,
          llmOutputCount,
          forkCount,
          isForkOnly,
        };
      })
      .filter((group) => !group.isForkOnly)
      .sort((a, b) => dateToMs(b.lastActivity) - dateToMs(a.lastActivity));
  }, [sessions]);

  const filtered = normalizedSearch
    ? groupedSessions.filter((group) => {
      const haystack = [
        group.id,
        group.sessionKey ?? "",
        group.representativeRunId,
        ...group.runIds,
      ].join(" ").toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    : groupedSessions;

  return (
    <aside className="w-72 h-full border-r border-border-default flex flex-col shrink-0 relative overflow-hidden">
      {/* Grid background */}
      <div className="absolute inset-0 grid-bg" />
      <div className="absolute inset-0 bg-gradient-to-b from-surface-1/90 to-surface-0/95" />

      <div className="relative z-10 flex flex-col h-full">
        {/* Search */}
        <div className="px-3 py-3 border-b border-border-default shrink-0">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-700" />
            <input
              type="text"
              placeholder="search traces..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-7 pr-3 py-1.5 text-[10px] retro-input tracking-wide"
            />
          </div>
        </div>

        {/* Conversation count */}
        <div className="px-3 py-2 border-b border-dashed border-border-default shrink-0 flex items-center gap-2">
          <Terminal size={10} className="text-slate-700" />
          <span className="text-[9px] text-slate-600 uppercase tracking-[0.15em] font-mono">
            Conversations ({filtered.length})
          </span>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Layers size={28} strokeWidth={1} />}
              title="No sessions"
              description={search ? "No sessions match your search." : "Run an OpenClaw agent to generate traces."}
            />
          ) : (
            filtered.map((session) => (
              <SessionCard
                key={session.id}
                sessionId={session.id}
                sessionKey={session.sessionKey}
                startTime={session.startTime}
                runCount={session.runCount}
                eventCount={session.eventCount}
                llmInputCount={session.llmInputCount}
                llmOutputCount={session.llmOutputCount}
                forkCount={session.forkCount}
                isSelected={selectedSessionId === session.id}
                onClick={() => onSelect(session.id)}
              />
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function dateToMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
