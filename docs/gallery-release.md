# Gallery release draft

## Repository description

Native Codex permission controls for Herdr, with manual replies, optional automatic approval, and per-agent countdowns.

## Release description

Herdr Approvals adds permission controls for supported local Codex menus in English.
Automatic approval is off by default. Cockpit is optional.

The mod provides these controls:

- A 360px panel, or a 40px strip in a personal layout
- Settings and request details in popups
- A delay from 1 to 3,600 seconds
- An independent countdown for each agent
- Connections through Herdr or an existing local Cockpit installation

When countdowns end, the mod sends replies one at a time.
Selecting the request count in the strip stops automatic approval for that request.
In a popup, Esc closes the window. The global cancel command stops all current automatic requests.

Validation used macOS, 114 automated tests, ten native UI states, and trials with fictional terminals.
The fixtures receive replies but execute no real Codex commands.
Linux and other Codex menu formats remain unvalidated.
