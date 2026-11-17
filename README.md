# Herdr Approvals

A native permission panel for Herdr. Cockpit is optional.

![Requests and settings with a fictional command](preview.png)

You can reply to a Codex permission request or enable automatic approval.
Automatic approval is off by default.

## Settings

| Setting | Behavior |
| --- | --- |
| Auto-approve | Sends the automatic reply after the delay. |
| Delay | Select 3, 5, or 10 seconds. For a custom delay, enter 1–3,600 whole seconds. Then select Apply. |
| Agents | Includes all supported local Codex agents, or only selected agents. |
| Automatic reply | Allows one command, or saves a command rule that Codex offers. |
| Connection | Uses Herdr directly, or an existing local Cockpit installation. |

**All agents** includes new local Codex agents in Herdr.
**Selected agents** lets you select those agents before a request arrives.
Selection applies to the current terminal process. A new process requires a new selection.
See the [agent picker](agents-preview.png).

**Allow once** permits the current command.
**Save command rule** selects a command rule that Codex offers.
If no supported rule exists, automatic approval selects **Allow once**.
Automatic approval excludes recognized all-command and bypass options.
In **Save command rule** mode, multiple rule choices require a manual reply.

## Reply

Select a numbered reply. Then press Enter or select **Send reply**.
Selection stops automatic approval for that request.
In a popup, Esc closes the window.
In the full panel, Esc stops all current automatic requests. Cancellation sends no rejection.
**Open agent** shows the terminal.
Other mods can open a tab with `approvals.settings` or `approvals.requests`. These commands send no reply.

## Requirements

The mod requires these components:

- Herdr desktop with native JavaScript mods and herdr-core 0.1.21 or a compatible version
- macOS or Linux with `hc` and `/bin/sh` available to Herdr
- A local Codex agent with the supported English permission menu.

Claude, remote agents, authentication prompts, text questions, and checkbox forms do not accept input through this version.
Node and Python are development tools. The mod requires neither at runtime.
Validation used macOS. Linux is not yet validated.

## Install

Copy `mods/approvals/` to `~/.config/herdr-app/mods/approvals/`.
Alternatively, install the mod with Python 3:

```sh
python3 tools/install.py
herdr-app check ~/.config/herdr-app/mods/approvals
```

The panel opens on the right. The installer preserves Cockpit, key bindings, and existing settings.
If the folder exists, add `--update`.
Updates save the previous mod in `~/.local/share/herdr-approvals/backups/`.

For manual placement, set `place` to `none` in `mod.json` before installation.
Then add a layout block with `content: {mod: "approvals"}`.
If you use `keys.json`, examine the existing bindings before you copy the entries.

For a compact widget, add this block to a personal layout:

```json
{"id":"approval-widget","type":"block","size":{"px":40},"content":{"mod":"approvals","props":{"compact":true,"panelId":"approval-widget"}}}
```

The strip stays 40px high in all states. **Settings** opens a popup.
Select the request count to read the command and replies.
This action stops automatic approval for that request. Closing details does not restart that request.
Closing settings preserves the automatic timer.
Popups open at up to 480×720px. Smaller windows limit their initial size. Long content scrolls inside the popup.

Each agent has its own countdown. Requests found together count down together.
When countdowns end, the mod sends replies one at a time. Each request uses its original deadline.
Review or cancellation for one request leaves the other countdowns running.
The global cancel command stops all current automatic requests.
Changing the delay starts fresh countdowns with the new duration.

## Cockpit and delivery

Herdr is the default connection.
When no request is pending, you can change the connection.
If a connection fails, the mod does not switch senders.

If Cockpit already approves these agents, disable its automatic sender before you enable this mod.
The installer preserves that sender.

The countdown ends at dispatch. Herdr core can delay delivery.
After dispatch starts, cancellation is no longer possible. External input can still change the prompt before delivery.
If delivery is uncertain, the mod stops input to that terminal process.

Panel copies in the same Herdr home share settings. Copies on the same core share input records.
The records contain no command or question text.
See [design](docs/design.md) for delivery and recovery details.

## Development

The tests require Node 24 and no npm dependencies. The native tools require Python 3.

```sh
npm test
npm run check:package
python3 tools/native-check.py
python3 tools/core-spike.py
python3 tools/preview.py
```

During the native check, the mod sends no input and starts no helper process. It makes no persistent changes.
The core test and preview use separate environments.
See [validation](docs/validation.md) for coverage and limits.

## Gallery and license

Gallery indexing requires a public repository with the `herdr-mod` topic. Publication is a separate step.

Apache-2.0 permits use, modification, and distribution under its terms.
The parser retains attribution to Cockpit and herdr-relevo.
See [LICENSE](LICENSE), [NOTICE](NOTICE), and [LICENSES](LICENSES/).
