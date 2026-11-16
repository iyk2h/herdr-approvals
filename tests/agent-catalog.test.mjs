import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeProvider } from '../mods/approvals/providers/native.js';
import { ScopedProvider } from '../mods/approvals/providers/scoped.js';

function metadata(address, status, extra = {}) {
  return {address, state: 'live', created_ms: 100, pid: Number(address.slice(1)) + 100,
    foreground: {pid: Number(address.slice(1)) + 100}, turn: 2, status_ms: 200,
    title: `Fixture ${address}`, agent: 'codex', status, ...extra};
}

function catalogHost() {
  const terminals = [
    metadata('t1', 'working'), metadata('t2', 'idle'), metadata('t3', 'done'),
    metadata('t4', 'blocked'), metadata('t5', 'working', {state: 'finished'}),
    metadata('t6', null, {agent: null, foreground: {pid: 106, name: 'zsh'}}),
    metadata('t7', 'blocked', {agent: 'claude-code'}),
    metadata('worker/t8', 'working'),
  ];
  const calls = [];
  const current = new Map(terminals.map(item => [item.address, structuredClone(item)]));
  return {calls, current, async hc(args) {
    calls.push(args);
    const ok = value => ({code: 0, stdout: JSON.stringify(value)});
    if (args[0] === 'server') return ok({core: {id: 'catalog-core'}});
    if (args[0] === 'ls') return ok({terminals});
    if (args[0] === 'get') return ok(current.get(args[1]));
    throw new Error(`Catalog must not read a prompt or send input: ${args[0]}`);
  }};
}

test('native catalog includes working idle done and blocked local Codex sessions before a question arrives', async () => {
  const host = catalogHost();
  const provider = new NativeProvider(host);
  const rows = await provider.catalog();
  assert.deepEqual(rows.map(row => [row.address, row.status]), [
    ['t1', 'working'], ['t2', 'idle'], ['t3', 'done'], ['t4', 'blocked'],
  ]);
  assert.equal(rows[0].sessionKey, (await provider.get('t1')).sessionKey);
  assert.equal(new Set(rows.map(row => row.sessionKey)).size, 4);
  assert.ok(host.calls.filter(args => args[0] === 'get').every(args => ['t1', 't2', 't3', 't4'].includes(args[1])));
  assert.equal(host.calls.some(args => ['read', 'keys', 'send'].includes(args[0])), false);
});

test('native catalog rechecks listed sessions and excludes a process that finished or became a shell', async () => {
  const host = catalogHost();
  host.current.set('t1', metadata('t1', 'working', {state: 'finished'}));
  host.current.set('t2', metadata('t2', null, {agent: null, foreground: {pid: 102, name: 'zsh'}}));
  const rows = await new NativeProvider(host).catalog();
  assert.deepEqual(rows.map(row => row.address), ['t3', 't4']);
});

test('request discovery stays blocked-only even though the settings catalog covers nonblocked agents', async () => {
  const host = catalogHost();
  const rows = await new NativeProvider(host).list();
  assert.deepEqual(rows.map(row => [row.address, row.status]), [['t4', 'blocked']]);
  assert.ok(host.calls.filter(args => args[0] === 'get').every(args => args[1] === 't4'));
});

test('all scope includes future discoveries while selected scope requires explicitly adding each session', async () => {
  let rows = [{sessionKey: 'existing', status: 'working'}];
  const settings = {scope: 'all', selectedSessions: []};
  const provider = new ScopedProvider({id: 'native', list: async () => rows,
    readQuestion: async row => row}, () => settings);
  assert.equal((await provider.readQuestion(rows[0])).autoAllowed, true);
  rows = [...rows, {sessionKey: 'future', status: 'blocked'}];
  const future = (await provider.list()).find(row => row.sessionKey === 'future');
  assert.equal((await provider.readQuestion(future)).autoAllowed, true);
  settings.scope = 'selected';
  settings.selectedSessions = ['existing'];
  assert.equal((await provider.readQuestion(future)).autoAllowed, false);
  settings.selectedSessions.push('future');
  assert.equal((await provider.readQuestion(future)).autoAllowed, true);
});

test('the scope wrapper exposes the full settings catalog without filtering out unselected working sessions', async () => {
  const rows = [{sessionKey: 'selected', status: 'working'}, {sessionKey: 'not-selected', status: 'idle'}];
  let calls = 0;
  const scoped = new ScopedProvider({id: 'native', catalog: async () => { calls += 1; return rows; }},
    () => ({scope: 'selected', selectedSessions: ['selected']}));
  assert.deepEqual(await scoped.catalog(), rows);
  assert.equal(calls, 1);
});
