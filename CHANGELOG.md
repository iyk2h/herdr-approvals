# Changelog

## Unreleased

- Open settings from the sidebar and keep the empty request popup focused on request status.
- Fit empty request popups to their content and resize the same popup when requests change.
- Lock current request controls immediately after uncertain delivery.
- Ignore manual reply shortcuts and old callbacks for locked requests.
- Publish backup directories only after the backup copy completes.
- Prepare complete updates before replacement, preserve backups, and remove obsolete files.
- Preserve global cancellation between policy changes and request refreshes.
- Synchronize saved delay values without replacing unsaved text or applying stale values.
- Bind reply notices to the matching agent and request.
- Add isolated installer checks to CI and require Node 24 for development.
- Keep settings tall and limit popup dimensions to the available window size.
- Clarify cancellation, command rules, and the limits of platform validation.
- Set a custom delay from 1 to 3,600 seconds and count down requests independently.
- Keep the compact strip at 40px and show settings and request details in popups.
- Prevent hidden selections from accepting approval commands in settings.
- Select working and idle Codex agents before a permission request arrives.
- Clear stored agent selections, including inactive processes.
- Use concise English throughout the panel and settings.
- Explain automatic replies and optional Cockpit connections.
- Recover from connection errors without stale requests or lost input records.
- Add native agent selection previews and regression coverage.

## 0.1.0

- Standalone local Codex approval panel with optional Cockpit connection.
- Manual answers, three-second automatic countdown, cancellation and scope choice.
- Saved input records prevent competing replies and stop further mod input after uncertain delivery.
- Regression tests, native UI checks, and isolated core tests.
