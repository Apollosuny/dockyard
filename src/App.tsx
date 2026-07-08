import { useEffect, useMemo, useState } from "react";
import { computeFolders, folderKeyOf, portMatchesQuery } from "./lib/format";
import { usePorts } from "./hooks/usePorts";
import { Brand } from "./components/Brand";
import { SearchBox } from "./components/SearchBox";
import { FolderFilter } from "./components/FolderFilter";
import { Toggle } from "./components/Toggle";
import { PortsTable } from "./components/PortsTable";
import { EmptyState } from "./components/EmptyState";
import { StatusBar } from "./components/StatusBar";
import { SelectionBar } from "./components/SelectionBar";
import { Toast, summarizeKills, type ToastMessage } from "./components/Toast";
import { ConfirmModal } from "./components/ConfirmModal";
import { RefreshIcon } from "./components/icons";
import "./App.css";

const TOAST_MS = 4000;

function App() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // PIDs awaiting confirmation in the modal (null = no modal open).
  const [pending, setPending] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);

  const { ports, loading, hasLoaded, error, refresh, killPids } =
    usePorts(autoRefresh);

  // Drop selections whose ports are no longer listening.
  useEffect(() => {
    const live = new Set(ports.map((p) => p.port));
    setSelected((prev) => {
      const next = new Set([...prev].filter((port) => live.has(port)));
      return next.size === prev.size ? prev : next;
    });
  }, [ports]);

  const folders = useMemo(() => computeFolders(ports), [ports]);

  // Drop a folder selection that no longer maps to any listening port.
  useEffect(() => {
    if (folder && !folders.some((f) => f.key === folder)) setFolder(null);
  }, [folders, folder]);

  // Success toasts auto-dismiss; errors stay until the next action.
  useEffect(() => {
    if (toast?.kind !== "success") return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const filtersActive = query.trim() !== "" || folder !== null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ports.filter((p) => {
      if (folder && folderKeyOf(p) !== folder) return false;
      if (!q) return true;
      return portMatchesQuery(p, q);
    });
  }, [ports, query, folder]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.port));

  // Selection is keyed by port (stable to a user), but kills operate on the
  // PID resolved at action time, so a stale selection can't hit a recycled PID.
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

  // Per-row kills are explicit and fast, so they run immediately.
  async function handleKillOne(pid: number) {
    setBusy(true);
    try {
      setToast(summarizeKills(await killPids([pid], force)));
    } finally {
      setBusy(false);
    }
  }

  // Bulk kills (selection / all visible) go through the confirmation modal.
  async function confirmPending() {
    if (!pending) return;
    setBusy(true);
    try {
      setToast(summarizeKills(await killPids(pending, force)));
      setSelected(new Set());
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <Brand />
        <SearchBox value={query} onChange={setQuery} />
        {folders.length > 0 && (
          <FolderFilter
            folders={folders}
            value={folder}
            total={ports.length}
            onChange={setFolder}
          />
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
          <PortsTable
            entries={filtered}
            selected={selected}
            allSelected={allVisibleSelected}
            busy={busy}
            force={force}
            onToggle={toggle}
            onToggleAll={toggleAllVisible}
            onKill={handleKillOne}
          />
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

      <StatusBar
        total={ports.length}
        shown={filtered.length}
        autoRefresh={autoRefresh}
        killAllCount={allVisiblePids.length}
        busy={busy}
        onStopAll={() => setPending(allVisiblePids)}
      />

      {selectedPids.length > 0 && (
        <SelectionBar
          count={selectedPids.length}
          force={force}
          busy={busy}
          onClear={() => setSelected(new Set())}
          onStop={() => setPending(selectedPids)}
        />
      )}

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}

      {pending && (
        <ConfirmModal
          count={pending.length}
          force={force}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirmPending()}
        />
      )}
    </main>
  );
}

export default App;
