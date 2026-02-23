import { useState, useEffect, useCallback } from "react";
import type { Session } from "./lib/types";
import { fetchSessions } from "./lib/api";
import { Header } from "./components/layout/Header";
import { Sidebar } from "./components/layout/Sidebar";
import { Timeline } from "./components/timeline/Timeline";
import { ConfigPanel } from "./components/config/ConfigPanel";

type Tab = "traces" | "config";

const THEME_KEY = "forked.theme";

function App() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [connected, setConnected] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("traces");
  const [isDark, setIsDark] = useState<boolean>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    return stored !== "light";
  });

  // Apply/remove the .light class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.remove("light");
    } else {
      root.classList.add("light");
    }
    localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  }, [isDark]);

  const toggleTheme = useCallback(() => setIsDark((prev) => !prev), []);

  const refreshSessions = useCallback(() => {
    fetchSessions()
      .then((data) => {
        setSessions(data);
        setConnected(true);
      })
      .catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    refreshSessions();
    const interval = setInterval(refreshSessions, 3000);
    return () => clearInterval(interval);
  }, [refreshSessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const stillExists = sessions.some(
      (session) =>
        session.run_id === selectedSessionId ||
        session.session_key === selectedSessionId ||
        (session.session_key ?? session.run_id) === selectedSessionId
    );
    if (!stillExists) {
      setSelectedSessionId(null);
    }
  }, [sessions, selectedSessionId]);

  return (
    <div className="bg-surface-0 text-slate-300 min-h-screen flex flex-col scanlines-full relative">
      <Header onRefresh={refreshSessions} isConnected={connected} isDark={isDark} onToggleTheme={toggleTheme} />

      {/* Tab bar */}
      <div className="flex items-center border-b border-border-default bg-surface-1 shrink-0 px-4">
        {(["traces", "config"] as Tab[]).map((tab) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-[9px] font-mono uppercase tracking-[0.2em] border-b-2 transition-all cursor-pointer ${
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-slate-600 hover:text-slate-400"
              }`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      <main className="flex flex-1 overflow-hidden">
        {activeTab === "traces" ? (
          <>
            <Sidebar
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              onSelect={setSelectedSessionId}
            />
            <Timeline sessionId={selectedSessionId} sessions={sessions} onForkCreated={refreshSessions} />
          </>
        ) : (
          <ConfigPanel />
        )}
      </main>

      {/* Disclaimer footer */}
      <div className="shrink-0 border-t border-border-default bg-surface-1 px-4 py-1.5 flex items-center justify-center">
        <span className="text-[8px] font-mono text-slate-800 tracking-wide text-center">
          v1.0 — Early release. Bugs are expected. Murbot Labs takes no responsibility for any changes made to your agent setup. Use at your own risk.
        </span>
      </div>
    </div>
  );
}

export default App;
