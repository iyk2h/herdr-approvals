# Design

The native provider is the default. An optional Cockpit provider normalizes local
terminal handles into the same identity and claim scope. Switching connections
does not create a second ownership namespace. No failed send falls back elsewhere.

The parser preserves the command and choice descriptions in the fingerprint.
Cursor position is observed separately and determines the latest up/down plan.
Only exact known agent aliases and recognized permission menus are accepted;
explicit auth/question status and missing foreground identity are rejected.

Controller state combines immediate invalidation with a durable CAS journal.
Manual/automatic answers share one dispatch path. A cancellation is distinct from
an input claim so an explicit manual answer remains possible before dispatch was
claimed. Competing automatic claims check cancellations inside the CAS mutation.

The journal never evicts uncertain attempts to make space. Its bounded capacity
stops new claims when full. Unknown/dispatching records quarantine the root
terminal incarnation, even if a foreground observation or prompt changes. A root
process restart changes identity; transient missing metadata does not lift fences.

The protocol coordinates participating panels, not external input. Core lacks
conditional request-id input and queue withdrawal; validation cannot make terminal
input atomic. The UI distinguishes countdown, dispatch and delivery uncertainty.

The shipped module uses native GPUI JavaScript and `/bin/sh` + `hc`. Node and
Python are development/installation tools only. Tests use fake providers, fixture
screens, mock native controls and an isolated actual core/TUI.
