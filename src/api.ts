import { invoke } from "@tauri-apps/api/core";
import type { KillResult, PortEntry } from "./types";

/** Thin typed wrappers over the Rust commands registered in src-tauri/src/lib.rs. */

export function listPorts(): Promise<PortEntry[]> {
  return invoke<PortEntry[]>("list_ports");
}

export function killProcess(pid: number, force: boolean): Promise<KillResult> {
  return invoke<KillResult>("kill_process", { pid, force });
}

export function killProcesses(
  pids: number[],
  force: boolean,
): Promise<KillResult[]> {
  return invoke<KillResult[]>("kill_processes", { pids, force });
}
