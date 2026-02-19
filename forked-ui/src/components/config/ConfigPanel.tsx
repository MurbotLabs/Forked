import { useEffect, useState } from "react";
import { Cpu, Layers, Radio, Plug, Wrench, Network, RefreshCw, AlertCircle, Star, Clock } from "lucide-react";
import { fetchOpenClawConfig, type OpenClawConfig } from "../../lib/api";

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-accent">{icon}</span>
      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-400">{title}</span>
      <div className="flex-1 h-px bg-border-default" />
    </div>
  );
}

function Chip({
  label,
  dim = false,
  green = false,
  amber = false,
  primary = false,
}: {
  label: string;
  dim?: boolean;
  green?: boolean;
  amber?: boolean;
  primary?: boolean;
}) {
  const cls = primary
    ? "bg-accent/15 border-accent/40 text-accent"
    : green
    ? "bg-terminal-green/10 border-terminal-green/30 text-terminal-green"
    : amber
    ? "bg-terminal-amber/10 border-terminal-amber/30 text-terminal-amber"
    : dim
    ? "bg-surface-2 border-border-default text-slate-600"
    : "bg-surface-3 border-border-active text-slate-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-mono ${cls}`}>
      {label}
    </span>
  );
}

function KV({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[8px] uppercase tracking-[0.15em] text-slate-700 font-mono">{k}</span>
      <span className={`text-[10px] text-slate-300 ${mono ? "font-mono" : ""} break-all`}>{v}</span>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`retro-card p-3 rounded space-y-2 bg-surface-1 ${className}`}>
      {children}
    </div>
  );
}

function ModelsSection({ config }: { config: OpenClawConfig }) {
  const defaults = config.agents?.defaults;
  const primary = defaults?.model?.primary;
  const models = defaults?.models ?? {};
  const workspace = defaults?.workspace;
  const maxConcurrent = defaults?.maxConcurrent;
  const subagentMax = defaults?.subagents?.maxConcurrent;
  const compaction = defaults?.compaction?.mode;

  const modelEntries = Object.entries(models);

  return (
    <div className="space-y-3">
      <SectionHeader icon={<Cpu size={12} />} title="Models" />
      {modelEntries.length === 0 ? (
        <p className="text-[10px] text-slate-700 font-mono italic">No models configured.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {modelEntries.map(([id, meta]) => {
            const isPrimary = id === primary;
            return (
              <Card key={id}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-mono text-slate-200 break-all leading-tight">{id}</span>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {isPrimary && (
                      <span className="flex items-center gap-1 text-[8px] font-mono text-accent uppercase tracking-wider">
                        <Star size={8} /> Primary
                      </span>
                    )}
                  </div>
                </div>
                {meta.alias && (
                  <div>
                    <Chip label={`alias: ${meta.alias}`} primary={isPrimary} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <SectionHeader icon={<Cpu size={12} />} title="Agent Settings" />
      <div className="grid grid-cols-3 gap-2">
        {workspace && <Card><KV k="Workspace" v={workspace} /></Card>}
        {maxConcurrent != null && <Card><KV k="Max Concurrent" v={String(maxConcurrent)} /></Card>}
        {subagentMax != null && <Card><KV k="Subagent Max" v={String(subagentMax)} /></Card>}
        {compaction && <Card><KV k="Compaction" v={compaction} /></Card>}
      </div>
    </div>
  );
}

function ChannelsSection({ config }: { config: OpenClawConfig }) {
  const channels = config.channels ?? {};
  const entries = Object.entries(channels);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-3">
      <SectionHeader icon={<Radio size={12} />} title="Channels" />
      <div className="grid grid-cols-2 gap-2">
        {entries.map(([name, ch]) => {
          const enabled = ch.enabled !== false;
          const safeKeys = Object.entries(ch).filter(
            ([k]) => !/token|secret|key|password/i.test(k) && k !== "enabled"
          );
          return (
            <Card key={name}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-slate-200 capitalize">{name}</span>
                <Chip label={enabled ? "enabled" : "disabled"} green={enabled} dim={!enabled} />
              </div>
              {safeKeys.map(([k, v]) => (
                <div key={k} className="text-[9px] font-mono text-slate-600">
                  <span className="text-slate-700">{k}: </span>
                  <span className="text-slate-500">{String(v)}</span>
                </div>
              ))}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function PluginsSection({ config }: { config: OpenClawConfig }) {
  const entries = Object.entries(config.plugins?.entries ?? {});
  if (entries.length === 0) return null;

  return (
    <div className="space-y-3">
      <SectionHeader icon={<Plug size={12} />} title="Plugins" />
      <div className="flex flex-wrap gap-2">
        {entries.map(([name, cfg]) => {
          const enabled = cfg.enabled !== false;
          return (
            <Card key={name} className="flex items-center gap-2 !space-y-0">
              <span className="text-[10px] font-mono text-slate-300">{name}</span>
              <Chip label={enabled ? "on" : "off"} green={enabled} dim={!enabled} />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SkillsSection({ config }: { config: OpenClawConfig }) {
  const entries = Object.entries(config.skills?.entries ?? {});
  if (entries.length === 0) return null;

  return (
    <div className="space-y-3">
      <SectionHeader icon={<Wrench size={12} />} title="Skills" />
      <div className="flex flex-wrap gap-2">
        {entries.map(([name, cfg]) => {
          const enabled = (cfg as any).enabled !== false;
          const hasRedacted = Object.values(cfg).some((v) => v === "[REDACTED]");
          return (
            <Card key={name} className="flex items-center gap-2 !space-y-0">
              <span className="text-[10px] font-mono text-slate-300">{name}</span>
              <Chip label={enabled ? "on" : "off"} green={enabled} dim={!enabled} />
              {hasRedacted && <Chip label="has secrets" amber />}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function HooksSection({ config }: { config: OpenClawConfig }) {
  const internal = config.hooks?.internal;
  if (!internal) return null;
  const entries = Object.entries(internal.entries ?? {});

  return (
    <div className="space-y-3">
      <SectionHeader icon={<Clock size={12} />} title="Hooks" />
      <div className="flex flex-wrap gap-2">
        <Card className="flex items-center gap-2 !space-y-0">
          <span className="text-[10px] font-mono text-slate-300">internal</span>
          <Chip label={internal.enabled !== false ? "on" : "off"} green={internal.enabled !== false} dim={internal.enabled === false} />
        </Card>
        {entries.map(([name, cfg]) => {
          const enabled = cfg.enabled !== false;
          return (
            <Card key={name} className="flex items-center gap-2 !space-y-0">
              <span className="text-[10px] font-mono text-slate-300">{name}</span>
              <Chip label={enabled ? "on" : "off"} green={enabled} dim={!enabled} />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function GatewaySection({ config }: { config: OpenClawConfig }) {
  const gw = config.gateway;
  if (!gw) return null;

  return (
    <div className="space-y-3">
      <SectionHeader icon={<Network size={12} />} title="Gateway" />
      <div className="grid grid-cols-4 gap-2">
        {gw.port != null && <Card><KV k="Port" v={String(gw.port)} /></Card>}
        {gw.mode && <Card><KV k="Mode" v={gw.mode} /></Card>}
        {gw.bind && <Card><KV k="Bind" v={gw.bind} /></Card>}
        {gw.tailscale?.mode && <Card><KV k="Tailscale" v={gw.tailscale.mode} /></Card>}
      </div>
    </div>
  );
}

export function ConfigPanel() {
  const [config, setConfig] = useState<OpenClawConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchOpenClawConfig()
      .then((res) => {
        if (res.ok && res.config) setConfig(res.config);
        else setError(res.error ?? "Unknown error");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="flex-1 h-full overflow-y-auto bg-surface-0 relative">
      <div className="absolute inset-0 grid-bg opacity-30" />

      <div className="relative z-10 max-w-4xl mx-auto px-6 py-6 space-y-8">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-accent" />
            <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-slate-400">
              OpenClaw Config
            </span>
            {config?.meta?.lastTouchedVersion && (
              <Chip label={`v${config.meta.lastTouchedVersion}`} />
            )}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="text-slate-600 hover:text-terminal-green p-1.5 rounded transition-all retro-card hover:border-terminal-green/20 cursor-pointer"
            title="Reload config"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 retro-card border-red-500/20 bg-red-500/5 rounded text-red-400 text-[10px] font-mono">
            <AlertCircle size={12} />
            {error}
          </div>
        )}

        {loading && !config && (
          <p className="text-[10px] text-slate-700 font-mono italic">Loading config...</p>
        )}

        {config && (
          <>
            <ModelsSection config={config} />
            <ChannelsSection config={config} />
            <PluginsSection config={config} />
            <SkillsSection config={config} />
            <HooksSection config={config} />
            <GatewaySection config={config} />
          </>
        )}
      </div>
    </div>
  );
}
