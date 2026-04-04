import { useState, useEffect, useCallback } from "react";
import { SUPABASE_KEY, seedLogsIfEmpty, fetchCommunityLogs, insertLog } from "../lib/supabase.js";

export const LOG_KEY = "taranaki_dive_log";

export function loadLog() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveLog(entries) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(entries)); } catch {}
}

// ── Community log hook (Supabase) ──────────────────────────────────────────────
export function useCommunityLogs() {
  const [logs, setLogs] = useState([]);
  const [logStatus, setLogStatus] = useState("idle");
  const isConfigured = SUPABASE_KEY !== "YOUR_KEY_HERE" && SUPABASE_KEY.length > 10;

  const load = useCallback(async () => {
    if (!isConfigured) { setLogStatus("unconfigured"); return; }
    setLogStatus("loading");
    try {
      await seedLogsIfEmpty();
      const data = await fetchCommunityLogs();
      setLogs(data);
      setLogStatus("ok");
    } catch(e) {
      console.error("Supabase fetch error:", e);
      setLogStatus("error");
    }
  }, [isConfigured]);

  useEffect(() => { load(); }, [load]);

  const addLog = useCallback(async (entry) => {
    if (!isConfigured) throw new Error("Supabase not configured");
    const [inserted] = await insertLog(entry);
    setLogs(prev => [inserted, ...prev]);
    return inserted;
  }, [isConfigured]);

  return { logs, logStatus, addLog, refresh: load, isConfigured };
}
