# Validation

The first implementation was checked on macOS with Herdr app 0.1.16, herdr-core
0.1.21 and Node 24.5.0. Tests use fictional commands and questions.

- 67 unit/integration tests cover parser ambiguity, cursor movement, exact countdown,
  manual/automatic races, durable claims, persistent cancellation, policy changes
  across panel copies, configurable delay/scope, hidden-selection prevention in
  settings, and quarantine after uncertain input.
- Native `herdr-app check` renders the actual mod in checking mode with no IO.
- A real isolated core runs a fictional permission TUI. The actual NativeProvider
  reads its screen, the controller claims a CAS record, and `hc keys` submits a
  reply. The fixture receipt verifies one allow-once input. No Cockpit is present.
- A second isolated Herdr home renders the panel for `preview.png`, without
  Cockpit or real input. Its app status reports no mod errors.
- Installation into a scratch app home succeeds. Reinstalling without --update
  refuses to overwrite it.

This does not claim a real Codex command was approved or that every Codex version
has the same UI. Actual Cockpit answer delivery is mocked in provider tests.
External input races after dispatch remain a core API limitation.
