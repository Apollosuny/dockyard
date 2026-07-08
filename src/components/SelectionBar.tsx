import { StopIcon } from "./icons";

export function SelectionBar({
  count,
  force,
  busy,
  onClear,
  onStop,
}: {
  count: number;
  force: boolean;
  busy: boolean;
  onClear: () => void;
  onStop: () => void;
}) {
  return (
    <div className="selbar" role="region" aria-label="Selection actions">
      <span className="selbar__count">{count} selected</span>
      <button className="btn btn--ghost" onClick={onClear}>
        Clear
      </button>
      <button className="btn btn--danger" disabled={busy} onClick={onStop}>
        <StopIcon />
        {force ? "Force stop" : "Stop"} {count}
      </button>
    </div>
  );
}
