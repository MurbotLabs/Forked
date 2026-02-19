import { type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
};

export function Modal({ open, onClose, title, subtitle, children, width = "max-w-2xl" }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className={`relative ${width} w-[90vw] max-h-[80vh] flex flex-col retro-card overflow-hidden`}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            style={{
              boxShadow: "0 0 40px rgba(99, 102, 241, 0.08), 0 0 80px rgba(0, 0, 0, 0.5)",
            }}
          >
            {/* Scanline overlay */}
            <div className="absolute inset-0 scanlines opacity-[0.04] pointer-events-none" />

            <div className="flex items-start justify-between px-5 py-3 border-b border-dashed border-border-default shrink-0 relative z-10">
              <div>
                <h3 className="text-[11px] font-semibold text-accent uppercase tracking-[0.1em]">{title}</h3>
                {subtitle && <p className="text-[9px] text-slate-600 mt-0.5 font-mono">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                className="text-slate-600 hover:text-slate-400 transition-colors p-1 rounded hover:bg-surface-3 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto relative z-10">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
