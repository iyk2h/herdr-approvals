# Validation

Validation used macOS, Herdr app 0.1.16, herdr-core 0.1.21, and Node 24.
All prompts and commands in the test fixtures are fictional.

The automated checks cover these behaviors:

- Tests cover parsing, command identity, cursor movement, countdowns, cancellation, competing replies, durable claims, and uncertain delivery.
- Agent catalog tests cover selection before a request arrives, inactive selections, and new agents under all or selected scope.
- Recovery tests discard stale requests after connection errors and preserve durable input records.
- Shared setting tests stop stale countdowns and prevent hidden replies from the settings tab.
- Popup tests cover shared controller state, safe setting actions, closed popups, and stale request actions.
- Native checks render ten full and compact states, including custom delays, without input or persistent changes.
- An isolated core reads two fictional TUIs. Both receive one reply through the native provider after the same seven-second custom countdown.
- Separate preview homes render the default settings and agent picker without Cockpit or input.

Installation into a scratch Herdr home succeeds.
Without `--update`, a second installation stops before it overwrites the mod.

Live trials on 2026-11-17 used fictional agent terminals in the installed Herdr app.
Both connections delivered one allow-once reply after a configured three-second delay.
Cancellation trials used a ten-second delay. Both connections received no input after cancellation and the full delay.
The compact widget also completed the native delivery trial.

The fixtures do not execute a real Codex command.
These trials do not establish support for every Codex version.
Unit tests mock Cockpit delivery. The live trial used the actual Cockpit CLI.
External input can still change the prompt after dispatch validation.

Reproduction commands:

```sh
npm test
npm run check:package
python3 tools/native-check.py
python3 tools/core-spike.py
python3 tools/preview.py
python3 tools/preview.py --selected
```

The core test creates its own session and XDG directories.
It stops only that core after the test.
The preview tools use fictional agent metadata and a separate Herdr home.
