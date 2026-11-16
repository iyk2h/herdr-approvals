# Design

The native provider is the default connection. Cockpit is an optional connection.
Both connections use the same terminal identity and input records.
If a connection fails, the controller does not switch senders.

The agent catalog includes live local Codex agents, including agents with no permission request.
The request queue includes only recognized permission requests.
This separation lets a user select an agent before it requests permission.
The setting for all agents includes future local Codex agents. Individual selections use the current terminal process identity.

The parser keeps the full command and reply descriptions in the request fingerprint.
Cursor position stays separate. The latest cursor determines the required arrow keys.
Only exact agent aliases and recognized permission menus qualify for input.
Authentication prompts, text questions, and missing process metadata do not qualify.

The controller handles manual and automatic replies through one dispatch path.
It saves a durable claim before input. The claim uses compare-and-set writes in a core document.
A cancellation record stops automatic input. An explicit manual reply remains possible before dispatch.

The journal contains at most 512 records.
It preserves uncertain attempts. If the journal is full, new claims stop.
An uncertain delivery blocks input to the same terminal process, even if the prompt or foreground process changes.
A new root process has a new identity.

Panel copies in the same Herdr home share settings. Copies on the same core share input records.
Other tools and Cockpit automatic senders do not share these records.
If Cockpit already approves these agents, disable its automatic sender before you enable this mod.

Core cannot condition input on a request identity. Core also cannot withdraw input after dispatch.
Before dispatch, the controller reads the prompt again. External input can still change the prompt before delivery.
The UI shows separate countdown, dispatch, and uncertain delivery states.

Cancellation takes effect immediately in memory. The controller saves a cancellation record asynchronously.
`controller.flush()` acknowledges the durable write.
A hard crash before that acknowledgement can lose the cancellation.
Question and command text remain in memory. Durable records contain their digest.

The runtime uses native GPUI JavaScript, `/bin/sh`, and `hc`.
Node and Python are development and installation tools.
Tests use fictional prompts, mock providers, native controls, and an isolated core.
