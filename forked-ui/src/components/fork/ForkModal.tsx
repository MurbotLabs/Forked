import { useState, useEffect, useMemo } from "react";
import { GitFork, AlertCircle, Loader2, CheckCircle, XCircle, RotateCcw, Cpu } from "lucide-react";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import type { TraceEvent } from "../../lib/types";

type ForkResult = {
  success: boolean;
  newRunId?: string;
  message?: string;
};

type ModelOption = { id: string; alias?: string; isPrimary: boolean };

type Props = {
  open: boolean;
  event: TraceEvent | null;
  events: TraceEvent[];
  onClose: () => void;
  onFork: (modifiedData: Record<string, unknown>) => Promise<ForkResult>;
  availableModels?: ModelOption[];
};

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractModelFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  return typeof payload.model === "string" ? payload.model : null;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restoreModelFields(
  previous: Record<string, unknown>,
  current: Record<string, unknown>
): { next: Record<string, unknown>; changes: number } {
  const next: Record<string, unknown> = Array.isArray(current) ? [...current] as never : { ...current };
  let changes = 0;

  for (const [key, currentValue] of Object.entries(current)) {
    const previousValue = previous[key];
    const isModelKey = key.toLowerCase().includes("model");

    if (isModelKey && typeof previousValue === "string") {
      if (currentValue !== previousValue) {
        next[key] = previousValue;
        changes += 1;
      }
      continue;
    }

    if (isObjectLike(currentValue) && isObjectLike(previousValue)) {
      const nested = restoreModelFields(previousValue, currentValue);
      next[key] = nested.next;
      changes += nested.changes;
      continue;
    }

    if (Array.isArray(currentValue) && Array.isArray(previousValue)) {
      const updatedArray = [...currentValue];
      let arrayChanges = 0;

      for (let i = 0; i < Math.min(currentValue.length, previousValue.length); i++) {
        const cItem = currentValue[i];
        const pItem = previousValue[i];
        if (isObjectLike(cItem) && isObjectLike(pItem)) {
          const nested = restoreModelFields(pItem, cItem);
          updatedArray[i] = nested.next;
          arrayChanges += nested.changes;
        }
      }

      if (arrayChanges > 0) {
        next[key] = updatedArray;
        changes += arrayChanges;
      }
    }
  }

  return { next, changes };
}

export function ForkModal({ open, event, events, onClose, onFork, availableModels = [] }: Props) {
  const [modifiedData, setModifiedData] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ForkResult | null>(null);
  const [rewindFirst, setRewindFirst] = useState(false);

  // Reset state when event changes or modal opens
  useEffect(() => {
    if (open && event) {
      setResult(null);
      setLoading(false);
      setJsonError(null);
      try {
        setModifiedData(JSON.stringify(JSON.parse(event.data), null, 2));
      } catch {
        setModifiedData(event.data);
      }
      const parsedEvent = tryParseJson(event.data);
      setRewindFirst(parsedEvent?.type === "config_change");
    }
  }, [open, event]);

  const parsedModified = useMemo(() => tryParseJson(modifiedData), [modifiedData]);
  const isConfigChange = parsedModified?.type === "config_change";

  // Detect whether the current JSON payload has a top-level "model" field
  const currentModel = typeof parsedModified?.model === "string" ? parsedModified.model : null;
  const showModelPicker = currentModel !== null && availableModels.length > 0;

  const applyModelFromPicker = (modelId: string) => {
    const parsed = tryParseJson(modifiedData);
    if (!parsed) return;
    parsed.model = modelId;
    setModifiedData(`${JSON.stringify(parsed, null, 2)}\n`);
    setJsonError(null);
  };

  const previousModel = useMemo(() => {
    if (!event) return null;
    const current = extractModelFromPayload(tryParseJson(event.data));
    if (!current) return null;

    const priorEvents = events
      .filter((e) => e.run_id === event.run_id && (e.ts < event.ts || (e.ts === event.ts && e.seq < event.seq)))
      .sort((a, b) => b.ts - a.ts || b.seq - a.seq);

    for (const prior of priorEvents) {
      const model = extractModelFromPayload(tryParseJson(prior.data));
      if (model && model !== current) return model;
    }

    return null;
  }, [event, events]);

  const applyPreviousModelPreset = () => {
    const parsed = tryParseJson(modifiedData);
    if (!parsed || !previousModel) return;
    parsed.model = previousModel;
    setModifiedData(`${JSON.stringify(parsed, null, 2)}\n`);
    setJsonError(null);
  };

  const applyPreviousConfigPreset = () => {
    const parsed = tryParseJson(modifiedData);
    if (!parsed || parsed.type !== "config_change") return;
    parsed.currentContent = parsed.previousContent ?? null;
    parsed.currentRaw = typeof parsed.previousRaw === "string" ? parsed.previousRaw : "";
    setModifiedData(`${JSON.stringify(parsed, null, 2)}\n`);
    setJsonError(null);
  };

  const applyPreviousModelInConfigPreset = () => {
    const parsed = tryParseJson(modifiedData);
    if (!parsed || parsed.type !== "config_change") return;
    if (!isObjectLike(parsed.previousContent) || !isObjectLike(parsed.currentContent)) return;

    const restored = restoreModelFields(parsed.previousContent, parsed.currentContent);
    if (restored.changes === 0) return;

    parsed.currentContent = restored.next;
    parsed.currentRaw = `${JSON.stringify(restored.next, null, 2)}\n`;
    setModifiedData(`${JSON.stringify(parsed, null, 2)}\n`);
    setJsonError(null);
  };

  const handleFork = async () => {
    try {
      const parsed = JSON.parse(modifiedData) as Record<string, unknown>;
      if (rewindFirst && event) {
        parsed.__forkedRewindFirst = {
          runId: event.run_id,
          targetSeq: event.seq,
        };
      }
      setJsonError(null);
      setLoading(true);
      try {
        const res = await onFork(parsed);
        setResult(res);
      } catch (err) {
        setResult({ success: false, message: String(err) });
      } finally {
        setLoading(false);
      }
    } catch (e) {
      setJsonError(`Invalid JSON: ${(e as Error).message}`);
    }
  };

  const handleClose = () => {
    setResult(null);
    setLoading(false);
    setJsonError(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Fork Event"
      subtitle={event ? `Editing ${event.stream} event at #${event.seq}` : undefined}
    >
      {/* Result view */}
      {result ? (
        <div className="p-5 space-y-3">
          <div
            className={`flex items-center gap-2.5 p-3 rounded border ${result.success
                ? "bg-emerald-500/5 border-emerald-500/20"
                : "bg-red-500/5 border-red-500/20"
              }`}
          >
            {result.success ? (
              <CheckCircle size={16} className="text-terminal-green shrink-0" />
            ) : (
              <XCircle size={16} className="text-red-400 shrink-0" />
            )}
            <div className="min-w-0">
              <p className={`text-[11px] font-mono font-medium ${result.success ? "text-terminal-green" : "text-red-300"}`}>
                {result.success ? "Fork executed successfully" : "Fork failed"}
              </p>
              {result.message && (
                <p className="text-[10px] text-slate-500 font-mono mt-0.5 break-all">{result.message}</p>
              )}
              {result.newRunId && (
                <p className="text-[9px] text-slate-600 font-mono mt-0.5">
                  Session: {result.newRunId}
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={handleClose}>Close</Button>
          </div>
        </div>
      ) : (
        /* Editor view */
        <div className="flex flex-col h-[50vh]">
          <div className="px-4 py-2 border-b border-dashed border-border-default flex flex-wrap items-center gap-2">
            {showModelPicker && (
              <div className="flex items-center gap-1.5">
                <Cpu size={10} className="text-accent shrink-0" />
                <span className="text-[9px] font-mono text-slate-600 uppercase tracking-wider">Model:</span>
                <select
                  value={currentModel}
                  onChange={(e) => applyModelFromPicker(e.target.value)}
                  disabled={loading}
                  className="retro-input text-[10px] py-0.5 px-2 text-accent bg-surface-2 border-accent/30 rounded cursor-pointer"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}{m.alias ? ` (${m.alias})` : ""}{m.isPrimary ? " ★" : ""}
                    </option>
                  ))}
                  {/* Keep the current model selectable even if not in the list */}
                  {!availableModels.some((m) => m.id === currentModel) && (
                    <option value={currentModel}>{currentModel}</option>
                  )}
                </select>
              </div>
            )}

            {previousModel && (
              <button
                onClick={applyPreviousModelPreset}
                disabled={loading}
                className="retro-btn bg-accent/10 text-accent border-accent/30 hover:bg-accent/20 px-2 py-1"
                title="Set this fork to use the previous known model name"
              >
                <Cpu size={10} className="inline mr-1" />
                Go Back to Previous Model ({previousModel})
              </button>
            )}

            {isConfigChange && (
              <>
                <button
                  onClick={applyPreviousConfigPreset}
                  disabled={loading}
                  className="retro-btn bg-rewind/10 text-rewind border-rewind/30 hover:bg-rewind/20 px-2 py-1"
                  title="Set currentContent/currentRaw to the previous config state"
                >
                  <RotateCcw size={10} className="inline mr-1" />
                  Revert Config to Previous State
                </button>
                <button
                  onClick={applyPreviousModelInConfigPreset}
                  disabled={loading}
                  className="retro-btn bg-accent/10 text-accent border-accent/30 hover:bg-accent/20 px-2 py-1"
                  title="Only restore model-related keys from previousContent into currentContent"
                >
                  <Cpu size={10} className="inline mr-1" />
                  Revert Model Fields
                </button>
                <button
                  onClick={() => setRewindFirst((prev) => !prev)}
                  disabled={loading}
                  className={`retro-btn px-2 py-1 ${
                    rewindFirst
                      ? "bg-rewind/20 text-rewind border-rewind/40"
                      : "bg-surface-3 text-slate-400 border-border-default"
                  }`}
                  title="When enabled: rewind to this event first, then apply config edits, then replay"
                >
                  <RotateCcw size={10} className="inline mr-1" />
                  {rewindFirst ? "Rewind to Here First: ON" : "Rewind to Here First: OFF"}
                </button>
              </>
            )}
          </div>

          <textarea
            className="flex-1 p-4 bg-surface-0 text-terminal-green/80 font-mono text-[10px] resize-none w-full border-none outline-none leading-relaxed"
            style={{ textShadow: "0 0 2px rgba(0,255,136,0.1)" }}
            value={modifiedData}
            onChange={(e) => {
              setModifiedData(e.target.value);
              setJsonError(null);
            }}
            spellCheck={false}
            disabled={loading}
          />
          <div className="px-5 py-3 border-t border-dashed border-border-default flex items-center justify-between shrink-0">
            <div>
              {jsonError && (
                <div className="flex items-center gap-1.5 text-red-400 text-[10px] font-mono">
                  <AlertCircle size={11} />
                  {jsonError}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleFork} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Forking...
                  </>
                ) : (
                  <>
                    <GitFork size={12} />
                    Fork &amp; Replay
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
