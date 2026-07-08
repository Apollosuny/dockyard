// These mirror the serde-serialized structs in src-tauri/src/ports.rs.
// Keep them in sync when the Rust side changes.

export type ProjectKind = "node" | "rust" | "python" | "go" | "git";

export interface ProjectInfo {
  name: string;
  path: string;
  kind: ProjectKind;
}

export interface PortEntry {
  port: number;
  protocol: string;
  address: string;
  pid: number;
  process_name: string;
  command: string | null;
  cwd: string | null;
  project: ProjectInfo | null;
}

export interface KillResult {
  pid: number;
  success: boolean;
  error: string | null;
}
