import type { PortEntry } from "../types";
import { PROJECT_KIND_LABEL, shortenPath } from "../lib/format";
import { Checkbox } from "./Checkbox";
import { StopIcon } from "./icons";

export function PortRow({
  entry: p,
  selected,
  busy,
  force,
  onToggle,
  onKill,
}: {
  entry: PortEntry;
  selected: boolean;
  busy: boolean;
  force: boolean;
  onToggle: (port: number) => void;
  onKill: (pid: number) => void;
}) {
  return (
    <tr
      className={selected ? "is-selected" : undefined}
      onClick={() => onToggle(p.port)}
    >
      <td className="col-check" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onChange={() => onToggle(p.port)}
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
            <span className={`dot dot--${p.project.kind}`} aria-hidden />
            <span className="project__name">{p.project.name}</span>
            <span className={`kind kind--${p.project.kind}`}>
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
      <td className="col-action" onClick={(e) => e.stopPropagation()}>
        <button
          className="btn btn--kill"
          disabled={busy}
          onClick={() => onKill(p.pid)}
          title={force ? "Force kill this process" : "Stop this process"}
        >
          <StopIcon />
          <span>Stop</span>
        </button>
      </td>
    </tr>
  );
}
