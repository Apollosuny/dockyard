import type { FolderOption } from "../lib/format";
import { FolderIcon } from "./icons";

export function FolderFilter({
  folders,
  value,
  total,
  onChange,
}: {
  folders: FolderOption[];
  value: string | null;
  total: number;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="folder" title="Filter by project folder">
      <FolderIcon />
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">All folders ({total})</option>
        {folders.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label} ({f.count})
          </option>
        ))}
      </select>
    </label>
  );
}
