import type { PortEntry } from "../types";
import { Checkbox } from "./Checkbox";
import { PortRow } from "./PortRow";

export function PortsTable({
  entries,
  selected,
  allSelected,
  busy,
  force,
  onToggle,
  onToggleAll,
  onKill,
}: {
  entries: PortEntry[];
  selected: Set<number>;
  allSelected: boolean;
  busy: boolean;
  force: boolean;
  onToggle: (port: number) => void;
  onToggleAll: () => void;
  onKill: (pid: number) => void;
}) {
  return (
    <table className="ports">
      <thead>
        <tr>
          <th className="col-check">
            <Checkbox
              checked={allSelected}
              onChange={onToggleAll}
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
        {entries.map((entry) => (
          <PortRow
            key={`${entry.pid}-${entry.port}`}
            entry={entry}
            selected={selected.has(entry.port)}
            busy={busy}
            force={force}
            onToggle={onToggle}
            onKill={onKill}
          />
        ))}
      </tbody>
    </table>
  );
}
