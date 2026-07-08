import { useCallback, useEffect, useRef, useState } from "react";
import { killProcesses, listPorts } from "../api";
import type { KillResult, PortEntry } from "../types";

const AUTO_REFRESH_MS = 3000;
// Give a gracefully-stopping process time to release its socket before we
// re-scan; a graceful SIGTERM isn't instant, so an immediate lsof still sees it.
const RECONCILE_MS = 800;

export type UsePorts = {
  ports: PortEntry[];
  loading: boolean;
  hasLoaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  killPids: (pids: number[], force: boolean) => Promise<KillResult[]>;
};

/**
 * Owns the port listing: initial load, manual/auto refresh, and killing.
 * Kills apply optimistically (successful PIDs drop from the list immediately)
 * then reconcile against a fresh scan once the OS has torn down the socket.
 */
export function usePorts(autoRefresh: boolean): UsePorts {
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Avoid overlapping refreshes when a slow lsof call outlives the interval.
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const rows = await listPorts();
      setPorts(rows);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      inFlight.current = false;
      setLoading(false);
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => void refresh(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  const killPids = useCallback(
    async (pids: number[], force: boolean): Promise<KillResult[]> => {
      const results = await killProcesses(pids, force);
      const killed = new Set(
        results.filter((r) => r.success).map((r) => r.pid),
      );
      if (killed.size > 0) {
        setPorts((prev) => prev.filter((p) => !killed.has(p.pid)));
      }
      setTimeout(() => void refresh(), RECONCILE_MS);
      return results;
    },
    [refresh],
  );

  return { ports, loading, hasLoaded, error, refresh, killPids };
}
