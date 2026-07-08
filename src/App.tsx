import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { killProcess, killProcesses, listPorts } from "./api";
import type { KillResult, PortEntry, ProjectKind } from "./types";
import logo from "./assets/logo.png";
import "./App.css";

const AUTO_REFRESH_MS = 3000;
const TOAST_MS = 4000;
// Give a gracefully-stopping process time to release its socket before we
// re-scan; a graceful SIGTERM isn't instant, so an immediate lsof still sees it.
const RECONCILE_MS = 800;

const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  node: "Node",
  rust: "Rust",
  python: "Python",
  go: "Go",
  git: "Git",
};

type Toast = { kind: "success" | "error"; message: string };

/** A pending destructive action awaiting confirmation in the modal. */
type PendingKill = { pids: number[]; scope: "selected" | "all" };

function App() {
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pending, setPending] = useState<PendingKill | null>(null);
  const [busy, setBusy] = useState(false);

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

  // Success toasts auto-dismiss; errors stay until the next action.
  useEffect(() => {
    if (toast?.kind !== "success") return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  // Distinct root folders present, for the folder filter dropdown.
  const folders = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; kind: ProjectKind | null; count: number }
    >();
    for (const p of ports) {
      const key = folderKeyOf(p);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else
        map.set(key, {
          key,
          label: p.project?.name ?? shortenPath(key),
          kind: p.project?.kind ?? null,
          count: 1,
        });
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [ports]);

  // Drop a folder selection that no longer maps to any listening port.
  useEffect(() => {
    if (folder && !folders.some((f) => f.key === folder)) setFolder(null);
  }, [folders, folder]);

  const filtersActive = query.trim() !== "" || folder !== null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ports.filter((p) => {
      if (folder && folderKeyOf(p) !== folder) return false;
      if (!q) return true;
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
  }, [ports, query, folder]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.port));

  function toggle(port: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(port)) next.delete(port);
      else next.add(port);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((p) => next.delete(p.port));
      else filtered.forEach((p) => next.add(p.port));
      return next;
    });
  }

  function reportKills(results: KillResult[]) {
    const failed = results.filter((r) => !r.success);
    if (failed.length === 0) {
      const n = results.length;
      setToast({
        kind: "success",
        message: `Stopped ${n} process${n === 1 ? "" : "es"}.`,
      });
    } else {
      const detail = failed
        .map((r) => `PID ${r.pid}: ${r.error ?? "unknown error"}`)
        .join(" · ");
      setToast({
        kind: "error",
        message: `${results.length - failed.length} stopped, ${failed.length} failed — ${detail}`,
      });
    }
  }

  // Reflect a kill in the UI right away, then reconcile against a fresh scan
  // once the OS has had time to tear down the socket of a graceful stop.
  function applyKillResults(results: KillResult[]) {
    reportKills(results);
    const killed = new Set(
      results.filter((r) => r.success).map((r) => r.pid),
    );
    if (killed.size > 0) {
      setPorts((prev) => prev.filter((p) => !killed.has(p.pid)));
    }
    setTimeout(() => void refresh(), RECONCILE_MS);
  }

  // Per-row kills are explicit and fast, so they run immediately.
  async function handleKillOne(pid: number) {
    setBusy(true);
    try {
      const result = await killProcess(pid, force);
      applyKillResults([result]);
    } finally {
      setBusy(false);
    }
  }

  // Bulk kills go through the confirmation modal first.
  async function confirmPending() {
    if (!pending) return;
    setBusy(true);
    try {
      const results = await killProcesses(pending.pids, force);
      applyKillResults(results);
      setSelected(new Set());
      setPending(null);
    } finally {
      setBusy(false);
    }
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
      <header className="topbar">
        <div className="brand">
          <img src={logo} alt="" className="brand__logo" />
          <div className="brand__text">
            <h1>Dockyard</h1>
            <span className="brand__subtitle">Ports running on your Mac</span>
          </div>
        </div>

        <div className="search">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search by port, process, or project…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="search__clear"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <XIcon />
            </button>
          )}
        </div>

        {folders.length > 0 && (
          <label className="folder" title="Filter by project folder">
            <FolderIcon />
            <select
              value={folder ?? ""}
              onChange={(e) => setFolder(e.target.value || null)}
            >
              <option value="">All folders ({ports.length})</option>
              {folders.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label} ({f.count})
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="controls">
          <Toggle
            label="Auto"
            hint="Refresh automatically every few seconds"
            checked={autoRefresh}
            onChange={setAutoRefresh}
          />
          <Toggle
            label="Force"
            hint="Use SIGKILL (-9) instead of a graceful stop"
            danger
            checked={force}
            onChange={setForce}
          />
          <button
            className="btn btn--icon"
            onClick={() => void refresh()}
            disabled={loading}
            title="Refresh now"
          >
            <RefreshIcon spinning={loading} />
          </button>
        </div>
      </header>

      {error && (
        <div className="alert alert--error">
          <span>{error}</span>
        </div>
      )}

      <section className="list-wrap">
        {filtered.length > 0 ? (
          <table className="ports">
            <thead>
              <tr>
                <th className="col-check">
                  <Checkbox
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    ariaLabel="Select all visible"
                  />
                </th>
                <th className="col-port">Port</th>
                <th>Project</th>
                <th>Process</th>
                <th className="col-pid">PID</th>
                <th className="col-command">Command</th>
                <th className="col-action" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isSelected = selected.has(p.port);
                return (
                  <tr
                    key={`${p.pid}-${p.port}`}
                    className={isSelected ? "is-selected" : undefined}
                    onClick={() => toggle(p.port)}
                  >
                    <td
                      className="col-check"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isSelected}
                        onChange={() => toggle(p.port)}
                        ariaLabel={`Select port ${p.port}`}
                      />
                    </td>
                    <td className="col-port">
                      <span className="port-badge">{p.port}</span>
                      <span className="addr">{p.address}</span>
                    </td>
                    <td>
                      {p.project ? (
                        <span className="project" title={p.project.path}>
                          <span
                            className={`dot dot--${p.project.kind}`}
                            aria-hidden
                          />
                          <span className="project__name">
                            {p.project.name}
                          </span>
                          <span
                            className={`kind kind--${p.project.kind}`}
                          >
                            {PROJECT_KIND_LABEL[p.project.kind]}
                          </span>
                        </span>
                      ) : (
                        <span className="muted" title={p.cwd ?? ""}>
                          {p.cwd ? shortenPath(p.cwd) : "System"}
                        </span>
                      )}
                    </td>
                    <td className="process">{p.process_name}</td>
                    <td className="col-pid">{p.pid}</td>
                    <td className="col-command command" title={p.command ?? ""}>
                      {p.command ?? "—"}
                    </td>
                    <td
                      className="col-action"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="btn btn--kill"
                        disabled={busy}
                        onClick={() => void handleKillOne(p.pid)}
                        title={force ? "Force kill this process" : "Stop this process"}
                      >
                        <StopIcon />
                        <span>Stop</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState
            loaded={hasLoaded}
            filtered={filtersActive}
            onClear={() => {
              setQuery("");
              setFolder(null);
            }}
          />
        )}
      </section>

      <footer className="statusbar">
        <span>
          {filtered.length === ports.length
            ? `${ports.length} listening port${ports.length === 1 ? "" : "s"}`
            : `${filtered.length} of ${ports.length} ports`}
        </span>
        {autoRefresh && (
          <span className="statusbar__auto">
            <span className="pulse" /> auto-refreshing
          </span>
        )}
        {allVisiblePids.length > 0 && (
          <button
            className="statusbar__killall"
            disabled={busy}
            onClick={() =>
              setPending({ pids: allVisiblePids, scope: "all" })
            }
          >
            Stop all visible
          </button>
        )}
      </footer>

      {/* Contextual bar for the current selection. */}
      {selectedPids.length > 0 && (
        <div className="selbar" role="region" aria-label="Selection actions">
          <span className="selbar__count">
            {selectedPids.length} selected
          </span>
          <button className="btn btn--ghost" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          <button
            className="btn btn--danger"
            disabled={busy}
            onClick={() =>
              setPending({ pids: selectedPids, scope: "selected" })
            }
          >
            <StopIcon />
            {force ? "Force stop" : "Stop"} {selectedPids.length}
          </button>
        </div>
      )}

      {toast && (
        <div className={`toast toast--${toast.kind}`} onClick={() => setToast(null)}>
          {toast.kind === "success" ? <CheckIcon /> : <WarnIcon />}
          <span>{toast.message}</span>
        </div>
      )}

      {pending && (
        <ConfirmModal
          count={pending.pids.length}
          force={force}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirmPending()}
        />
      )}
    </main>
  );
}

/* ---------- small presentational components ---------- */

function Toggle({
  label,
  hint,
  checked,
  onChange,
  danger,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  danger?: boolean;
}) {
  return (
    <label
      className={`toggle${checked ? " is-on" : ""}${danger ? " toggle--danger" : ""}`}
      title={hint}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__label">{label}</span>
    </label>
  );
}

function Checkbox({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <label className="cb">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
      />
      <span className="cb__box">{checked && <CheckIcon />}</span>
    </label>
  );
}

function ConfirmModal({
  count,
  force,
  busy,
  onCancel,
  onConfirm,
}: {
  count: number;
  force: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`modal__icon${force ? " is-force" : ""}`}>
          <StopIcon />
        </div>
        <h2 className="modal__title">
          {force ? "Force stop" : "Stop"} {count} process
          {count === 1 ? "" : "es"}?
        </h2>
        <p className="modal__body">
          {force
            ? "These processes will be killed immediately (SIGKILL) with no chance to shut down cleanly."
            : "A graceful stop signal (SIGTERM) will be sent. Unsaved work in these processes may be lost."}
        </p>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn--danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Stopping…" : force ? "Force stop" : "Stop"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  loaded,
  filtered,
  onClear,
}: {
  loaded: boolean;
  filtered: boolean;
  onClear: () => void;
}) {
  if (!loaded) {
    return <div className="empty">Scanning ports…</div>;
  }
  if (filtered) {
    return (
      <div className="empty">
        <PortIcon />
        <p>No ports match these filters.</p>
        <button className="btn btn--ghost" onClick={onClear}>
          Clear filters
        </button>
      </div>
    );
  }
  return (
    <div className="empty">
      <PortIcon />
      <p>Nothing is listening right now.</p>
      <span className="empty__hint">
        Start a dev server and it will show up here.
      </span>
    </div>
  );
}

/* ---------- inline icons (CSP-safe, no external assets) ---------- */

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={spinning ? "spin" : undefined}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      aria-hidden
    >
      <path
        d="M21 12a9 9 0 1 1-2.64-6.36M21 4v4h-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
      <path d="M5 12l5 5 9-11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path d="M12 3 1.5 21h21L12 3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 10v4M12 17.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden>
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PortIcon() {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" aria-hidden>
      <rect x="3" y="8" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 8V6a5 5 0 0 1 10 0v2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="14" r="1.6" fill="currentColor" />
    </svg>
  );
}

/** Root folder a port belongs to: its project root, else its cwd. */
function folderKeyOf(p: PortEntry): string | null {
  return p.project?.path ?? p.cwd ?? null;
}

/** Collapse a long absolute path to `…/parent/dir` for compact display. */
function shortenPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return "…/" + parts.slice(-2).join("/");
}

export default App;
