import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryJournal, CasJournal} from '../mods/approvals/state.js';
import {casHost} from './fixtures/prompts.mjs';

test('memory claims fence the same request and retain the result', async () => {
  const journal = new MemoryJournal();
  assert.equal(await journal.claim('request-1', {status: 'dispatching'}), true);
  assert.equal(await journal.claim('request-1', {status: 'dispatching'}), false);
  await journal.mark('request-1', 'unknown');
  assert.deepEqual((await journal.entries()).map(({key, status}) => ({key, status})), [
    {key: 'request-1', status: 'unknown'},
  ]);
  assert.equal(await journal.claim('request-1', {status: 'dispatching'}), false);
});

test('competing CAS journals grant exactly one claim for the same request', async () => {
  const host = casHost();
  const first = new CasJournal(host, 'test.approvals');
  const second = new CasJournal(host, 'test.approvals');
  const outcomes = await Promise.all([
    first.claim('request-1', {status: 'dispatching'}),
    second.claim('request-1', {status: 'dispatching'}),
  ]);
  assert.deepEqual(outcomes.sort(), [false, true]);
  assert.equal((await first.entries()).length, 1);
});

test('a fresh CAS journal still sees an unknown attempt and refuses to claim it', async () => {
  const host = casHost();
  const first = new CasJournal(host, 'test.approvals');
  await first.claim('request-1', {status: 'dispatching'});
  await first.mark('request-1', 'unknown');
  const reloaded = new CasJournal(host, 'test.approvals');
  assert.equal(await reloaded.claim('request-1', {status: 'dispatching'}), false);
  assert.equal((await reloaded.entries())[0].status, 'unknown');
});

test('CAS conflicts are retried without losing another request or unknown fence', async () => {
  const host = casHost();
  const first = new CasJournal(host, 'test.approvals');
  const second = new CasJournal(host, 'test.approvals');
  await Promise.all([
    first.claim('request-1', {status: 'unknown'}),
    second.claim('request-2', {status: 'dispatching'}),
  ]);
  const entries = await first.entries();
  assert.deepEqual(entries.map(entry => entry.key).sort(), ['request-1', 'request-2']);
  assert.equal(entries.find(entry => entry.key === 'request-1').status, 'unknown');
});

test('ordinary CAS persistence errors reject a claim instead of granting input ownership', async () => {
  const host = casHost();
  host.setFailure(new Error('storage unavailable'));
  const journal = new CasJournal(host, 'test.approvals');
  await assert.rejects(journal.claim('request-1', {status: 'dispatching'}), /storage unavailable/);
  assert.equal((await journal.entries()).length, 0);
});

test('CAS cancellation defeats an automatic attempt even when it wins during a conflicting write', async () => {
  for (const racingCancellation of [false, true]) {
    const base = casHost();
    const requestKey = 'request-1';
    const name = 'test.approvals';
    const cancellation = {
      status: 'cancelled', kind: 'cancellation', requestKey,
      provider: 'native', sessionKey: 'core-1:t1:pid-20', episode: 'turn-1:blocked-30',
    };
    let injected = false;
    let canceller;
    const host = {
      read: (...args) => base.read(...args),
      async write(doc, value, expected) {
        if (racingCancellation && !injected && value.entries.some(entry => entry.key === requestKey && entry.source === 'auto')) {
          injected = true;
          await canceller.claim(`cancel:${requestKey}`, cancellation);
        }
        return base.write(doc, value, expected);
      },
    };
    canceller = new CasJournal(host, name);
    const sender = new CasJournal(host, name);
    if (!racingCancellation) await canceller.claim(`cancel:${requestKey}`, cancellation);

    const record = {status: 'dispatching', source: 'auto', provider: 'native',
      sessionKey: cancellation.sessionKey, episode: cancellation.episode};
    assert.equal(await sender.claim(requestKey, record), false,
      racingCancellation ? 'CAS retry must re-evaluate the newly persisted cancellation' : 'a persisted cancellation must prevent the automatic claim');
    assert.equal((await sender.entries()).some(entry => entry.key === requestKey), false);
    assert.equal(await sender.claim(requestKey, {...record, source: 'manual'}), true,
      'explicit manual input is still permitted after automatic cancellation');
  }
});
