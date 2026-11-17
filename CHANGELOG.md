# Changelog

## Unreleased

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
- Durable competing-input claims, persistent cancellations and uncertain-delivery fencing.
- Pure regression tests, side-effect-free native check and isolated core smoke.
