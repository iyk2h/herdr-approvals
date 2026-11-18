# Herdr Approval

Standalone native Herdr Mod. Runtime is GPUI JavaScript, not a browser or Node.
No runtime dependencies on Cockpit, Node, Rust, or a new daemon.

- Runtime files live in `mods/approvals/`; pure modules must also import in Node tests.
- Inject host IO into providers and state. Keep native imports in main.js, ui.js, and host.js; keep the controller, parser, policy, and providers independent of the native runtime.
- All input goes through one controller. Never send input in render or during checking().
- A permission request requires an identified agent, complete recognized menu, and cursor.
- Persist an attempt claim before input. Unknown delivery is never retried automatically.
- One session uses one provider. Do not fall back to another sender after failure.
- Keep upstream parser attribution and relevant licenses in NOTICE and LICENSES/.
- Never commit user settings, tokens, real terminal screens, private paths, or actual sessions.
- Update checks use curl. Only explicit update installation requires Python 3; approval controls do not.
- Runtime VERSION and package.json must match. Release archives contain only the mod and its licenses.
- Use Node's built-in test runner; no installation is needed.
- Do not modify the user's running Herdr/Cockpit while developing or testing.
