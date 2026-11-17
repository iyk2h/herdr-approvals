# Gallery release

## Repository description

Codex permission controls for Herdr. Manual replies, optional automatic approval, and a countdown for each agent. Cockpit is optional.

## Release description

Herdr Approval adds permission controls for supported local Codex menus in English.
Automatic approval is off by default. Cockpit is optional.
Supported requests include command execution and terminal input. Terminal input approvals always allow once.

The mod provides these controls:

- A 360px panel, or a 40px strip in a personal layout
- Settings and request details in popups
- A delay from 1 to 3,600 seconds
- An independent countdown for each agent
- Connections through Herdr or an existing local Cockpit installation

When countdowns end, the mod sends replies one at a time.
Selecting the request count in the strip stops automatic approval for that request.
In a popup, Esc closes the window. The global cancel command stops all current automatic requests.

Validation used macOS, automated approval and installer checks, eleven native UI states, and trials with fictional terminals.
The fixtures receive replies but execute no real Codex commands.
Linux and other Codex menu formats remain unvalidated.

## Gallery registration

The [repository](https://github.com/iyk2h/herdr-approvals) contains the mod, recipe, and screenshots with fictional requests.
The `herdr-mod` topic makes the public repository available to the gallery index.
The [Herdr gallery](https://herdr.dev/gallery/?type=mods) lists automatic updates within an hour. Preview images require separate screening.
