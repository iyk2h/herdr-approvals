# Herdr Approval

A native permission panel for Herdr. Cockpit is optional.

![Compact Approval strip with its settings popup in a demo layout](preview.png)

By default, the mod opens in a 360px right panel. It uses the active Herdr theme.
**Requests** shows the requested action, numbered replies, and an automatic approval countdown.
**Settings** controls automatic approval, delay, agents, the automatic reply, and the connection.

You can add a 40px strip through a personal layout. Its height stays fixed.
Settings and request details open in popups, at up to 480px wide.
An empty request popup fits its content. Requests use up to 620px in height. Settings use up to 720px.
Smaller windows limit the height. Long content scrolls inside the popup.

## Reply

Select a reply. Then press Enter.
In a popup, Esc closes the window.
In the full panel, Esc stops all current automatic requests.
Selection stops that request's countdown. Other agents continue counting down.
Cancellation does not reject the request. The global cancel command stops all current countdowns.

## Automatic approval

Automatic approval is off by default.
You can include all supported local Codex agents or select agents before a request arrives.
The **All agents** setting includes new local Codex agents in Herdr.
A selection applies to the current terminal process. A new process requires a new selection.

The mod supports local Codex command and terminal input permission menus in English.
Terminal input approvals use the current delay and always allow once.
The target, environment, reason, quoted input, and confirmation menu must be complete.
Wrapped input remains manual.
**Allow once** permits one request. **Save command rule** selects a command rule that Codex offers.
If no supported rule exists, automatic approval selects **Allow once**.
Automatic approval excludes recognized all-command and bypass options.
In **Save command rule** mode, multiple rule choices require a manual reply.

## Connection

The default connection uses Herdr directly. The optional Cockpit connection uses an existing local installation.
Both connections share the same input records. The mod does not switch senders after a failed connection.

If Cockpit already approves these agents, disable its automatic sender before you enable this mod.
The installer preserves that sender and its settings.

## Built from

Native GPUI JavaScript builds the controls.
`mods/approvals/main.js` owns the controller. `ui.js` builds the strip, panel, and popup.
The parser reads the supported Codex menu. The providers identify local terminal processes and read each request again before input.

The mod starts `hc` and `/bin/sh`. The optional connection starts the existing local Cockpit executable.
The core document saves input and cancellation records. These records contain request digests.
Node and Python support development and installation. The mod requires neither at runtime.

## Limits

The countdown ends at dispatch. Core can delay delivery. After dispatch, cancellation is no longer possible.
If delivery is uncertain, the mod stops input to that terminal process.
Remote agents and other permission formats do not accept input through this version.

See [README](README.md) for installation and [validation](docs/validation.md) for test coverage.
