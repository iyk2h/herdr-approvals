# Five review passes

Review date: 2026-11-17.

| Pass | Finding | Improvement | Evidence |
| --- | --- | --- | --- |
| 1. Installation | Updates retained obsolete files and left a partial copy after a copy error. | Prepare the full update, save the previous version, and replace the installed directory. | Four isolated installer checks cover fresh installation, overwrite protection, backups, removal, and copy errors. |
| 2. Cancellation | A policy change cleared countdowns before the next refresh. Global cancellation then missed visible requests. | Save cancellations for visible requests as well as queued and active requests. | Six regressions cover delay and mode changes, cancellation, disable, close, and reload. |
| 3. Settings | An untouched field kept an old delay. Immediate Apply replaced a newer saved value. | Synchronize untouched fields. Preserve unsaved text. Read the saved delay before Apply. | Owner and popup regressions cover external changes, invalid text, immediate Apply, and closed input state. |
| 4. Request notices | One agent showed another agent's reply result. | Match notices to the agent, episode, and command. Keep compact status text inside its button. | Controller and UI regressions cover matching and stale identities, global errors, and continuing countdowns. |
| 5. Release checks | CI omitted installer checks. The package declared a different Node requirement from the documented environment. | Add the installer checks to CI. Use Node 24 consistently. Update the release text. | The unit, installer, package, native UI, and isolated core checks pass. |

## Validation

- 133 Node tests pass.
- Four isolated installer checks pass.
- Ten native UI states pass.
- Two fictional terminals receive one reply each after the same custom seven-second countdown.
- The package structure and source attribution checks pass.

The installer checks use a temporary app home and home directory.
The core check uses a separate session. It stops only that session.
The fixtures execute no real Codex commands.
Validation covers macOS. Linux remains unvalidated.
An independent review also injected a replacement error after the old directory moved aside.
The installer restored the original files and removed the temporary files.

## Reproduce

```sh
npm test
npm run check:install
npm run check:package
python3 tools/native-check.py
python3 tools/core-spike.py
```
