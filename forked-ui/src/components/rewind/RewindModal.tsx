import { useState, useEffect } from "react";
import { GitFork, Trash2, Undo2, CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { previewRewind, createFork } from "../../lib/api";
import type { RewindPreview } from "../../lib/types";

type ForkRewindResult = {
  success: boolean;
  newRunId?: string;
  message?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  runId: string;
  targetSeq: number;
  onForkRewindCreated: () => void;
};

export function RewindModal({ open, onClose, runId, targetSeq, onForkRewindCreated }: Props) {
  const [preview, setPreview] = useState<RewindPreview | null>(null);
  const [result, setResult] = useState<ForkRewindResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    if (open && runId && targetSeq != null) {
      setLoading(true);
      setResult(null);
      previewRewind(runId, targetSeq)
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setLoading(false));
    }
  }, [open, runId, targetSeq]);

  const handleForkRewind = async () => {
    setExecuting(true);
    try {
      const res = await createFork(runId, targetSeq, {
        type: "rewind_fork",
        __forkedRewindFirst: {
          runId,
          targetSeq,
        },
      });
      setResult(res);
      if (res.success) {
        onForkRewindCreated();
      }
    } catch (err) {
      setResult({ success: false, message: String(err) });
    } finally {
      setExecuting(false);
    }
  };

  return (
      <Modal
      open={open}
      onClose={onClose}
      title="Fork & Rewind"
      subtitle={`Create a new fork timeline from state before event #${targetSeq}`}
    >
      <div className="p-5 space-y-4">
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="text-rewind animate-spin" />
            <span className="ml-2 text-sm text-slate-400">Analyzing rewind point...</span>
          </div>
        )}

        {/* Preview */}
        {!loading && !result && preview && (
          <>
            {preview.files.length === 0 ? (
              <div className="space-y-4">
                <div className="text-center py-6">
                  <Undo2 size={28} className="text-slate-600 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">
                    No file snapshots were found before this point.
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    You can still create a fork from this timeline point.
                  </p>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button variant="rewind" onClick={handleForkRewind} disabled={executing}>
                    {executing ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Forking...
                      </>
                    ) : (
                      <>
                        <GitFork size={14} />
                        Fork & Rewind
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                  <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300/80 leading-relaxed">
                    This creates a new fork timeline. Forked rewinds files first, then starts a new fork run from this point.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <span className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold">
                    Files to be affected ({preview.files.length})
                  </span>
                  {preview.files.map((file) => (
                    <div
                      key={file.filePath}
                      className="flex items-center gap-2.5 px-3 py-2 bg-surface-2 border border-border-subtle rounded-lg"
                    >
                      {file.action === "restore" ? (
                        <Undo2 size={13} className="text-emerald-400 shrink-0" />
                      ) : (
                        <Trash2 size={13} className="text-red-400 shrink-0" />
                      )}
                      <span className="font-mono text-[11px] text-slate-300 truncate flex-1">
                        {file.filePath}
                      </span>
                      <span
                        className={`text-[10px] font-medium ${
                          file.action === "restore" ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {file.action === "restore" ? "Restore" : "Delete"}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button variant="rewind" onClick={handleForkRewind} disabled={executing}>
                    {executing ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Forking...
                      </>
                    ) : (
                      <>
                        <GitFork size={14} />
                        Fork & Rewind
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-3">
            <div
              className={`flex items-center gap-2 p-3 rounded-lg border ${
                result.success
                  ? "bg-emerald-500/5 border-emerald-500/20"
                  : "bg-red-500/5 border-red-500/20"
              }`}
            >
              {result.success ? (
                <CheckCircle size={16} className="text-emerald-400" />
              ) : (
                <XCircle size={16} className="text-red-400" />
              )}
              <span className={`text-sm font-medium ${result.success ? "text-emerald-300" : "text-red-300"}`}>
                {result.success
                  ? "Fork created from rewound state."
                  : `Fork & rewind failed: ${result.message ?? "Unknown error"}`}
              </span>
            </div>

            {result.newRunId && (
              <div className="px-3 py-2 bg-surface-2 border border-border-subtle rounded-lg">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Fork Run</span>
                <p className="font-mono text-[11px] text-slate-300 mt-1 break-all">{result.newRunId}</p>
              </div>
            )}

            {result.message && result.success && (
              <p className="text-[11px] text-slate-500">{result.message}</p>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
