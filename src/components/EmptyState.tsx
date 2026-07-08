import { PortIcon } from "./icons";

export function EmptyState({
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
