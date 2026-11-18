# Design

## One input owner

The bar or side panel owns the approval controller. Popups share that controller through a presentation registry. Popup actions go through a mailbox so the owner handles them in its own task context. Closing a popup revokes its token without replacing the controller.

The native and Cockpit connections use the same terminal identity and input records. A failed connection does not switch to another sender. Cockpit's own automatic sender does not share these records and must be disabled when it would answer the same agents.

## Requests and timers

The agent catalog includes live local Codex agents before they request permission. The request queue contains only recognized permission menus. Individual selections use the current terminal process identity; the all-agents setting includes new agents.

A request fingerprint contains the full command and reply descriptions. Terminal input fingerprints also contain the target, escaped input, environment, and reason. The mod answers Codex's menu rather than sending the displayed terminal input itself. It reads the current cursor before choosing arrow keys.

Each request has its own deadline. Replies use one serial dispatcher, so simultaneous deadlines do not add a fresh delay to each reply. Canceling one request leaves the other deadlines intact. Global cancellation and policy changes invalidate affected deadlines and in-flight validation.

## Input records

The controller saves a claim with a compare-and-set write before sending input. The journal holds up to 512 records and preserves uncertain attempts. If it fills, new claims stop. An uncertain attempt blocks further input to that terminal process; a new root process has a new identity.

Cancellation takes effect in memory immediately. Its durable record is saved asynchronously, and `controller.flush()` waits for that write. A hard crash before the write completes can lose the cancellation. Records contain request digests rather than question or command text.

## Delivery limits

The controller checks the request again before sending. Herdr core cannot make delivery conditional on that request identity or withdraw input after dispatch. External input can still change the prompt before queued keys reach it. Countdown, sending, and unknown delivery therefore have separate UI states.

## Updates

Stable releases contain the mod and its licenses in a checksummed ZIP. The updater checks the candidate in the native runtime, saves a complete backup, preserves the installed `mod.json`, and replaces the directory. Failed replacement or post-install validation restores the previous copy.

An update waits until all registered owners have no pending approval work. A shared update transaction pauses their controllers without changing saved settings. After a source reload, the new owner reads the matching install receipt before resuming. Old code cannot finalize a newer version's success.

## Runtime

Native integration stays in `main.js`, `ui.js`, and `host.js`. The controller, parser, policy, and providers use injected IO. Approval controls use GPUI JavaScript, `hc`, and `/bin/sh`. Update checks use curl; update installation uses Python 3. Node is a development tool.
