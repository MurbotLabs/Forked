import { type ReactNode } from "react";

export function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <div className="text-slate-800 mb-4">{icon}</div>
      <h3 className="text-[11px] font-mono text-slate-600 mb-1 uppercase tracking-wider">{title}</h3>
      <p className="text-[10px] text-slate-700 max-w-[260px] font-mono leading-relaxed">{description}</p>
      <div className="mt-4 text-[9px] text-slate-800 font-mono blink-cursor">Awaiting input</div>
    </div>
  );
}
