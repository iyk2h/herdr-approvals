import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalController } from '../mods/approvals/controller.js';
import { MemoryJournal } from '../mods/approvals/state.js';
import { parseCodex } from '../mods/approvals/parsers/codex.js';
import { codexPrompt, deferred } from './fixtures/prompts.mjs';

function request(address, command = 'pnpm test') {
  return {
    sessionKey: `core-1:${address}:created-10:pid-20`, episode: 'turn-1:blocked-30',
    title: address, address, agent: 'codex', status: 'blocked',
    question: parseCodex(codexPrompt({ command })),
  };
}

function model({ journal = new MemoryJournal(), delayMs = 3000 } = {}) {
  let time = 0;
  const provider = {
    id: 'native', current: [request('t1'), request('t2')], sent: [],
    async list() { return structuredClone(this.current); },
    async readQuestion(row) { return structuredClone(this.current.find(item => item.sessionKey === row.sessionKey) ?? null); },
    async submit(row, choice) { this.sent.push({ row: structuredClone(row), choice, at: time }); return { status: 'delivered' }; },
  };
  const controller = new ApprovalController({ provider, journal, now: () => time, delayMs });
  return { controller, provider, journal, at: value => { time = value; } };
}

async function ready(options) {
  const h = model(options);
  h.controller.setEnabled(true);
  await h.controller.refresh();
  return h;
}

const addresses = h => h.provider.sent.map(item => item.row.address);

test('simultaneous agent requests finish their countdowns together without an extra delay per request', async () => {
  const h = await ready();
  h.at(2999);
  await h.controller.tick();
  assert.deepEqual(addresses(h), []);
  h.at(3000);
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t1', 't2']);
  assert.deepEqual(h.provider.sent.map(item => item.at), [3000, 3000]);
  await h.controller.refresh();
  h.at(9000);
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t1', 't2'], 'each durable request is sent only once');
});

test('a later agent starts its own countdown while the earlier agent keeps its original deadline', async () => {
  const h = model();
  const second = h.provider.current.pop();
  h.controller.setEnabled(true);
  await h.controller.refresh();
  h.at(1000);
  h.provider.current.push(second);
  await h.controller.refresh();
  h.at(3000);
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t1']);
  assert.equal(h.controller.pending.sessionKey, second.sessionKey);
  assert.equal(h.controller.pending.deadline, 4000);
  h.at(3999);
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t1']);
  h.at(4000);
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t1', 't2']);
});

for (const action of ['cancel', 'select']) {
  test(`${action} for one agent does not reset another agent's countdown`, async () => {
    const h = await ready();
    h.at(1000);
    const first = h.provider.current[0];
    if (action === 'cancel') h.controller.cancel(first.sessionKey);
    else h.controller.select(first.sessionKey, 3);
    await h.controller.refresh();
    assert.equal(h.controller.pending.sessionKey, h.provider.current[1].sessionKey);
    assert.equal(h.controller.pending.deadline, 3000);
    h.at(3000);
    await h.controller.tick();
    assert.deepEqual(addresses(h), ['t2']);
  });
}

for (const change of ['command', 'disappearance']) {
  test(`one agent's ${change} does not postpone an unchanged agent`, async () => {
    const h = await ready();
    const second = h.provider.current[1];
    h.at(1000);
    if (change === 'command') h.provider.current[0].question = parseCodex(codexPrompt({ command: 'pnpm lint' }));
    else h.provider.current.shift();
    await h.controller.refresh();
    assert.equal(h.controller.pending.sessionKey, second.sessionKey);
    assert.equal(h.controller.pending.deadline, 3000);
    h.at(3000);
    await h.controller.tick();
    assert.deepEqual(addresses(h), ['t2']);
    if (change === 'command') {
      assert.equal(h.controller.pending.deadline, 4000);
      h.at(4000);
      await h.controller.tick();
      assert.deepEqual(addresses(h), ['t2', 't1']);
    }
  });
}

test('cancelling a queued agent cannot abort a different agent already in validation', async () => {
  const h = await ready();
  const entered = deferred(), release = deferred();
  const read = h.provider.readQuestion.bind(h.provider);
  h.provider.readQuestion = async row => {
    if (row.address === 't1') { entered.resolve(); await release.promise; }
    return read(row);
  };
  h.at(3000);
  const ticking = h.controller.tick();
  await entered.promise;
  h.controller.cancel(h.provider.current[1].sessionKey);
  release.resolve();
  await ticking;
  assert.deepEqual(addresses(h), ['t1']);
});

test('cancelling the validating agent still permits another already-due countdown', async () => {
  const h = await ready();
  const entered = deferred(), release = deferred();
  const read = h.provider.readQuestion.bind(h.provider);
  h.provider.readQuestion = async row => {
    if (row.address === 't1') { entered.resolve(); await release.promise; }
    return read(row);
  };
  h.at(3000);
  const ticking = h.controller.tick();
  await entered.promise;
  h.controller.cancel(h.provider.current[0].sessionKey);
  release.resolve();
  await ticking;
  assert.deepEqual(addresses(h), ['t2']);
});

for (const action of ['cancel', 'disable', 'close']) {
  test(`global ${action} stops all queued agents and preserves each cancellation after reload`, async () => {
    const h = await ready();
    if (action === 'cancel') h.controller.cancel();
    else if (action === 'disable') h.controller.setEnabled(false);
    else h.controller.close();
    await h.controller.flush();
    h.at(3000);
    await h.controller.tick();
    assert.deepEqual(addresses(h), []);
    let now = 10000;
    const reloaded = new ApprovalController({ provider: h.provider, journal: h.journal, now: () => now });
    reloaded.setEnabled(true);
    await reloaded.refresh();
    now = 13000;
    await reloaded.tick();
    assert.deepEqual(addresses(h), [], 'no cancelled sibling can regain automatic approval after reload');
  });
}

for (const change of ['delay', 'mode']) {
  test(`changing ${change} restarts every agent countdown using the new policy`, async () => {
    const h = await ready();
    h.at(1000);
    if (change === 'delay') h.controller.setDelay(7000);
    else h.controller.setMode('remember');
    assert.equal(h.controller.pending, null);
    await h.controller.refresh();
    const deadline = change === 'delay' ? 8000 : 4000;
    h.at(deadline - 1);
    await h.controller.tick();
    assert.deepEqual(addresses(h), []);
    h.at(deadline);
    await h.controller.tick();
    assert.deepEqual(addresses(h), ['t1', 't2']);
    assert.deepEqual(h.provider.sent.map(item => item.choice), change === 'delay' ? [1, 1] : [2, 2]);
  });
}

test('uncertain delivery quarantines only its own agent while another due agent still receives one reply', async () => {
  const h = await ready();
  h.provider.submit = async function(row, choice) {
    this.sent.push({ row: structuredClone(row), choice });
    return { status: row.address === 't1' ? 'unknown' : 'delivered' };
  };
  h.at(3000);
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t1', 't2']);
  await h.controller.refresh();
  h.at(10000);
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t1', 't2']);
  assert.ok((await h.journal.entries()).some(entry => entry.sessionKey === h.provider.current[0].sessionKey && entry.status === 'unknown'));
});

test('competing controllers cannot duplicate any request in a due batch', async () => {
  const journal = new MemoryJournal();
  const first = await ready({ journal }), second = await ready({ journal });
  first.at(3000); second.at(3000);
  await Promise.all([first.controller.tick(), second.controller.tick()]);
  assert.deepEqual([...addresses(first), ...addresses(second)].sort(), ['t1', 't2']);
});

test('due countdowns share one serial transport and overlapping ticks cannot create a second sender', async () => {
  const h = await ready();
  const entered = deferred(), release = deferred();
  let inFlight = 0;
  h.provider.submit = async function(row, choice) {
    inFlight += 1;
    assert.equal(inFlight, 1, 'each transport completes before another starts');
    this.sent.push({ row: structuredClone(row), choice });
    if (row.address === 't1') { entered.resolve(); await release.promise; }
    inFlight -= 1;
    return { status: 'delivered' };
  };
  h.at(3000);
  const ticking = h.controller.tick();
  await entered.promise;
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t1']);
  release.resolve();
  await ticking;
  assert.deepEqual(addresses(h), ['t1', 't2']);
});

test('a configured custom delay is used for every simultaneous countdown', async () => {
  const h = model();
  h.controller.setDelay(7000);
  h.controller.setEnabled(true);
  await h.controller.refresh();
  h.at(6999);
  await h.controller.tick();
  assert.deepEqual(addresses(h), []);
  h.at(7000);
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t1', 't2']);
});

test('invalid custom delays cannot alter an existing countdown or create an immediate constructor deadline', async () => {
  const h = await ready();
  const pending = h.controller.pending;
  for (const invalid of ['', null, undefined, NaN, Infinity, -1000, 0, 999, 1500, 3600001, 3601000, '7000']) {
    h.controller.setDelay(invalid);
    assert.equal(h.controller.delayMs, 3000);
    assert.equal(h.controller.pending, pending);
    const fresh = model({ delayMs: invalid });
    assert.equal(fresh.controller.delayMs, 3000, `constructor must use a safe default for ${String(invalid)}`);
  }
});

test('a failed durable cancellation clears other due countdowns instead of rescheduling a failing batch', async () => {
  const memory = new MemoryJournal();
  const journal = {
    entries: () => memory.entries(), mark: (...args) => memory.mark(...args),
    async claim(key, record) {
      if (record.kind === 'cancellation') throw new Error('cancellation storage unavailable');
      return memory.claim(key, record);
    },
  };
  const h = await ready({ journal });
  h.controller.cancel(h.provider.current[0].sessionKey);
  assert.ok(h.controller.pending, 'the other agent still has a countdown before persistence fails');
  h.at(3000);
  const result = await h.controller.tick();
  assert.equal(result.status, 'error');
  assert.match(h.controller.error, /cancellation storage unavailable/);
  assert.equal(h.controller.pending, null, 'a permanently failing flush cannot leave an expired timer for the owner to reschedule');
  assert.deepEqual(addresses(h), []);
});

for (const change of ['delay', 'mode']) {
  for (const action of ['cancel', 'disable', 'close']) {
    test(`global ${action} after a ${change} change cancels visible requests before replacement countdowns start`, async () => {
      const h = await ready();
      h.at(1000);
      if (change === 'delay') h.controller.setDelay(7000);
      else h.controller.setMode('remember');
      assert.equal(h.controller.pending, null, 'the policy change creates a gap before the next refresh');
      assert.equal(h.controller.rows.length, 2, 'both permission requests remain visible during that gap');
      if (action === 'cancel') h.controller.cancel();
      else if (action === 'disable') h.controller.setEnabled(false);
      else h.controller.close();
      await h.controller.flush();
      let now = 10000;
      const reloaded = new ApprovalController({ provider: h.provider, journal: h.journal,
        delayMs: h.controller.delayMs, mode: h.controller.mode, now: () => now });
      reloaded.setEnabled(true);
      await reloaded.refresh();
      now = 50000;
      await reloaded.tick();
      assert.deepEqual(addresses(h), [], 'no visible cancelled request can regain automatic approval after reload');
    });
  }
}

test('dispatch status identifies the exact request throughout validation and completion', async () => {
  const h = await ready();
  h.controller.cancel(h.provider.current[0].sessionKey);
  const target = h.provider.current[1];
  const entered = deferred(), release = deferred();
  const read = h.provider.readQuestion.bind(h.provider);
  h.provider.readQuestion = async row => {
    if (row.sessionKey === target.sessionKey) { entered.resolve(); await release.promise; }
    return read(row);
  };
  h.at(3000);
  const ticking = h.controller.tick();
  await entered.promise;
  const validating = structuredClone(h.controller.statusRequest);
  release.resolve();
  await ticking;
  const expected = { sessionKey: target.sessionKey, episode: target.episode, fingerprint: target.question.fingerprint };
  assert.deepEqual(validating, expected, 'validation status must identify its source request');
  assert.equal(h.controller.status, 'sent');
  assert.deepEqual(h.controller.statusRequest, expected, 'a completed sibling reply must retain its own identity');
});
