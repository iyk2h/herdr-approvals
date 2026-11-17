import test from 'node:test';
import assert from 'node:assert/strict';

let revision = 0;
const loadRevision = () => import(new URL(`../mods/approvals/presentation-registry.js?revision=${++revision}`, import.meta.url));

test('loading a presentation module revision has no global initialization side effects', async () => {
  const before = Reflect.ownKeys(globalThis);
  await loadRevision();
  assert.deepEqual(Reflect.ownKeys(globalThis), before);
});

test('a popup loaded after a folder rescan reaches the existing owner and its mailbox', async () => {
  const ownerModule = await loadRevision();
  const owner = { controller: { pending: { deadline: 3000 } } };
  const { id, entry } = ownerModule.registerOwner(owner);
  try {
    const dialog = ownerModule.newPresentation(id, 'settings');
    const popupModule = await loadRevision();
    assert.equal(popupModule.presentation(id, dialog.token), entry,
      'a new code revision must find the still-mounted sidebar owner');
    assert.equal(popupModule.presentation(id, dialog.token).owner, owner);
    const incoming = entry.actions.next();
    const acknowledged = popupModule.relay({ ownerId: id, dialogToken: dialog.token, action: 'delay', value: 5000 });
    const message = await incoming;
    assert.equal(message.packet.value, 5000);
    message.ack(true);
    assert.equal(await acknowledged, true);
    const update = dialog.updates.next();
    popupModule.publish(id);
    assert.equal(await update, true);
    assert.equal(owner.controller.pending.deadline, 3000);
  } finally {
    ownerModule.removeOwner(id);
  }
});

test('replacing and closing popups revoke capabilities across code revisions without identifier reuse', async () => {
  const first = await loadRevision(), second = await loadRevision();
  const { id, entry } = first.registerOwner({});
  const other = second.registerOwner({});
  try {
    assert.notEqual(other.id, id, 'fresh module evaluations cannot reset the owner sequence');
    const old = first.newPresentation(id, 'requests');
    const current = second.newPresentation(id, 'settings');
    assert.notEqual(old.token, current.token);
    assert.equal(first.presentation(id, old.token), null);
    assert.equal(await old.updates.next(), null);
    first.revokePresentation(id, old.token);
    assert.equal(second.presentation(id, current.token), entry, 'a delayed close cannot revoke a newer popup');
    assert.equal(await second.relay({ ownerId: id, dialogToken: old.token, action: 'toggle' }), false);
    const waiting = first.relay({ ownerId: id, dialogToken: current.token, action: 'toggle' });
    second.removeOwner(id);
    assert.equal(await waiting, false, 'owner removal must settle messages from another revision');
    assert.equal(first.presentation(id, current.token), null);
    assert.equal(await current.updates.next(), null);
    assert.equal(second.presentation(other.id, second.newPresentation(other.id, 'settings').token), other.entry);
  } finally {
    first.removeOwner(id);
    second.removeOwner(other.id);
  }
});

test('a replacement sidebar retires its previous registration while other panels stay connected', { timeout: 1000 }, async () => {
  const first = await loadRevision(), second = await loadRevision();
  const old = first.registerOwner({}, 'sidebar');
  const other = first.registerOwner({}, 'other-sidebar');
  const dialog = first.newPresentation(old.id, 'settings');
  const otherDialog = first.newPresentation(other.id, 'requests');
  const waiting = first.relay({ ownerId: old.id, dialogToken: dialog.token, action: 'delay', value: 5000 });
  const replacement = second.registerOwner({}, 'sidebar');
  try {
    assert.equal(second.presentation(old.id, dialog.token), null);
    assert.equal(await waiting, false);
    assert.equal(await dialog.updates.next(), null);
    first.removeOwner(old.id);
    const current = second.newPresentation(replacement.id, 'settings');
    assert.equal(first.presentation(replacement.id, current.token), replacement.entry);
    assert.equal(second.presentation(other.id, otherDialog.token), other.entry);
  } finally {
    first.removeOwner(old.id);
    first.removeOwner(other.id);
    second.removeOwner(replacement.id);
  }
});
