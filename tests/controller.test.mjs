import test from 'node:test';
import assert from 'node:assert/strict';
import {ApprovalController} from '../mods/approvals/controller.js';
import {MemoryJournal} from '../mods/approvals/state.js';
import {parseCodex} from '../mods/approvals/parsers/codex.js';
import {basicPrompt, codexPrompt, deferred} from './fixtures/prompts.mjs';

function session(patch = {}) {
  return {sessionKey: 'core-1:t1:created-10:pid-20', episode: 'turn-1:blocked-30',
    title: 'Fixture tests', address: 't1', agent: 'codex', status: 'blocked',
    question: parseCodex(basicPrompt), ...patch};
}

function setup({journal = new MemoryJournal(), mode = 'once'} = {}) {
  let time = 0;
  const provider = {
    id: 'native', current: [session()], sent: [],
    async list() { return structuredClone(this.current); },
    async readQuestion(row) { return structuredClone(this.current.find(item => item.sessionKey === row.sessionKey) ?? null); },
    async submit(row, choice) { this.sent.push({row: structuredClone(row), choice}); return {status: 'delivered'}; },
  };
  const controller = new ApprovalController({provider, journal, now: () => time, mode});
  return {provider, journal, controller, advance: value => { time = value; }};
}

async function ready(options) {
  const h = setup(options);
  h.controller.setEnabled(true);
  await h.controller.refresh();
  return h;
}

async function quiet(promise) {
  try { await promise; } catch { /* Public error/status is checked by each failure test. */ }
}

function pauseRead(provider) {
  const started = deferred();
  const release = deferred();
  const original = provider.readQuestion.bind(provider);
  provider.readQuestion = async row => {
    started.resolve();
    await release.promise;
    return original(row);
  };
  return {started, release};
}

test('auto approval waits the full countdown, then sends the once choice exactly once', async () => {
  const h = await ready();
  assert.equal(h.controller.pending.deadline, 3000);
  h.advance(2999);
  await h.controller.tick();
  assert.equal(h.provider.sent.length, 0);
  h.advance(3000);
  await h.controller.tick();
  assert.deepEqual(h.provider.sent.map(item => item.choice), [1]);
  await h.controller.refresh();
  h.advance(9000);
  await h.controller.tick();
  assert.equal(h.provider.sent.length, 1);
});

test('automatic remember mode preserves the explicit configured narrow-scope preference', async () => {
  const h = await ready({mode: 'remember'});
  h.advance(3000);
  await h.controller.tick();
  assert.deepEqual(h.provider.sent.map(item => item.choice), [2]);
});

test('cancel suppresses this episode automatically but permits an explicit manual choice', async () => {
  const h = await ready();
  const key = h.provider.current[0].sessionKey;
  h.controller.cancel(key);
  await h.controller.refresh();
  h.advance(10000);
  await h.controller.tick();
  assert.equal(h.provider.sent.length, 0);
  await h.controller.submit(key, 3);
  assert.deepEqual(h.provider.sent.map(item => item.choice), [3]);
});

for (const action of ['cancel', 'disable', 'select', 'close']) {
  test(`${action} during validation prevents late async completion from dispatching`, async () => {
    const h = await ready();
    const gate = pauseRead(h.provider);
    h.advance(3000);
    const tick = h.controller.tick();
    await gate.started.promise;
    const key = h.provider.current[0].sessionKey;
    if (action === 'cancel') h.controller.cancel(key);
    if (action === 'disable') h.controller.setEnabled(false);
    if (action === 'select') h.controller.select(key, 3);
    if (action === 'close') h.controller.close();
    gate.release.resolve();
    await quiet(tick);
    assert.equal(h.provider.sent.length, 0);
  });
}

test('cancel while refresh is reading does not resurrect an automatic countdown', async () => {
  const h = setup();
  h.controller.setEnabled(true);
  const gate = pauseRead(h.provider);
  const refreshing = h.controller.refresh();
  await gate.started.promise;
  h.controller.cancel(h.provider.current[0].sessionKey);
  gate.release.resolve();
  await refreshing;
  h.advance(10000);
  await h.controller.tick();
  assert.equal(h.provider.sent.length, 0);
  assert.equal(h.controller.pending, null);
});

test('a changed command after countdown cancels that dispatch and needs a fresh countdown', async () => {
  const h = await ready();
  h.provider.current[0].question = parseCodex(codexPrompt({command: 'pnpm lint'}));
  h.advance(3000);
  await h.controller.tick();
  assert.equal(h.provider.sent.length, 0);
  await h.controller.refresh();
  assert.equal(h.controller.pending.deadline, 6000);
});

test('a new episode with identical text receives its own countdown after the previous episode', async () => {
  const h = await ready();
  h.advance(3000);
  await h.controller.tick();
  h.provider.current[0].episode = 'turn-2:blocked-60';
  h.advance(4000);
  await h.controller.refresh();
  assert.equal(h.controller.pending.deadline, 7000);
  h.advance(7000);
  await h.controller.tick();
  assert.equal(h.provider.sent.length, 2);
});

test('restarted terminal metadata cannot inherit an earlier countdown', async () => {
  const h = await ready();
  h.provider.current[0].sessionKey = 'core-1:t1:created-10:pid-99';
  h.advance(3000);
  await h.controller.tick();
  assert.equal(h.provider.sent.length, 0);
  await h.controller.refresh();
  assert.equal(h.controller.pending.sessionKey, h.provider.current[0].sessionKey);
  assert.equal(h.controller.pending.deadline, 6000);
});

test('unidentified, remote, non-blocked and unsupported requests never start auto sending', async () => {
  const h = setup();
  h.provider.current = [
    session({sessionKey: 'claude', agent: 'claude-code'}),
    session({sessionKey: 'remote', address: 'worker/t1', remote: 'worker'}),
    session({sessionKey: 'working', status: 'working'}),
    session({sessionKey: 'no-menu', question: null}),
    session({sessionKey: 'unknown-agent', agent: null}),
  ];
  h.controller.setEnabled(true);
  await h.controller.refresh();
  h.advance(10000);
  await h.controller.tick();
  assert.equal(h.controller.pending, null);
  assert.equal(h.provider.sent.length, 0);
});

test('a failed durable claim prevents input and exposes the persistence error', async () => {
  const journal = {async claim() { throw new Error('journal unavailable'); }, async mark() {}, async entries() { return []; }};
  const h = await ready({journal});
  h.advance(3000);
  await quiet(h.controller.tick());
  assert.equal(h.provider.sent.length, 0);
  assert.ok(h.controller.error);
});

test('cancel while a claim is pending prevents dispatch after durable persistence completes', async () => {
  const gate = deferred();
  const entered = deferred();
  const memory = new MemoryJournal();
  const journal = {
    async claim(key, record) { entered.resolve(); await gate.promise; return memory.claim(key, record); },
    mark: (...args) => memory.mark(...args), entries: () => memory.entries(),
  };
  const h = await ready({journal});
  h.advance(3000);
  const ticking = h.controller.tick();
  await entered.promise;
  h.controller.cancel();
  gate.resolve();
  await quiet(ticking);
  assert.equal(h.provider.sent.length, 0);
});

test('the post-claim fresh read rejects a request changed while claiming ownership', async () => {
  const memory = new MemoryJournal();
  let h;
  const journal = {
    async claim(key, record) {
      const claimed = await memory.claim(key, record);
      h.provider.current[0].question = parseCodex(codexPrompt({command: 'pnpm lint'}));
      return claimed;
    },
    mark: (...args) => memory.mark(...args), entries: () => memory.entries(),
  };
  h = await ready({journal});
  h.advance(3000);
  await h.controller.tick();
  assert.equal(h.provider.sent.length, 0);
});

test('two controllers sharing a journal cannot send the same episode twice', async () => {
  const journal = new MemoryJournal();
  const first = await ready({journal});
  const second = await ready({journal});
  first.advance(3000);
  second.advance(3000);
  await Promise.all([first.controller.tick(), second.controller.tick()]);
  assert.equal(first.provider.sent.length + second.provider.sent.length, 1);
});

test('unknown delivery stays fenced after reconstructing the controller', async () => {
  const h = await ready();
  h.provider.submit = async function (row, choice) {
    this.sent.push({row, choice});
    throw new Error('acknowledgement lost');
  };
  h.advance(3000);
  await quiet(h.controller.tick());
  assert.equal(h.controller.status, 'unknown');
  assert.ok((await h.journal.entries()).some(entry => entry.status === 'unknown'));
  const reloaded = new ApprovalController({provider: h.provider, journal: h.journal, now: () => 10000});
  reloaded.setEnabled(true);
  await reloaded.refresh();
  await quiet(reloaded.submit(h.provider.current[0].sessionKey, 1));
  await quiet(reloaded.tick());
  assert.equal(h.provider.sent.length, 1);
});

test('manual and automatic response paths share ownership while transport is unresolved', async () => {
  const h = await ready();
  const entered = deferred();
  const gate = deferred();
  h.provider.submit = async function (row, choice) {
    this.sent.push({row, choice});
    entered.resolve();
    await gate.promise;
    return {status: 'delivered'};
  };
  h.advance(3000);
  const automatic = h.controller.tick();
  await entered.promise;
  const manual = h.controller.submit(h.provider.current[0].sessionKey, 3);
  gate.resolve();
  await Promise.all([quiet(automatic), quiet(manual)]);
  assert.equal(h.provider.sent.length, 1);
});

test('manual submission validates the selected choice before transport', async () => {
  const h = await ready();
  await quiet(h.controller.submit(h.provider.current[0].sessionKey, 99));
  assert.equal(h.provider.sent.length, 0);
});

test('unknown delivery fences the entire incarnation even when the next prompt or episode changes', async () => {
  const h = await ready();
  h.provider.submit = async function (row, choice) {
    this.sent.push({row, choice});
    return {status: 'unknown'};
  };
  h.advance(3000);
  await h.controller.tick();
  assert.equal(h.controller.status, 'unknown');
  assert.equal(h.provider.sent.length, 1);

  h.provider.current[0].episode = 'turn-2:blocked-60';
  h.provider.current[0].question = parseCodex(codexPrompt({command: 'pnpm lint'}));
  h.advance(4000);
  await h.controller.refresh();
  h.advance(7000);
  await quiet(h.controller.tick());
  await quiet(h.controller.submit(h.provider.current[0].sessionKey, 3));
  assert.equal(h.provider.sent.length, 1, 'unknown input may still arrive in this incarnation');

  let time = 10000;
  const reloaded = new ApprovalController({provider: h.provider, journal: h.journal, now: () => time});
  reloaded.setEnabled(true);
  await reloaded.refresh();
  time = 13000;
  await quiet(reloaded.tick());
  await quiet(reloaded.submit(h.provider.current[0].sessionKey, 1));
  assert.equal(h.provider.sent.length, 1, 'reload must retain the incarnation quarantine');

  h.provider.current[0].sessionKey = 'core-1:t1:created-10:pid-99';
  time = 14000;
  await reloaded.refresh();
  time = 17000;
  await reloaded.tick();
  assert.equal(h.provider.sent.length, 2, 'a verified new incarnation has no old queued input');
});

test('a persisted dispatching attempt quarantines newer requests in the same incarnation', async () => {
  const h = setup();
  const original = h.provider.current[0];
  await h.journal.claim('earlier-attempt', {
    status: 'dispatching', provider: 'native', sessionKey: original.sessionKey,
    episode: 'turn-0:blocked-1', choice: 1, source: 'auto', at: 0,
  });
  h.provider.current[0].episode = 'turn-2:blocked-60';
  h.provider.current[0].question = parseCodex(codexPrompt({command: 'pnpm lint'}));
  h.controller.setEnabled(true);
  await h.controller.refresh();
  h.advance(3000);
  await quiet(h.controller.tick());
  await quiet(h.controller.submit(original.sessionKey, 3));
  assert.equal(h.provider.sent.length, 0, 'a crashed sender can still have delayed input queued');
});

test('a flushed cancellation survives controller reload without preventing explicit manual submission', async () => {
  const h = await ready();
  const key = h.provider.current[0].sessionKey;
  h.controller.cancel(key);
  await h.controller.flush();

  let time = 10000;
  const reloaded = new ApprovalController({provider: h.provider, journal: h.journal, now: () => time});
  reloaded.setEnabled(true);
  await reloaded.refresh();
  time = 13000;
  await reloaded.tick();
  assert.equal(h.provider.sent.length, 0);
  assert.equal(reloaded.pending, null);

  await reloaded.submit(key, 3);
  assert.deepEqual(h.provider.sent.map(item => item.choice), [3]);
});

test('a manual choice remains bound to the selected request after refresh observes another question', async () => {
  for (const explicitExpected of [false, true]) {
    const h = setup();
    await h.controller.refresh();
    const original = structuredClone(h.provider.current[0]);
    const expected = {episode: original.episode, fingerprint: original.question.fingerprint};
    h.controller.select(original.sessionKey, 1);

    h.provider.current[0].episode = 'turn-2:blocked-60';
    h.provider.current[0].question = parseCodex(codexPrompt({command: 'pnpm lint'}));
    await h.controller.refresh();

    await quiet(h.controller.submit(original.sessionKey, 1, explicitExpected ? expected : undefined));
    assert.equal(h.provider.sent.length, 0,
      explicitExpected ? 'a stale explicit expected snapshot must be rejected' : 'a previously selected choice must not be reused for the new question');
  }
});

test('another controller cannot auto-send a durably cancelled request without refreshing first', async () => {
  const journal = new MemoryJournal();
  const first = await ready({journal});
  const second = await ready({journal});
  const key = first.provider.current[0].sessionKey;
  assert.ok(first.controller.pending);
  assert.ok(second.controller.pending);

  first.controller.cancel(key);
  await first.controller.flush();
  second.advance(3000);
  await second.controller.tick();
  assert.equal(second.provider.sent.length, 0, 'a stale in-memory countdown must honor the persisted cancellation');

  await second.controller.submit(key, 3);
  assert.deepEqual(second.provider.sent.map(item => item.choice), [3], 'the cancellation applies to auto approval, not an explicit answer');
});

test('changing the configured delay invalidates the old countdown and applies the new deadline', async () => {
  const h = await ready();
  assert.equal(h.controller.pending.deadline, 3000);
  h.advance(1000);
  h.controller.setDelay(5000);
  assert.equal(h.controller.pending, null);
  await h.controller.refresh();
  assert.equal(h.controller.pending.deadline, 6000);
  h.advance(5999);
  await h.controller.tick();
  assert.equal(h.provider.sent.length, 0);
  h.advance(6000);
  await h.controller.tick();
  assert.equal(h.provider.sent.length, 1);
});

test('a session excluded from automatic approval stays visible and permits an explicit manual answer', async () => {
  const h = setup();
  h.provider.current[0].autoAllowed = false;
  h.controller.setEnabled(true);
  await h.controller.refresh();
  assert.equal(h.controller.rows.length, 1);
  assert.equal(h.controller.pending, null);
  h.advance(3000);
  await h.controller.tick();
  assert.equal(h.provider.sent.length, 0);
  await h.controller.submit(h.provider.current[0].sessionKey, 1);
  assert.deepEqual(h.provider.sent.map(item => item.choice), [1]);
});

test('removing a session from auto approval during either fresh validation read prevents dispatch', async () => {
  for (const pausedRead of [1, 2]) {
    const h = await ready();
    const entered = deferred();
    const gate = deferred();
    const original = h.provider.readQuestion.bind(h.provider);
    let reads = 0;
    h.provider.readQuestion = async row => {
      reads += 1;
      if (reads === pausedRead) { entered.resolve(); await gate.promise; }
      return original(row);
    };
    h.advance(3000);
    const ticking = h.controller.tick();
    await entered.promise;
    h.provider.current[0].autoAllowed = false;
    gate.resolve();
    await quiet(ticking);
    assert.equal(h.provider.sent.length, 0, `auto eligibility changed during validation read ${pausedRead}`);
  }
});
