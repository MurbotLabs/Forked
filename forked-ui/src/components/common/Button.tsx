import { type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "rewind" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent/20 hover:bg-accent/30 text-accent border-accent/40 hover:border-accent/60 glow-accent",
  rewind:
    "bg-rewind/20 hover:bg-rewind/30 text-rewind border-rewind/40 hover:border-rewind/60 glow-rewind",
  ghost:
    "bg-transparent hover:bg-surface-3 text-slate-500 hover:text-slate-300 border-border-default hover:border-border-active",
  danger:
    "bg-red-600/20 hover:bg-red-600/30 text-red-400 border-red-500/40 hover:border-red-500/60 glow-error",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
};

export function Button({ variant = "primary", size = "md", className = "", children, ...props }: Props) {
  const sizeClass = size === "sm" ? "text-[10px] px-2.5 py-1" : "text-[11px] px-4 py-1.5";
  return (
    <button
      className={`retro-btn inline-flex items-center justify-center gap-1.5 ${variants[variant]} ${sizeClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
