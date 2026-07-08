# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Dockyard is a **macOS-only** Tauri 2 desktop app for managing local machine state.
The first (and currently only) module is a **port manager**: list listening TCP
ports, attribute each to a project, and kill processes. It is deliberately built
so additional "management" modules can be added alongside ports.

## Commands

All commands run from the repo root. The frontend package manager is **pnpm**.

```bash
pnpm install              # install frontend deps
pnpm tauri dev            # run the full desktop app (Vite + Rust, hot reload)
pnpm dev                  # frontend only, in a browser (Rust `invoke` calls will fail)
pnpm build                # tsc typecheck + vite production build of the frontend
pnpm tauri build          # produce a distributable macOS app bundle
```

Rust backend (run from `src-tauri/`):

```bash
cargo check               # fast type-check
cargo test                # unit tests + a real end-to-end `list_ports()` smoke test
cargo test parses_common_address_forms   # run a single test by name
cargo clippy              # lint
```

There is no combined "lint everything" script; run `pnpm build` (typecheck) and
`cargo clippy` separately.

## Toolchain constraint

`rust-toolchain.toml` pins this project to **stable** Rust on purpose. The
machine's global default is an older toolchain (kept for other projects), but
Tauri 2's dependency tree needs an edition2024-capable compiler (≈1.85+). Do not
remove this pin; if a build fails with `feature edition2024 is required`, the
stable toolchain needs `rustup update stable`.

## Architecture

Two layers talk over Tauri's `invoke` IPC bridge. The contract is a small set of
commands and plain serde/JSON structs — keep both sides in sync when it changes.

### Rust backend (`src-tauri/src/`)

- `lib.rs` — the Tauri app entry (`run()`) and the `#[tauri::command]` handlers
  registered in `generate_handler!`. Handlers are thin; they delegate to `ports`.
  Custom commands do **not** need capability entries in `capabilities/default.json`
  (that file only gates core/plugin APIs).
- `ports.rs` — all port/process logic. It **shells out to system tools** rather
  than using native crates, because those tools already have the needed kernel
  access and privileges:
  - `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` enumerates listening sockets (parsed from
    lsof's `-F` field format: `p`=pid, `c`=command, `n`=addr:port).
  - `lsof -a -d cwd -Fn -p <pids>` (one batched call) resolves each process's cwd.
  - `ps -ax -o pid=,command=` (one call) provides full command lines.
  - **Project detection** walks up from a process's cwd to the nearest marker
    (`package.json` → Node, `Cargo.toml` → Rust, `pyproject.toml`/`requirements.txt`/
    `setup.py` → Python, `go.mod` → Go, `.git` → Git), reading the name from the
    manifest where possible. No match → `project: null` (e.g. system daemons whose
    cwd is `/`).
  - Killing sends SIGTERM (`kill -15`) or SIGKILL (`kill -9`) when `force` is set.

  Everything is **best-effort**: a process that can't be inspected degrades to
  fewer fields instead of failing the whole listing, and results dedupe on
  `(pid, port)` so IPv4+IPv6 on the same port collapse to one row.

### Frontend (`src/`)

- `types.ts` — TypeScript mirrors of the Rust serde structs (`PortEntry`,
  `ProjectInfo`, `KillResult`, `ProjectKind`). **This is the IPC contract** —
  update it whenever `ports.rs` structs change. Note serde renames enum variants
  to lowercase (`ProjectKind` → `"node"`, `"rust"`, …).
- `api.ts` — the only place that calls `invoke`. Typed wrappers: `listPorts`,
  `killProcess`, `killProcesses`. Add new backend calls here, not inline in
  components.
- `App.tsx` — the entire UI (single component): the port table, filtering,
  multi-select, and kill actions. Selection is keyed by **port** (stable to a
  user) but kill operates on **PID** (resolved at action time), so a stale
  selection can't target a recycled PID.

## Conventions

- The Rust ↔ TS boundary is hand-mirrored, not codegen'd. Any change to a
  command signature or a serialized struct must be applied in both `ports.rs`/
  `lib.rs` and `types.ts`/`api.ts`.
- New IPC commands: implement in `ports.rs` (or a new sibling module), register
  in `lib.rs`'s `generate_handler!`, then expose a typed wrapper in `api.ts`.
- Adding a new management module (beyond ports): create a sibling Rust module
  next to `ports.rs`, keep its command handlers thin in `lib.rs`, and give it its
  own TS types/api files following the same pattern.
