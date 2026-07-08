import { StopIcon } from "./icons";

export function ConfirmModal({
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
