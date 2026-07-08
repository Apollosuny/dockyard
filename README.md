# Dockyard

A macOS desktop app for managing things on your machine. The first module is a
**port manager**: see which TCP ports are listening, which project each belongs
to, and kill one, several, or all of them.

Built with **Tauri 2 + Rust + React/TypeScript**.

## Features (current)

- List every listening TCP port with its owning process (PID + name).
- Map each port to its project by walking up the process's working directory to
  the nearest `package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` / `.git`.
- Full command line per process.
- Filter by port, PID, process, project, or path.
- Kill a single process, the current selection, or all visible — with an
  optional Force (SIGKILL) mode. Failures (e.g. permission denied) are reported
  per PID.
- Auto-refresh.

## Development

Requires Node + pnpm and a recent stable Rust toolchain (pinned via
`rust-toolchain.toml`). See `CLAUDE.md` for architecture and commands.

```bash
pnpm install
pnpm tauri dev      # run the desktop app
```

## Platform

macOS only. Port discovery shells out to `lsof` and `ps`, which are macOS/BSD
flavored; other platforms are not yet supported.
