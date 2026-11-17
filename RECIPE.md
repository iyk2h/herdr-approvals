# Herdr Approvals

A native permission panel for Herdr. Cockpit is optional.

![Requests and settings](preview.png)

The panel fits in a 360px sidebar and uses the active Herdr theme.
**Requests** shows the command, numbered replies, and an automatic approval countdown.
**Settings** controls automatic approval, delay, agents, the automatic reply, and the connection.

A 40px strip fits above a usage panel. Its height stays fixed.
Settings and request details open in popups. The strip remains the only input controller.

## Reply

Select a reply. Then press Enter.
Press Esc to cancel automatic approval for the current request.
Selection stops the countdown. Cancellation does not reject the command.

## Automatic approval

Automatic approval is off by default.
You can include all supported local Codex agents or select agents before a request arrives.
The **All agents** setting includes new local Codex agents in Herdr.
A selection applies to the current terminal process. A new process requires a new selection.

The mod supports local Codex permission menus in English.
**Allow once** permits one command. **Save command rule** saves a narrow rule that Codex offers.
If no rule is present, the mod permits the command once.
Ambiguous rules require a manual reply.

## Connection

The default connection uses Herdr directly. The optional Cockpit connection uses an existing local installation.
Both connections share the same input records. The mod does not switch senders after a failed connection.

If Cockpit already approves these agents, disable its automatic sender before you enable this mod.
The installer preserves that sender and its settings.

## Limits

The countdown ends at dispatch. Core can delay delivery. After dispatch, cancellation is no longer possible.
If delivery is uncertain, the mod stops input to that terminal process.
Remote agents and other permission formats do not accept input through this version.

See [README](README.md) for installation and [validation](docs/validation.md) for test coverage.
