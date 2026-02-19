export const STREAM_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  lifecycle: {
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
    label: "Lifecycle",
  },
  tool: {
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/40",
    label: "Tool",
  },
  assistant: {
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/40",
    label: "Assistant",
  },
  error: {
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/40",
    label: "Error",
  },
  fork_info: {
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
    label: "Fork",
  },
  rewind: {
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/40",
    label: "Rewind",
  },
};

export const DEFAULT_STREAM_CONFIG = {
  color: "text-slate-400",
  bg: "bg-slate-500/10",
  border: "border-slate-500/40",
  label: "Event",
};

export const STREAM_DOT_COLORS: Record<string, string> = {
  lifecycle: "bg-emerald-500",
  tool: "bg-blue-500",
  assistant: "bg-violet-500",
  error: "bg-red-500",
  fork_info: "bg-amber-500",
  rewind: "bg-purple-500",
};

export const EVENT_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  message_received: {
    label: "Agent Input",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
  },
  message_sent: {
    label: "Agent Output",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
  },
  llm_input: {
    label: "LLM Request",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/40",
  },
  llm_output: {
    label: "LLM Response",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/40",
  },
  tool_call_start: {
    label: "Tool Call",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/40",
  },
  tool_call_end: {
    label: "Tool Result",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/40",
  },
  session_start: {
    label: "Session Start",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
  },
  session_end: {
    label: "Session End",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
  },
  gateway_start: {
    label: "Gateway Start",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
  },
  agent_end: {
    label: "Agent End",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
  },
  config_change: {
    label: "Config Change",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/40",
  },
  setup_file_change: {
    label: "Setup File",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/40",
  },
  fork_info: {
    label: "Fork",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
  },
  rewind_executed: {
    label: "Rewind",
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/40",
  },
};

export const FILE_MODIFYING_TOOLS = new Set(["write", "edit", "apply_patch"]);
