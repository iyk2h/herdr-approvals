import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalController } from '../mods/approvals/controller.js';
import { MemoryJournal } from '../mods/approvals/state.js';
import { parseCodex } from '../mods/approvals/parsers/codex.js';
import { codexPrompt, deferred } from './fixtures/prompts.mjs';

function request(address) {
  return {
    sessionKey: `core-1:${address}:created-10:pid-20`, episode: 'turn-1:blocked-30',
    title: address, address, agent: 'codex', status: 'blocked',
    question: parseCodex(codexPrompt({ command: 'pnpm test' })),
  };
}

async function ready(journal = new MemoryJournal()) {
  let now = 0;
  const provider = {
    id: 'native', current: [request('t1'), request('t2')], sent: [],
    async list() { return structuredClone(this.current); },
    async readQuestion(row) { return structuredClone(this.current.find(item => item.sessionKey === row.sessionKey) ?? null); },
    async submit(row, choice) {
      this.sent.push({ address: row.address, sessionKey: row.sessionKey, choice });
      return { status: 'delivered' };
    },
  };
  const controller = new ApprovalController({ provider, journal, now: () => now });
  controller.setEnabled(true);
  await controller.refresh();
  return { controller, provider, journal, at(value) { now = value; } };
}

const addresses = h => h.provider.sent.map(item => item.address);

async function cannotResend(h, row) {
  const sent = structuredClone(h.provider.sent);
  const result = await h.controller.submit(row.sessionKey, 1);
  assert.equal(result.status, 'unknown');
  h.at(20000);
  await h.controller.refresh();
  await h.controller.tick();
  assert.deepEqual(h.provider.sent, sent, 'uncertain input cannot be sent again through the mod');
}

for (const outcome of ['unknown', 'throw']) {
  test(`${outcome} delivery disables the affected row immediately while a due sibling still sends`, async () => {
    const h = await ready();
    h.provider.submit = async function(row, choice) {
      this.sent.push({ address: row.address, sessionKey: row.sessionKey, choice });
      if (row.address === 't1') {
        if (outcome === 'throw') throw new Error('fixture delivery acknowledgement lost');
        return { status: 'unknown' };
      }
      return { status: 'delivered' };
    };
    h.at(3000);
    await h.controller.tick();
    assert.deepEqual(addresses(h), ['t1', 't2']);
    assert.equal(h.controller.rows.find(row => row.address === 't1').quarantined, true,
      'the current UI row must disable replies without another provider refresh');
    assert.notEqual(h.controller.rows.find(row => row.address === 't2').quarantined, true);
    await cannotResend(h, h.provider.current[0]);
  });
}

test('a lost journal acknowledgement after delivery immediately disables only that session', async () => {
  const memory = new MemoryJournal();
  const first = request('t1');
  const journal = {
    claim: (...args) => memory.claim(...args), entries: () => memory.entries(),
    async mark(key, status) {
      const record = (await memory.entries()).find(item => item.key === key);
      if (record?.sessionKey === first.sessionKey) throw new Error('fixture result record unavailable');
      return memory.mark(key, status);
    },
  };
  const h = await ready(journal);
  h.at(3000);
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t1', 't2']);
  assert.equal(h.controller.rows.find(row => row.sessionKey === first.sessionKey).quarantined, true);
  assert.notEqual(h.controller.rows.find(row => row.address === 't2').quarantined, true);
  assert.equal((await memory.entries()).find(record => record.sessionKey === first.sessionKey).status, 'dispatching');
  await cannotResend(h, first);
});

test('a foreign dispatching claim disables its row in the same tick without input to that agent', async () => {
  const h = await ready();
  const first = h.provider.current[0];
  await h.journal.claim(h.controller.key(first), {
    provider: 'native', status: 'dispatching', sessionKey: first.sessionKey, episode: first.episode,
  });
  h.at(3000);
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t2']);
  assert.equal(h.controller.rows.find(row => row.sessionKey === first.sessionKey).quarantined, true);
  assert.notEqual(h.controller.rows.find(row => row.address === 't2').quarantined, true);
  assert.equal((await h.journal.entries()).find(record => record.sessionKey === first.sessionKey).status, 'dispatching',
    'observing another sender cannot alter its claim');
  await cannotResend(h, first);
});

test('a dispatching claim that wins during validation immediately disables the losing row', async () => {
  const memory = new MemoryJournal();
  const first = request('t1');
  let competing = true;
  const journal = {
    entries: () => memory.entries(), mark: (...args) => memory.mark(...args),
    async claim(key, record) {
      if (competing && record.source === 'auto' && record.sessionKey === first.sessionKey) {
        competing = false;
        await memory.claim(key, { ...record, source: 'competing' });
        return false;
      }
      return memory.claim(key, record);
    },
  };
  const h = await ready(journal);
  h.at(3000);
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t2']);
  assert.equal(h.controller.rows.find(row => row.sessionKey === first.sessionKey).quarantined, true);
  assert.notEqual(h.controller.rows.find(row => row.address === 't2').quarantined, true);
  await cannotResend(h, first);
});

test('an uncertain old process does not disable a new process at the same terminal address', async () => {
  const h = await ready();
  const submit = h.provider.submit.bind(h.provider);
  h.provider.submit = async function(row, choice) {
    const result = await submit(row, choice);
    return row.address === 't1' && row.sessionKey.endsWith('pid-20') ? { status: 'unknown' } : result;
  };
  h.at(3000);
  await h.controller.tick();
  const replacement = { ...request('t1'), sessionKey: 'core-1:t1:created-50:pid-60', episode: 'turn-1:blocked-70' };
  h.provider.current[0] = replacement;
  h.at(4000);
  await h.controller.refresh();
  assert.notEqual(h.controller.rows.find(row => row.sessionKey === replacement.sessionKey).quarantined, true);
  assert.equal(h.controller.pending.sessionKey, replacement.sessionKey);
  h.at(7000);
  await h.controller.tick();
  assert.deepEqual(addresses(h), ['t1', 't2', 't1']);
});

test('an older refresh snapshot cannot restore an immediately quarantined request', async () => {
  const memory = new MemoryJournal();
  const entered = deferred(), release = deferred();
  let pause = false, captured = false;
  const journal = {
    claim: (...args) => memory.claim(...args), mark: (...args) => memory.mark(...args),
    async entries() {
      const snapshot = await memory.entries();
      if (pause && !captured) {
        captured = true;
        entered.resolve();
        await release.promise;
      }
      return snapshot;
    },
  };
  const h = await ready(journal);
  h.provider.submit = async function(row, choice) {
    this.sent.push({ address: row.address, sessionKey: row.sessionKey, choice });
    return { status: row.address === 't1' ? 'unknown' : 'delivered' };
  };
  pause = true;
  const refreshing = h.controller.refresh();
  await entered.promise;
  h.at(3000);
  try {
    await h.controller.tick();
    assert.equal(h.controller.rows.find(row => row.address === 't1').quarantined, true);
  } finally {
    release.resolve();
    await refreshing;
  }
  assert.equal(h.controller.rows.find(row => row.address === 't1').quarantined, true,
    'a pre-fence refresh cannot re-enable manual replies');
  assert.notEqual(h.controller.rows.find(row => row.address === 't2').quarantined, true);
  assert.equal(h.controller.pending, null, 'the stale observation cannot restart either completed countdown');
  assert.deepEqual(addresses(h), ['t1', 't2']);
});
