import type { PortEntry, ProjectKind } from "../types";

export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  node: "Node",
  rust: "Rust",
  python: "Python",
  go: "Go",
  git: "Git",
};

export type FolderOption = {
  key: string;
  label: string;
  kind: ProjectKind | null;
  count: number;
};

/** Root folder a port belongs to: its project root, else its cwd. */
export function folderKeyOf(p: PortEntry): string | null {
  return p.project?.path ?? p.cwd ?? null;
}

/** Collapse a long absolute path to `…/parent/dir` for compact display. */
export function shortenPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return "…/" + parts.slice(-2).join("/");
}

/** Distinct root folders present in the listing, sorted by label, with counts. */
export function computeFolders(ports: PortEntry[]): FolderOption[] {
  const map = new Map<string, FolderOption>();
  for (const p of ports) {
    const key = folderKeyOf(p);
    if (!key) continue;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, {
        key,
        label: p.project?.name ?? shortenPath(key),
        kind: p.project?.kind ?? null,
        count: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Case-insensitive free-text match across a port's searchable fields. */
export function portMatchesQuery(p: PortEntry, query: string): boolean {
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
  return haystack.includes(query);
}
