# Remote Harnesses over SSH

Use Harnesses that are installed and signed in only on a remote machine — Claude Code included — from your local Codex Desktop, through its native SSH workspace. Your credentials stay on the remote machine and are never sent over SSH.

## Prerequisites

- **Local machine** (macOS, Linux, or Windows): Codex Desktop and codexhost are installed.
- **Remote machine** (macOS or x64/ARM64 Linux; Windows isn't supported yet): Codex CLI is installed, along with **the same codexhost version** as your local machine.
- The Harness you want to use is installed and signed in on the remote machine.
- Codex Desktop's native SSH workspace already works (**Settings → Connections → SSH**).

## Install

On the remote machine, run:

```bash
npm install -g @chinhae/codex-connect
codex-connect remote install
codex-connect remote start
codex-connect remote status
```

`remote install` adds a clearly marked block to your shell profile that only applies to SSH sessions, and backs up the profile first. Your local shells and existing `codex` command are left alone. On macOS, it also installs a per-user LaunchAgent that starts Claude Code in your logged-in session. It never reads the Keychain or any credentials.

## Usage

1. On your local machine, launch Codex Desktop through codexhost.
2. Open the SSH workspace.
3. Pick a Harness from the composer's Agent / Model selector.

## Commands

```bash
codex-connect remote status     # Check whether it is running and installed correctly
codex-connect remote start      # Start it (safe to run more than once)
codex-connect remote stop       # Stop it without touching other Codex processes
codex-connect remote uninstall  # Uninstall it but keep your Thread mapping data
```

After you start, stop, or uninstall, reconnect the SSH workspace in Codex Desktop.

## Upgrade

Upgrade both machines to the same version using the same package manager. Then rerun `codex-connect remote install` and `codex-connect remote start` on the remote machine and reconnect the SSH workspace.

## Troubleshooting

- **`codexhost/harness/inspect is unsupported on this Host connection`**: the SSH connection isn't going through codexhost. Make sure the same codexhost version is installed and running on the remote machine, then reconnect the SSH workspace.
- **`remote status` says degraded or asks you to reinstall**: run `codex-connect remote install`, then `codex-connect remote start`.
- **A Harness is missing**: make sure it is installed and signed in on the remote machine, then click **Run connection diagnostics** in Settings.
- **Install fails on macOS with a launchd / `gui/$UID` error**: the remote Mac needs someone logged in to the desktop. Log in, then run `codex-connect remote install` again.
