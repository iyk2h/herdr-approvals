# Herdr Approval

Reply to Codex permission requests in Herdr. Use manual replies or automatic approval with a delay. Each agent has a timer you can cancel. Automatic approval is off by default.

![Compact Approval bar with its settings popup in a demo layout](preview.png)

## Install

Read `~/.config/herdr-app/AGENTS.md` first. Then copy `mods/approvals/` into the Herdr mod folder, or run `python3 tools/install.py`.
If the mod already exists, use **Settings → Updates**. Older versions without update controls need `python3 tools/install.py --update`.

The default panel opens on the right, 360px wide. The optional 40px bar uses a personal layout, with settings and requests in popups.
See the [README](README.md) for the layout block and key bindings.

## Use

Select a numbered reply. Then press Enter or select **Send reply**.
To approve requests automatically, turn on **Auto-approve** in **Settings**. Set a delay from 1 to 3,600 seconds.
Choose all local Codex agents or selected agents. All agents includes new agents; individual selections last for the current terminal process.

**Allow once** approves the current request. **Save command rule** selects a command rule that Codex offers.
Automatic approval falls back to **Allow once** if no supported rule exists. Multiple rule choices require a manual reply.
Automatic replies to terminal input requests always use **Allow once**. The mod skips recognized all-command and bypass options.

Each agent has its own countdown. Replies go out one at a time when their countdowns end.
Opening request details stops that request's countdown. Closing settings leaves countdowns running.
Canceling sends no rejection. Once sending starts, you cannot cancel the reply.
If delivery is uncertain, check the terminal before replying. The mod stops sending to that terminal process.

## Connection and support

Herdr is the default connection. Cockpit is optional and uses an existing local installation.
If Cockpit already approves the same agents automatically, turn off its automatic sender first.

The mod supports local Codex permission menus in English. Chat messages can use any language.
Claude Code, remote agents, authentication prompts, text questions, and checkbox forms are not supported.
Native UI tests use macOS. Linux native UI is untested.

Approval controls need `hc` and `/bin/sh`, with no Node or Python requirement. Update checks use curl.
Update installation needs Python 3, curl, and `herdr-app`. It checks the release checksum, saves a backup, and keeps settings and personal placement.
Herdr and agent sessions stay open during updates.

See [design](docs/design.md) for implementation details and [validation](docs/validation.md) for test coverage.
