//! Port & process discovery for macOS.
//!
//! Strategy: shell out to the system tools that already have the privileges and
//! kernel access we need, then enrich the result in Rust.
//!   - `lsof` enumerates listening TCP sockets and each owning process.
//!   - `lsof -d cwd` resolves each process's working directory.
//!   - `ps` provides the full command line.
//!   - Project detection walks up from the cwd looking for well-known markers.
//!
//! Everything is best-effort: a process we cannot inspect (permissions, races)
//! degrades to fewer fields rather than failing the whole listing.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde::Serialize;

/// The kind of project a listening process belongs to, inferred from the
/// nearest ancestor directory that carries a recognizable marker file.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectKind {
    Node,
    Rust,
    Python,
    Go,
    Git,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectInfo {
    /// Human-friendly project name (from the marker file or the directory name).
    pub name: String,
    /// Absolute path of the detected project root.
    pub path: String,
    pub kind: ProjectKind,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortEntry {
    pub port: u16,
    pub protocol: String,
    /// Bind address as reported by lsof, e.g. `*`, `127.0.0.1`, `[::1]`.
    pub address: String,
    pub pid: u32,
    /// Short process name from lsof (may be truncated by the OS).
    pub process_name: String,
    /// Full command line from ps, when available.
    pub command: Option<String>,
    /// Working directory of the owning process, when resolvable.
    pub cwd: Option<String>,
    /// Detected project, when the cwd sits inside a recognizable project.
    pub project: Option<ProjectInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct KillResult {
    pub pid: u32,
    pub success: bool,
    pub error: Option<String>,
}

/// One listening socket as parsed from lsof, before enrichment.
struct RawSocket {
    pid: u32,
    process_name: String,
    address: String,
    port: u16,
}

/// List every TCP port currently in the LISTEN state, enriched with the owning
/// process's command line, working directory, and detected project.
pub fn list_ports() -> Result<Vec<PortEntry>, String> {
    let sockets = enumerate_listening_sockets()?;

    // De-duplicate on (pid, port): a process listening on both IPv4 and IPv6
    // shows up twice, and the port is what the user cares about.
    let mut unique: BTreeMap<(u32, u16), RawSocket> = BTreeMap::new();
    for sock in sockets {
        unique.entry((sock.pid, sock.port)).or_insert(sock);
    }

    let pids: Vec<u32> = unique.values().map(|s| s.pid).collect();
    let cwd_by_pid = resolve_cwds(&pids);
    let command_by_pid = resolve_commands();

    let mut entries: Vec<PortEntry> = unique
        .into_values()
        .map(|sock| {
            let cwd = cwd_by_pid.get(&sock.pid).cloned();
            let project = cwd.as_deref().and_then(detect_project);
            PortEntry {
                port: sock.port,
                protocol: "TCP".to_string(),
                address: sock.address,
                pid: sock.pid,
                process_name: sock.process_name,
                command: command_by_pid.get(&sock.pid).cloned(),
                cwd,
                project,
            }
        })
        .collect();

    entries.sort_by_key(|e| e.port);
    Ok(entries)
}

/// Send a termination signal to a single process.
/// `force` uses SIGKILL (-9); otherwise SIGTERM (-15) lets the process clean up.
pub fn kill_process(pid: u32, force: bool) -> KillResult {
    let signal = if force { "-9" } else { "-15" };
    match Command::new("kill").arg(signal).arg(pid.to_string()).output() {
        Ok(output) if output.status.success() => KillResult {
            pid,
            success: true,
            error: None,
        },
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            KillResult {
                pid,
                success: false,
                error: Some(if stderr.is_empty() {
                    format!("kill exited with status {}", output.status)
                } else {
                    stderr
                }),
            }
        }
        Err(err) => KillResult {
            pid,
            success: false,
            error: Some(err.to_string()),
        },
    }
}

pub fn kill_processes(pids: &[u32], force: bool) -> Vec<KillResult> {
    pids.iter().map(|&pid| kill_process(pid, force)).collect()
}

/// Parse `lsof` field output into raw listening sockets.
fn enumerate_listening_sockets() -> Result<Vec<RawSocket>, String> {
    // -nP: no name/port resolution (faster, numeric). -F pcn: machine-readable
    // fields — p=pid, c=command, n=name (addr:port). LISTEN filter server-only.
    let output = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"])
        .output()
        .map_err(|e| format!("failed to run lsof: {e}"))?;

    // lsof exits non-zero when it has partial permission issues but still prints
    // usable data, so we parse stdout regardless of exit code.
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut sockets = Vec::new();
    let mut cur_pid: Option<u32> = None;
    let mut cur_cmd = String::new();

    for line in stdout.lines() {
        // lsof -F emits one field per line, tagged by a leading ASCII char.
        if line.is_empty() {
            continue;
        }
        match line.split_at(1) {
            ("p", rest) => {
                cur_pid = rest.parse().ok();
                cur_cmd.clear();
            }
            ("c", rest) => cur_cmd = rest.to_string(),
            ("n", rest) => {
                if let (Some(pid), Some((address, port))) = (cur_pid, parse_addr_port(rest)) {
                    sockets.push(RawSocket {
                        pid,
                        process_name: cur_cmd.clone(),
                        address,
                        port,
                    });
                }
            }
            _ => {}
        }
    }

    Ok(sockets)
}

/// Split an lsof name field like `127.0.0.1:3000`, `*:8080`, or `[::1]:5432`
/// into (address, port). Returns None for anything without a numeric port.
fn parse_addr_port(name: &str) -> Option<(String, u16)> {
    let (addr, port_str) = name.rsplit_once(':')?;
    let port: u16 = port_str.parse().ok()?;
    Some((addr.to_string(), port))
}

/// Resolve the working directory of each pid via a single batched lsof call.
fn resolve_cwds(pids: &[u32]) -> BTreeMap<u32, String> {
    let mut map = BTreeMap::new();
    if pids.is_empty() {
        return map;
    }

    let pid_arg = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");

    let output = Command::new("lsof")
        .args(["-a", "-d", "cwd", "-Fn", "-p", &pid_arg])
        .output();

    let Ok(output) = output else {
        return map;
    };
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut cur_pid: Option<u32> = None;
    for line in stdout.lines() {
        match line.split_at(1) {
            ("p", rest) => cur_pid = rest.parse().ok(),
            ("n", rest) => {
                if let Some(pid) = cur_pid {
                    map.entry(pid).or_insert_with(|| rest.to_string());
                }
            }
            _ => {}
        }
    }
    map
}

/// Build a pid -> full command line map from a single `ps` call.
fn resolve_commands() -> BTreeMap<u32, String> {
    let mut map = BTreeMap::new();
    let output = Command::new("ps").args(["-ax", "-o", "pid=,command="]).output();
    let Ok(output) = output else {
        return map;
    };
    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines() {
        let trimmed = line.trim_start();
        if let Some((pid_str, command)) = trimmed.split_once(char::is_whitespace) {
            if let Ok(pid) = pid_str.parse::<u32>() {
                map.insert(pid, command.trim().to_string());
            }
        }
    }
    map
}

/// Walk up from `start` looking for the nearest recognizable project marker.
/// Bounded to a sane depth so a pathological cwd can't stall the listing.
fn detect_project(start: &str) -> Option<ProjectInfo> {
    let mut dir: Option<&Path> = Some(Path::new(start));
    let mut depth = 0;

    while let Some(current) = dir {
        if depth > 40 {
            break;
        }
        if let Some(info) = marker_in(current) {
            return Some(info);
        }
        dir = current.parent();
        depth += 1;
    }
    None
}

/// Inspect a single directory for a project marker, most specific first.
fn marker_in(dir: &Path) -> Option<ProjectInfo> {
    let package_json = dir.join("package.json");
    if package_json.is_file() {
        let name = read_json_name(&package_json).unwrap_or_else(|| dir_name(dir));
        return Some(ProjectInfo {
            name,
            path: dir.to_string_lossy().into_owned(),
            kind: ProjectKind::Node,
        });
    }

    let cargo_toml = dir.join("Cargo.toml");
    if cargo_toml.is_file() {
        let name = read_toml_name(&cargo_toml).unwrap_or_else(|| dir_name(dir));
        return Some(ProjectInfo {
            name,
            path: dir.to_string_lossy().into_owned(),
            kind: ProjectKind::Rust,
        });
    }

    if dir.join("pyproject.toml").is_file()
        || dir.join("requirements.txt").is_file()
        || dir.join("setup.py").is_file()
    {
        return Some(ProjectInfo {
            name: dir_name(dir),
            path: dir.to_string_lossy().into_owned(),
            kind: ProjectKind::Python,
        });
    }

    if dir.join("go.mod").is_file() {
        return Some(ProjectInfo {
            name: dir_name(dir),
            path: dir.to_string_lossy().into_owned(),
            kind: ProjectKind::Go,
        });
    }

    // A bare git repo is still a useful project boundary, but it's the weakest
    // signal, so it comes last.
    if dir.join(".git").exists() {
        return Some(ProjectInfo {
            name: dir_name(dir),
            path: dir.to_string_lossy().into_owned(),
            kind: ProjectKind::Git,
        });
    }

    None
}

fn dir_name(dir: &Path) -> String {
    dir.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| dir.to_string_lossy().into_owned())
}

/// Extract the `name` field from a package.json without a full schema.
fn read_json_name(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    value
        .get("name")?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Extract `name = "..."` from the `[package]` section of a Cargo.toml.
/// Deliberately naive to avoid a toml dependency for a single field.
fn read_toml_name(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut in_package = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_package = trimmed == "[package]";
            continue;
        }
        if in_package {
            if let Some(rest) = trimmed.strip_prefix("name") {
                if let Some((_, value)) = rest.split_once('=') {
                    let name = value.trim().trim_matches('"').trim();
                    if !name.is_empty() {
                        return Some(name.to_string());
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_address_forms() {
        assert_eq!(parse_addr_port("*:3000"), Some(("*".into(), 3000)));
        assert_eq!(
            parse_addr_port("127.0.0.1:8080"),
            Some(("127.0.0.1".into(), 8080))
        );
        assert_eq!(parse_addr_port("[::1]:5432"), Some(("[::1]".into(), 5432)));
        assert_eq!(parse_addr_port("[::]:443"), Some(("[::]".into(), 443)));
    }

    #[test]
    fn rejects_non_numeric_ports() {
        assert_eq!(parse_addr_port("*:*"), None);
        assert_eq!(parse_addr_port("no-colon"), None);
    }

    #[test]
    fn reads_own_cargo_name() {
        // This crate's own manifest is a stable fixture.
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
        assert_eq!(read_toml_name(&manifest).as_deref(), Some("dockyard"));
    }

    /// End-to-end smoke test: exercises lsof + ps + project detection against
    /// the real machine. Asserts the pipeline runs; the port set is non-fixed.
    #[test]
    fn list_ports_runs_end_to_end() {
        let entries = list_ports().expect("list_ports should succeed");
        for e in &entries {
            assert!(e.port > 0);
            assert_eq!(e.protocol, "TCP");
        }
    }
}
