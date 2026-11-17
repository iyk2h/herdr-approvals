import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalController } from '../mods/approvals/controller.js';
import { NativeProvider } from '../mods/approvals/providers/native.js';
import { CockpitProvider } from '../mods/approvals/providers/cockpit.js';
import { MemoryJournal } from '../mods/approvals/state.js';
import { terminalInputPrompt } from './fixtures/prompts.mjs';

function model({ failKeys = false, mode = 'once' } = {}) {
  let screen = terminalInputPrompt(), time = 0;
  const keys = [];
  const host = { async hc(args) {
    let value;
    if (args[0] === 'server') value = { core: { id: 'fixture-input-core' } };
    else if (args[0] === 'ls') value = { terminals: [{ address: 't7', state: 'live', agent: 'codex', status: 'blocked' }] };
    else if (args[0] === 'get') value = { address: 't7', state: 'live', created_ms: 100, pid: 123,
      foreground: { pid: 456 }, turn: 1, status_ms: 200, status: { app: 'codex', state: 'blocked', kind: 'permission' } };
    else if (args[0] === 'read') value = { text: screen, how: 'screen', complete: true };
    else if (args[0] === 'keys') {
      keys.push(args);
      if (failKeys) throw new Error('Delivery is unknown');
      value = {};
    } else throw new Error('Unexpected operation');
    return { code: 0, stdout: JSON.stringify(value) };
  } };
  const provider = new NativeProvider(host), journal = new MemoryJournal();
  const create = () => new ApprovalController({ provider, journal, delayMs: 2000, mode, now: () => time });
  return { provider, journal, keys, controller: create(), create,
    screen: value => { screen = value; }, at: value => { time = value; } };
}

for (const mode of ['once', 'remember']) {
  test(`terminal input uses the configured countdown and one fresh-menu reply in ${mode} mode`, async () => {
    const h = model({ mode });
    h.controller.setEnabled(true); await h.controller.refresh();
    assert.equal(h.controller.rows.length, 1);
    assert.equal(h.controller.rows[0].question.kind, 'terminal-input');
    assert.equal(h.controller.pending.deadline, 2000);
    h.at(1999); await h.controller.tick(); assert.deepEqual(h.keys, []);
    h.screen(terminalInputPrompt({ cursor: 2 }));
    h.at(2000); await h.controller.tick();
    assert.deepEqual(h.keys, [['keys', 't7', 'up', 'enter', '--json']], 'only answer the Codex menu; never send its displayed payload directly');
    await h.controller.refresh(); h.at(5000); await h.controller.tick();
    assert.equal(h.keys.length, 1);
    assert.equal((await h.journal.entries()).filter(entry => entry.status === 'sent').length, 1);
  });
}

for (const patch of [{ terminal: '24681' }, { input: '"exit\\n"' }, { environment: 'other' }, { reason: 'Different operation.' }]) {
  test(`a changed terminal input request blocks an already scheduled reply: ${JSON.stringify(patch)}`, async () => {
    const h = model(); h.controller.setEnabled(true); await h.controller.refresh();
    h.screen(terminalInputPrompt(patch)); h.at(2000); await h.controller.tick();
    assert.deepEqual(h.keys, []);
    await h.controller.refresh();
    assert.equal(h.controller.pending.deadline, 4000, 'the changed request needs its own full delay');
  });
}

test('cancellation and uncertain delivery fence terminal input approvals after controller reload', async () => {
  for (const failKeys of [false, true]) {
    const h = model({ failKeys }); h.controller.setEnabled(true); await h.controller.refresh();
    if (!failKeys) { h.controller.cancel(); await h.controller.flush(); }
    h.at(2000); await h.controller.tick();
    assert.equal(h.keys.length, failKeys ? 1 : 0);
    const reopened = h.create(); reopened.setEnabled(true); await reopened.refresh();
    h.at(6000); await reopened.tick();
    assert.equal(h.keys.length, failKeys ? 1 : 0);
  }
});

test('the Cockpit adapter validates terminal input identity and uses only its configured sender', async () => {
  const h = model(); let answers = 0;
  const adapter = new CockpitProvider({ native: h.provider,
    view: async () => ({ agents: [{ terminal: 'app:t7', stage: 'needs_you' }] }),
    answer: async packet => { assert.deepEqual(packet, { terminal: 'app:t7', choice: 1 }); answers++; return {}; },
  });
  const [session] = await adapter.list(); const row = await adapter.readQuestion(session);
  assert.equal(row.question.kind, 'terminal-input');
  assert.equal((await adapter.submit(row, 1)).status, 'delivered');
  h.screen(terminalInputPrompt({ input: '"different"' }));
  assert.equal((await adapter.submit(row, 1)).status, 'rejected');
  assert.equal(answers, 1); assert.deepEqual(h.keys, []);
});
