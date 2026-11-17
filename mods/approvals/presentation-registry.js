const owners = new Map();
let sequence = 0;

function queue(coalesce = false) {
  let values = [], waiter = null, closed = false;
  return {
    push(value) {
      if (closed) return false;
      if (waiter) { const resolve = waiter; waiter = null; resolve(value); }
      else if (coalesce) values = [value];
      else values.push(value);
      return true;
    },
    next() {
      if (values.length) return Promise.resolve(values.shift());
      if (closed) return Promise.resolve(null);
      return new Promise(resolve => { waiter = resolve; });
    },
    close() {
      closed = true;
      for (const value of values) value.ack?.(false);
      values = [];
      if (waiter) { waiter(null); waiter = null; }
    },
  };
}

// Keep capabilities and in-memory messages here; host contexts stay in their own tasks.
export function registerOwner(owner) {
  const id = `approvals-owner-${++sequence}`;
  const entry = { owner, actions: queue(), dialog: null };
  owners.set(id, entry);
  return { id, entry };
}

export function presentation(ownerId, token) {
  const entry = owners.get(ownerId);
  return entry?.dialog?.token === token ? entry : null;
}

export function newPresentation(ownerId, tab) {
  const entry = owners.get(ownerId);
  if (!entry) return null;
  entry.dialog?.updates.close();
  entry.dialog = { token: `approvals-dialog-${++sequence}`, tab, updates: queue(true) };
  return entry.dialog;
}

export function revokePresentation(ownerId, token) {
  const entry = presentation(ownerId, token);
  if (!entry) return;
  entry.dialog.updates.close();
  entry.dialog = null;
}

export function relay(packet) {
  const entry = presentation(packet.ownerId, packet.dialogToken);
  if (!entry) return Promise.resolve(false);
  return new Promise(ack => { if (!entry.actions.push({ packet, ack })) ack(false); });
}

export function publish(ownerId) { owners.get(ownerId)?.dialog?.updates.push(true); }

export function removeOwner(ownerId) {
  const entry = owners.get(ownerId);
  if (!entry) return;
  entry.dialog?.updates.close();
  entry.actions.close();
  owners.delete(ownerId);
}
