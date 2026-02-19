import { Activity, Bot, GitFork, Layers } from "lucide-react";

type Props = {
  sessionId: string;
  sessionKey: string | null;
  startTime: string;
  runCount: number;
  eventCount: number;
  llmInputCount: number;
  llmOutputCount: number;
  forkCount: number;
  isSelected: boolean;
  onClick: () => void;
};

export function SessionCard({
  sessionId,
  sessionKey,
  startTime,
  runCount,
  eventCount,
  llmInputCount,
  llmOutputCount,
  forkCount,
  isSelected,
  onClick,
}: Props) {
  const label = sessionKey ?? sessionId;
  const timeStr = new Date(startTime).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 transition-all duration-100 cursor-pointer group m-0 border-b border-dashed border-border-subtle ${isSelected
          ? "retro-card retro-card-selected mx-1.5 my-1 !border-solid"
          : "hover:bg-surface-hover"
        }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div
          className="w-1.5 h-1.5 rounded-sm shrink-0 bg-terminal-green"
          style={{ boxShadow: "0 0 4px rgba(0,255,136,0.3)" }}
        />
        <span className="font-mono text-[10px] text-slate-400 truncate flex-1 tracking-wide">
          {label.length > 24 ? `${label.slice(0, 12)}…${label.slice(-10)}` : label}
        </span>
        <span className="text-[9px] text-slate-700 flex items-center gap-1 font-mono shrink-0" title="Runs in conversation">
          <Layers size={9} />
          {runCount}
        </span>
      </div>
      <div className="flex items-center justify-between pl-3.5">
        <span className="text-[9px] text-slate-700 font-mono">{timeStr}</span>
        <div className="text-[9px] text-slate-700 flex items-center gap-2.5 font-mono">
          <span className="inline-flex items-center gap-1" title="LLM input/output">
            <Bot size={9} />
            {llmInputCount}/{llmOutputCount}
          </span>
          <span className="inline-flex items-center gap-1" title="Forked runs">
            <GitFork size={9} />
            {forkCount}
          </span>
          <span className="inline-flex items-center gap-1" title="Total events">
            <Activity size={9} />
            {eventCount}
          </span>
        </div>
      </div>
    </button>
  );
}
