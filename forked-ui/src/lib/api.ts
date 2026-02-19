import type { Session, TraceEvent, FileSnapshot, RewindPreview, RewindResult } from "./types";

const API_BASE = "http://127.0.0.1:8000";

export async function fetchSessions(): Promise<Session[]> {
  const res = await fetch(`${API_BASE}/api/sessions`);
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function fetchTraces(sessionId: string): Promise<TraceEvent[]> {
  const res = await fetch(`${API_BASE}/api/traces/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error("Failed to fetch traces");
  return res.json();
}

export async function fetchSnapshots(sessionId: string): Promise<FileSnapshot[]> {
  const res = await fetch(`${API_BASE}/api/snapshots/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error("Failed to fetch snapshots");
  return res.json();
}

export async function previewRewind(runId: string, targetSeq: number): Promise<RewindPreview> {
  const res = await fetch(`${API_BASE}/api/rewind/preview/${runId}/${targetSeq}`);
  if (!res.ok) throw new Error("Failed to preview rewind");
  return res.json();
}

export async function executeRewind(runId: string, targetSeq: number): Promise<RewindResult> {
  const res = await fetch(`${API_BASE}/api/rewind`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, targetSeq }),
  });
  if (!res.ok) throw new Error("Rewind request failed");
  return res.json();
}

export async function createFork(
  originalRunId: string,
  forkFromSeq: number,
  modifiedData: unknown
): Promise<{ success: boolean; newRunId?: string; message?: string }> {
  const res = await fetch(`${API_BASE}/api/fork`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ originalRunId, forkFromSeq, modifiedData }),
  });
  // Parse body even on error status codes — daemon returns structured error info
  const body = await res.json();
  return body;
}

/** Fetch all sessions that are forks of a given run */
export async function fetchForkChildren(parentRunId: string, allSessions: Session[]): Promise<Session[]> {
  return allSessions.filter((s) => s.forked_from_run_id === parentRunId);
}

export async function fetchConfig(): Promise<{ retentionDays: number | "never" }> {
  const res = await fetch(`${API_BASE}/api/config`);
  if (!res.ok) throw new Error("Failed to fetch config");
  return res.json();
}

export async function fetchOpenClawConfig(): Promise<{ ok: boolean; config?: OpenClawConfig; error?: string }> {
  const res = await fetch(`${API_BASE}/api/openclaw-config`);
  if (!res.ok) throw new Error("Failed to fetch OpenClaw config");
  return res.json();
}

export type OpenClawConfig = {
  meta?: { lastTouchedVersion?: string; lastTouchedAt?: string };
  agents?: {
    defaults?: {
      model?: { primary?: string };
      models?: Record<string, { alias?: string }>;
      workspace?: string;
      maxConcurrent?: number;
      compaction?: { mode?: string };
      subagents?: { maxConcurrent?: number };
    };
  };
  channels?: Record<string, { enabled?: boolean; [key: string]: unknown }>;
  gateway?: { port?: number; mode?: string; bind?: string; tailscale?: { mode?: string } };
  plugins?: { entries?: Record<string, { enabled?: boolean }> };
  skills?: { entries?: Record<string, Record<string, unknown>> };
  hooks?: { internal?: { enabled?: boolean; entries?: Record<string, { enabled?: boolean }> } };
  commands?: { native?: string; nativeSkills?: string };
};
