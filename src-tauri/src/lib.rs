mod ports;

use ports::{KillResult, PortEntry};

/// List every TCP port in the LISTEN state, enriched with process and project info.
#[tauri::command]
fn list_ports() -> Result<Vec<PortEntry>, String> {
    ports::list_ports()
}

/// Terminate a single process. `force` escalates from SIGTERM to SIGKILL.
#[tauri::command]
fn kill_process(pid: u32, force: bool) -> KillResult {
    ports::kill_process(pid, force)
}

/// Terminate multiple processes in one call, returning a per-pid result.
#[tauri::command]
fn kill_processes(pids: Vec<u32>, force: bool) -> Vec<KillResult> {
    ports::kill_processes(&pids, force)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_ports,
            kill_process,
            kill_processes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
