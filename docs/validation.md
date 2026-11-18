# Tests and validation

Native trials use macOS, Herdr app 0.1.16, and herdr-core 0.1.21. CI runs the Node and Python checks on Linux. Prompts and commands in fixtures are fictional; they do not execute real Codex commands.

| Check | Coverage |
| --- | --- |
| `npm test` | Prompt parsing, request identity, cursor movement, individual timers, cancellation, durable claims, popup ownership, and update state |
| `npm run check:install` | Fresh installs, backups, obsolete files, interrupted copies, and existing user settings |
| `npm run check:updates` | Archive paths, checksums, version matching, rollback, locks, install receipts, and reproducible release packages |
| `npm run check:package` | Required files, source attribution, credentials, and runtime dependencies |
| `python3 tools/native-check.py` | Native full-panel, compact-bar, settings, request, error, and update views |
| `python3 tools/core-spike.py` | Actual input delivery to two fictional terminals in a separate core |
| `python3 tools/update-smoke.py` | Actual file replacement and source reload in a separate Herdr app |

## Native trials

On 2026-11-17, the native and Cockpit connections each delivered one allow-once reply after a three-second delay. Cancellation trials waited through the full ten-second delay and received no input. A separate core trial gave two fictional terminals the same seven-second deadline; each received one reply.

Popup trials checked repeated opening and closing, parent-folder rescans, request changes, and source reloads. Geometry checks used large and small windows and 150% zoom. Closing settings kept the controller and its deadline; stale popup actions could not send input.

On 2026-11-18, a native self-update installed a local fixture release through the actual update action. The app process stayed open. The new owner showed the completion popup after source reload. Settings, personal placement, and the 40px bar survived; the previous mod was backed up and obsolete files were removed. Herdr reported no errors.

## Limits

Native UI trials cover macOS. Linux native UI remains untested. The fixtures cover recognized English Codex menus, not every Codex version or prompt format. Core can delay key delivery, and external input can change a prompt after the final check.

The core and update tools use separate sessions and app homes and stop only their own processes. Preview tools disable input and host IO.

```sh
python3 tools/preview.py
python3 tools/preview.py --view updates
python3 tools/popup-smoke.py
```
