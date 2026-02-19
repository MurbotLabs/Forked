import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";

type DiffLine = {
  kind: "context" | "add" | "remove";
  text: string;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function splitLines(input: string): string[] {
  return input.replaceAll("\r\n", "\n").split("\n");
}

function buildLineDiff(beforeText: string, afterText: string): DiffLine[] | "too_large" {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);
  const MAX_DIFF_LINES = 240;

  if (before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES) {
    return "too_large";
  }

  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (before[i] === after[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (before[i] === after[j]) {
      diff.push({ kind: "context", text: before[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ kind: "remove", text: before[i] });
      i++;
    } else {
      diff.push({ kind: "add", text: after[j] });
      j++;
    }
  }

  while (i < n) {
    diff.push({ kind: "remove", text: before[i++] });
  }
  while (j < m) {
    diff.push({ kind: "add", text: after[j++] });
  }

  return diff;
}

export function DataInspector({ data }: { data: Record<string, unknown> }) {
  const [collapsed, setCollapsed] = useState(true);
  const [copied, setCopied] = useState(false);

  const rawData = data as Record<string, unknown>;
  const snapshot = toRecord(rawData.fileSnapshot);
  const filePath =
    (typeof snapshot?.filePath === "string" && snapshot.filePath) ||
    (typeof rawData.filePath === "string" && rawData.filePath) ||
    null;

  const beforeRaw =
    (typeof snapshot?.contentBefore === "string" ? snapshot.contentBefore : null) ??
    (typeof rawData.previousRaw === "string" ? rawData.previousRaw : null);
  const afterRaw =
    (typeof snapshot?.contentAfter === "string" ? snapshot.contentAfter : null) ??
    (typeof rawData.currentRaw === "string" ? rawData.currentRaw : null);

  const lineDiff = useMemo(() => {
    if (typeof beforeRaw !== "string" || typeof afterRaw !== "string") return null;
    if (beforeRaw === afterRaw) return [];
    return buildLineDiff(beforeRaw, afterRaw);
  }, [beforeRaw, afterRaw]);

  const displayData = { ...data };
  delete displayData.fileSnapshot;

  const jsonStr = JSON.stringify(displayData, null, 2);
  const lineCount = jsonStr.split("\n").length;
  const isLong = lineCount > 6;

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      {lineDiff && (
        <div className="mb-2 border border-dashed border-border-default rounded bg-surface-1/70 overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-dashed border-border-default flex items-center justify-between gap-2">
            <span className="text-[9px] text-slate-500 uppercase tracking-wider font-mono">
              Diff Preview
            </span>
            {filePath && (
              <span className="text-[9px] text-slate-600 font-mono truncate max-w-[60%]" title={filePath}>
                {filePath}
              </span>
            )}
          </div>
          {lineDiff === "too_large" ? (
            <div className="px-3 py-2 text-[10px] text-slate-500 font-mono">
              Diff hidden: change is too large for inline preview.
            </div>
          ) : lineDiff.length === 0 ? (
            <div className="px-3 py-2 text-[10px] text-slate-500 font-mono">
              No text changes.
            </div>
          ) : (
            <div className="max-h-44 overflow-auto">
              {lineDiff.map((line, idx) => {
                const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
                const lineClass =
                  line.kind === "add"
                    ? "bg-emerald-500/8 text-emerald-300"
                    : line.kind === "remove"
                      ? "bg-red-500/8 text-red-300"
                      : "text-slate-500";
                return (
                  <pre
                    key={`${idx}:${prefix}`}
                    className={`px-3 py-0.5 text-[10px] font-mono whitespace-pre-wrap break-all ${lineClass}`}
                  >
                    <span className="opacity-70 mr-1">{prefix}</span>
                    {line.text}
                  </pre>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <pre
          className={`bg-surface-0 border border-border-subtle rounded p-3 text-[10px] text-terminal-green/60 overflow-x-hidden whitespace-pre-wrap break-all max-w-full font-mono leading-relaxed ${collapsed && isLong ? "max-h-[120px] overflow-hidden" : ""}`}
          style={{ textShadow: "0 0 2px rgba(0,255,136,0.1)" }}
        >
          {jsonStr}
        </pre>
        {collapsed && isLong && (
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-surface-2 to-transparent rounded-b pointer-events-none" />
        )}
      </div>
      <div className="flex items-center gap-2 mt-1">
        {isLong && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-1 text-[9px] text-slate-700 hover:text-slate-500 transition-colors cursor-pointer font-mono tracking-wider uppercase"
          >
            {collapsed ? <ChevronRight size={9} /> : <ChevronDown size={9} />}
            {collapsed ? `Expand (${lineCount}l)` : "Collapse"}
          </button>
        )}
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[9px] text-slate-700 hover:text-slate-500 transition-colors cursor-pointer font-mono tracking-wider uppercase"
        >
          {copied ? <Check size={9} className="text-terminal-green" /> : <Copy size={9} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
