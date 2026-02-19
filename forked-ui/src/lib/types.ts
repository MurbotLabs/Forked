export type Session = {
  run_id: string;
  session_key: string | null;
  start_time: string;
  last_activity: string;
  event_count: number;
  llm_input_count?: number;
  llm_output_count?: number;
  is_fork: number | boolean;
  forked_from_run_id: string | null;
};

export type TraceEvent = {
  id: number;
  run_id: string;
  session_key: string | null;
  seq: number;
  stream: string;
  ts: number;
  data: string;
  is_fork: number;
  forked_from_run_id: string | null;
  created_at: string;
};

export type ParsedEventData = {
  type?: string;
  toolName?: string;
  error?: string;
  success?: boolean;
  provider?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
  };
  durationMs?: number;
  content?: string;
  fileSnapshot?: {
    filePath: string;
    contentBefore?: string;
    contentAfter?: string;
    existedBefore?: boolean;
    existsAfter?: boolean;
  };
  [key: string]: unknown;
};

export type FileSnapshot = {
  id: number;
  run_id: string;
  seq: number;
  tool_name: string;
  file_path: string;
  content_before: string | null;
  content_after: string | null;
  existed_before: number;
  exists_after: number;
  created_at: string;
};

export type RewindPreview = {
  runId: string;
  targetSeq: number;
  files: Array<{
    filePath: string;
    originalExisted: boolean;
    action: "restore" | "delete";
  }>;
};

export type RewindResult = {
  success: boolean;
  backupId?: string;
  filesAffected?: number;
  results?: Array<{
    filePath: string;
    action: string;
    success: boolean;
    error?: string;
  }>;
  message?: string;
};
