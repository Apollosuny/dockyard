import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { killProcess, killProcesses, listPorts } from "./api";
import type { KillResult, PortEntry, ProjectKind } from "./types";
import logo from "./assets/logo.png";
import "./App.css";

const AUTO_REFRESH_MS = 3000;

const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  node: "Node",
  rust: "Rust",
  python: "Python",
  go: "Go",
  git: "Git",
};

function App() {
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [force, setForce] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      // Drop selections whose ports are no longer listening.
      const live = new Set(rows.map((r) => r.port));
      setSelected((prev) => new Set([...prev].filter((p) => live.has(p))));
    } catch (e) {
      setError(String(e));
    } finally {
      inFlight.current = false;
      setLoading(false);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ports;
    return ports.filter((p) => {
      const haystack = [
        String(p.port),
        String(p.pid),
        p.process_name,
        p.command ?? "",
        p.project?.name ?? "",
        p.project?.path ?? "",
        p.cwd ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [ports, query]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.port));

  function toggle(port: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(port)) {
        next.delete(port);
      } else {
        next.add(port);
      }
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filtered.forEach((p) => next.delete(p.port));
      } else {
        filtered.forEach((p) => next.add(p.port));
      }
      return next;
    });
  }

  function reportKills(results: KillResult[]) {
    const failed = results.filter((r) => !r.success);
    if (failed.length === 0) {
      setNotice(
        `Killed ${results.length} process${results.length === 1 ? "" : "es"}.`,
      );
    } else {
      const detail = failed
        .map((r) => `PID ${r.pid}: ${r.error ?? "unknown error"}`)
        .join("; ");
      setNotice(
        `${results.length - failed.length} killed, ${failed.length} failed — ${detail}`,
      );
    }
  }

  async function handleKillOne(pid: number) {
    setNotice(null);
    const result = await killProcess(pid, force);
    reportKills([result]);
    await refresh();
  }

  async function handleKillPids(pids: number[]) {
    if (pids.length === 0) return;
    const label = force ? "force-kill" : "kill";
    if (!confirm(`Are you sure you want to ${label} ${pids.length} process(es)?`)) {
      return;
    }
    setNotice(null);
    const results = await killProcesses(pids, force);
    reportKills(results);
    setSelected(new Set());
    await refresh();
  }

  const selectedPids = useMemo(() => {
    const byPort = new Map(ports.map((p) => [p.port, p.pid]));
    return [...selected]
      .map((port) => byPort.get(port))
      .filter((v): v is number => v != null);
  }, [ports, selected]);

  const allVisiblePids = useMemo(
    () => [...new Set(filtered.map((p) => p.pid))],
    [filtered],
  );

  return (
    <main className="app">
      <header className="toolbar">
        <div className="toolbar__title">
          <img src={logo} alt="Dockyard Logo" className="toolbar__logo" />
          <div className="toolbar__title-text">
            <h1>Dockyard</h1>
            <span className="toolbar__subtitle">Listening TCP ports</span>
          </div>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Filter by port, process, project…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="toolbar__actions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto
          </label>
          <label className="checkbox" title="Use SIGKILL (-9) instead of SIGTERM">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            Force
          </label>
          <button onClick={() => void refresh()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            className="danger"
            disabled={selectedPids.length === 0}
            onClick={() => void handleKillPids(selectedPids)}
          >
            Kill selected ({selectedPids.length})
          </button>
          <button
            className="danger danger--outline"
            disabled={allVisiblePids.length === 0}
            onClick={() => void handleKillPids(allVisiblePids)}
          >
            Kill all
          </button>
        </div>
      </header>

      {error && <div className="banner banner--error">{error}</div>}
      {notice && (
        <div className="banner" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      <div className="table-wrap">
        <table className="ports">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label="Select all visible"
                />
              </th>
              <th className="col-port">Port</th>
              <th>Process</th>
              <th>Project</th>
              <th className="col-pid">PID</th>
              <th>Command</th>
              <th className="col-action"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={`${p.pid}-${p.port}`}>
                <td className="col-check">
                  <input
                    type="checkbox"
                    checked={selected.has(p.port)}
                    onChange={() => toggle(p.port)}
                    aria-label={`Select port ${p.port}`}
                  />
                </td>
                <td className="col-port">
                  <span className="port-badge">{p.port}</span>
                  <span className="addr">{p.address}</span>
                </td>
                <td>{p.process_name}</td>
                <td>
                  {p.project ? (
                    <span className="project" title={p.project.path}>
                      <span className={`tag tag--${p.project.kind}`}>
                        {PROJECT_KIND_LABEL[p.project.kind]}
                      </span>
                      {p.project.name}
                    </span>
                  ) : (
                    <span className="muted" title={p.cwd ?? ""}>
                      {p.cwd ? shortenPath(p.cwd) : "—"}
                    </span>
                  )}
                </td>
                <td className="col-pid">{p.pid}</td>
                <td className="command" title={p.command ?? ""}>
                  {p.command ?? "—"}
                </td>
                <td className="col-action">
                  <button
                    className="danger danger--sm"
                    onClick={() => void handleKillOne(p.pid)}
                  >
                    Kill
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  {ports.length === 0
                    ? "No listening ports found."
                    : "No ports match the filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="statusbar">
        {filtered.length} of {ports.length} port(s)
        {autoRefresh && " · auto-refresh on"}
      </footer>
    </main>
  );
}

/** Collapse a long absolute path to `…/parent/dir` for compact display. */
function shortenPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return "…/" + parts.slice(-2).join("/");
}

export default App;
