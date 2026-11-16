# Validation

Validation used macOS, Herdr app 0.1.16, herdr-core 0.1.21, and Node 24.
All prompts and commands in the test fixtures are fictional.

The automated checks cover these behaviors:

- 80 tests cover parsing, command identity, cursor movement, countdowns, cancellation, competing replies, durable claims, and uncertain delivery.
- Agent catalog tests cover selection before a request arrives, inactive selections, and new agents under all or selected scope.
- Recovery tests discard stale requests after connection errors and preserve durable input records.
- Shared setting tests stop stale countdowns and prevent hidden replies from the settings tab.
- Native checks render requests, settings, agent selection, empty state, and uncertain delivery without input or persistent changes.
- An isolated core reads a fictional TUI and receives exactly one reply through the actual native provider.
- Separate preview homes render the default settings and agent picker without Cockpit or input.

Installation into a scratch Herdr home succeeds.
Without `--update`, a second installation stops before it overwrites the mod.

The test does not approve a real Codex command.
It does not establish support for every Codex version.
Tests mock actual Cockpit reply delivery.
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
