# Additional reliability review

Review date: 2026-11-17.

## Uncertain delivery

The journal prevents duplicate input after uncertain delivery.
The UI previously kept the manual controls available until the next refresh.

The controller locks the matching terminal process as soon as uncertainty is known.
It removes that process from the countdown queue. Other agents continue normally.
A new terminal process at the same address keeps its own state.

Manual shortcuts and old callbacks also examine the current request state before they start work.
An older refresh cannot replace the new locked state.

## Backup errors

An interrupted backup copy previously left a timestamped directory with incomplete files.
The installer prepares the backup in a temporary directory.
The final backup name appears only after the copy completes.
Copy errors preserve the installed mod and earlier complete backups.

## Repeated settings use

A lifecycle test opens, renders, and closes settings 30 times.
It keeps the same controller and countdown. It writes no input records.
Closed popup tokens and Apply actions remain invalid.

## Validation scope

142 Node tests and five isolated installer checks pass.
Ten native UI states and the two-terminal isolated core test also pass.
Regression tests cover unknown delivery, transport errors, lost acknowledgements, competing claims, and process identity.
Installer checks use a temporary home and app directory.
Native UI checks and the isolated core test use separate environments.
The fixtures execute no real Codex commands.
Validation covers macOS. Linux remains unvalidated.

```sh
npm test
npm run check:install
npm run check:package
python3 tools/native-check.py
python3 tools/core-spike.py
```
