export function StatusBar({
  total,
  shown,
  autoRefresh,
  killAllCount,
  busy,
  onStopAll,
}: {
  total: number;
  shown: number;
  autoRefresh: boolean;
  killAllCount: number;
  busy: boolean;
  onStopAll: () => void;
}) {
  return (
    <footer className="statusbar">
      <span>
        {shown === total
          ? `${total} listening port${total === 1 ? "" : "s"}`
          : `${shown} of ${total} ports`}
      </span>
      {autoRefresh && (
        <span className="statusbar__auto">
          <span className="pulse" /> auto-refreshing
        </span>
      )}
      {killAllCount > 0 && (
        <button
          className="statusbar__killall"
          disabled={busy}
          onClick={onStopAll}
        >
          Stop all visible
        </button>
      )}
    </footer>
  );
}
