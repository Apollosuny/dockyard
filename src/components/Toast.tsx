import type { KillResult } from "../types";
import { CheckIcon, WarnIcon } from "./icons";

export type ToastMessage = { kind: "success" | "error"; message: string };

/** Turn a batch of kill results into a single user-facing toast message. */
export function summarizeKills(results: KillResult[]): ToastMessage {
  const failed = results.filter((r) => !r.success);
  if (failed.length === 0) {
    const n = results.length;
    return {
      kind: "success",
      message: `Stopped ${n} process${n === 1 ? "" : "es"}.`,
    };
  }
  const detail = failed
    .map((r) => `PID ${r.pid}: ${r.error ?? "unknown error"}`)
    .join(" · ");
  return {
    kind: "error",
    message: `${results.length - failed.length} stopped, ${failed.length} failed — ${detail}`,
  };
}

export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: () => void;
}) {
  return (
    <div className={`toast toast--${toast.kind}`} onClick={onDismiss}>
      {toast.kind === "success" ? <CheckIcon /> : <WarnIcon />}
      <span>{toast.message}</span>
    </div>
  );
}
