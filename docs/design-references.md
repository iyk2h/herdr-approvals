# Approval panel design references

The panel follows two official product references for information structure:

- [Linear account preferences](https://linear.app/docs/account-preferences):
  named settings grouped by purpose, with a short explanation adjacent to each
  control. This informed the Automation and Connection sections and the separation
  of settings from the request task.
- [Raycast Settings](https://manual.raycast.com/settings): extension-specific
  preferences and explicit scope for permissions and automatic review. This
  informed the local-Codex scope, selected-session list, and visible distinction
  between once-only and remembered permission choices.

These are structural references, not a reproduction of either product's visual
identity. Runtime uses Herdr's own theme tokens and native GPUI controls.

## Applied decisions

- Requests and Settings are separate tabs. The request task keeps only its queue,
  command, choices, cancellation status, and final action.
- Waiting sessions use compact left-aligned rows. Full command text is displayed
  in a monospace block, while numbered answers remain readable on a narrow panel.
- Only the final approval action uses the primary theme color. Cancel, session
  navigation, tabs, and preference controls use quieter theme treatments.
- Automation settings expose enabled state, 3/5/10-second delay, all-local versus
  selected-session scope, and once versus remembered permission behavior.
- Connection is selected separately and explains when an outstanding request
  prevents changing providers.
- Empty, manually selected, cancelled, unknown, and in-flight states use explicit
  text. No status depends on color alone.
- Preview mode supports tab navigation and disables controls that could change
  settings or send input. The layout uses flexible, wrapping text at 360px width
  and follows both light and dark Herdr themes.
