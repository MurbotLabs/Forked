import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { fetchConfig } from "../../lib/api";

type Props = {
  onRefresh: () => void;
  isConnected?: boolean;
};

const ASCII_LOGO = `
███████╗ ██████╗ ██████╗ ██╗  ██╗███████╗██████╗
██╔════╝██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝██╔══██╗
█████╗  ██║   ██║██████╔╝█████╔╝ █████╗  ██║  ██║
██╔══╝  ██║   ██║██╔══██╗██╔═██╗ ██╔══╝  ██║  ██║
██║     ╚██████╔╝██║  ██║██║  ██╗███████╗██████╔╝
╚═╝      ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝`.trim();

export function Header({ onRefresh, isConnected = true }: Props) {
  const [retention, setRetention] = useState<number | "never" | null>(null);

  useEffect(() => {
    fetchConfig()
      .then((c) => setRetention(c.retentionDays))
      .catch(() => { });
  }, []);

  return (
    <header className="relative border-b border-border-default shrink-0 overflow-hidden noise-bg">
      {/* Scanline overlay */}
      <div className="absolute inset-0 scanlines opacity-[0.06]" />

      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-r from-surface-1 via-surface-0 to-surface-1" />

      <div className="relative z-10 px-5 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <pre className="text-[4.5px] leading-[5px] text-accent font-mono select-none crt-glow whitespace-pre">
            {ASCII_LOGO}
          </pre>
          {/* Fork logo — inline SVG so currentColor works with theme */}
          <svg
            viewBox="0 0 100 112"
            fill="none"
            className="h-8 w-auto select-none text-accent opacity-30 crt-glow"
            aria-hidden="true"
          >
            <path d="M 50 54 C 49 43 36 30 16 16" stroke="currentColor" strokeWidth="6" strokeLinecap="square" strokeLinejoin="miter"/>
            <path d="M 16 16 L 5 23" stroke="currentColor" strokeWidth="5.5" strokeLinecap="square"/>
            <path d="M 16 16 L 23 5"  stroke="currentColor" strokeWidth="5.5" strokeLinecap="square"/>
            <path d="M 50 54 C 51 43 64 30 84 16" stroke="currentColor" strokeWidth="6" strokeLinecap="square" strokeLinejoin="miter"/>
            <path d="M 84 16 L 95 23" stroke="currentColor" strokeWidth="5.5" strokeLinecap="square"/>
            <path d="M 84 16 L 77 5"  stroke="currentColor" strokeWidth="5.5" strokeLinecap="square"/>
            <path d="M 50 57 L 50 79" stroke="currentColor" strokeWidth="6" strokeLinecap="square"/>
            <circle cx="50" cy="87" r="7.5" stroke="currentColor" strokeWidth="4.5"/>
            <circle cx="50" cy="87" r="2.5" fill="currentColor"/>
            <rect x="44" y="95" width="12" height="4" fill="currentColor"/>
            <rect x="41" y="99" width="18" height="3" fill="currentColor"/>
          </svg>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] text-terminal-green font-mono tracking-[0.3em] uppercase crt-glow-amber" style={{ textShadow: '0 0 4px rgba(0,255,136,0.4)' }}>
              Time-Travel Debugger
            </span>
            <span className="text-[8px] text-slate-700 font-mono tracking-widest">
              v1.0 // {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="text-[7px] text-slate-800 font-mono tracking-widest">
              by Murbot Labs
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Status indicators */}
          <div className="flex items-center gap-3 px-3 py-1.5 rounded retro-card">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full status-dot ${isConnected ? "bg-terminal-green" : "bg-red-500"}`} style={{ color: isConnected ? '#00ff88' : '#ef4444' }} />
              <span className={`text-[9px] uppercase tracking-wider font-mono ${isConnected ? "text-terminal-green" : "text-red-400"}`}>
                {isConnected ? "Connected" : "Offline"}
              </span>
            </div>

            {retention !== null && (
              <>
                <span className="text-slate-800">│</span>
                <span className="text-[9px] text-slate-600 font-mono">
                  {retention === "never" ? "∞ retention" : `${retention}d cleanup`}
                </span>
              </>
            )}
          </div>

          <button
            onClick={onRefresh}
            className="text-slate-600 hover:text-terminal-green p-1.5 rounded transition-all duration-150 cursor-pointer retro-card hover:border-terminal-green/20"
            title="Refresh sessions"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
    </header>
  );
}
