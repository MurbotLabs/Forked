import { useState, useRef, useEffect } from "react";
import { Activity, Bot, GitFork, Layers, Pencil, Check } from "lucide-react";

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
  label: string | null;
  onLabelChange: (label: string | null) => void;
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
  label,
  onLabelChange,
  onClick,
}: Props) {
  const displayId = sessionKey ?? sessionId;
  const shortId = displayId.length > 24 ? `${displayId.slice(0, 12)}…${displayId.slice(-10)}` : displayId;
  const timeStr = new Date(startTime).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(label ?? "");
    setEditing(true);
  };

  const commitEdit = () => {
    const trimmed = draft.trim();
    onLabelChange(trimmed || null);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
    if (e.key === "Escape") { setEditing(false); }
  };

  const handleCommitClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    commitEdit();
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 transition-all duration-100 cursor-pointer group m-0 border-b border-dashed border-border-subtle ${isSelected
          ? "retro-card retro-card-selected mx-1.5 my-1 !border-solid"
          : "hover:bg-surface-hover"
        }`}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <div
          className="w-1.5 h-1.5 rounded-sm shrink-0 bg-terminal-green"
          style={{ boxShadow: "0 0 4px rgba(0,255,136,0.3)" }}
        />
        {/* Label / ID row */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commitEdit}
              onClick={(e) => e.stopPropagation()}

              placeholder={shortId}
              className="flex-1 min-w-0 retro-input text-[10px] px-1.5 py-0.5 font-mono tracking-wide"
            />
          ) : (
            <span className="font-mono text-[10px] truncate flex-1 tracking-wide" style={{ color: label ? "rgb(148,163,184)" : "rgb(71,85,105)" }}>
              {label ? (
                <span className="text-slate-300">{label}</span>
              ) : (
                <span className="text-slate-600">{shortId}</span>
              )}
            </span>
          )}
          {!editing && (
            <button
              onClick={startEditing}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-700 hover:text-slate-400 shrink-0"
              title="Set session label"
            >
              <Pencil size={9} />
            </button>
          )}
          {editing && (
            <button
              onClick={handleCommitClick}
              className="text-terminal-green shrink-0"
              title="Save label"
            >
              <Check size={10} />
            </button>
          )}
        </div>
        <span className="text-[9px] text-slate-700 flex items-center gap-1 font-mono shrink-0" title="Runs in conversation">
          <Layers size={9} />
          {runCount}
        </span>
      </div>
      {/* Sub-label: session ID when label is set */}
      {label && (
        <div className="pl-3.5 mb-0.5">
          <span className="font-mono text-[8px] text-slate-700 truncate block">{shortId}</span>
        </div>
      )}
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
