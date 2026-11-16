import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { ApprovalController } from '../mods/approvals/controller.js';
import { MemoryJournal } from '../mods/approvals/state.js';
import { parseCodex } from '../mods/approvals/parsers/codex.js';
import { basicPrompt } from './fixtures/prompts.mjs';

const settings = new Map();
let io = 0;
let checking = false;
globalThis.__pickerElement = () => new Proxy({}, {get: (_target, key) => key === 'then' ? undefined : () => globalThis.__pickerElement()});
globalThis.__pickerHost = {
  checking: () => checking, shared: key => settings.get(key), setShared: (key, value) => settings.set(key, value),
  props: () => ({}), agents: () => [], appHome: () => '/fixture', home: () => '/fixture',
  nextCommand: () => new Promise(() => {}), run: () => { io += 1; },
  theme: () => ({background: '#101010', foreground: '#ffffff', muted: '#aaaaaa', raised: '#202020', surface: '#202020', hover: '#303030'}),
  exec: async () => { io += 1; throw new Error('Unexpected process IO'); },
  hc: async () => { io += 1; throw new Error('Unexpected core IO'); },
  readTextFile: async () => { io += 1; throw new Error('Unexpected file IO'); },
};
const definitions = {
  'gpui-kit': 'export class View {} export const div=()=>globalThis.__pickerElement();',
  'gpui-base': 'export const Button={new:()=>globalThis.__pickerElement()};export const h_flex=()=>globalThis.__pickerElement();export const v_flex=h_flex;',
  herdr: Object.keys(globalThis.__pickerHost).map(name => `export const ${name}=(...args)=>globalThis.__pickerHost.${name}(...args);`).join('\n'),
};
registerHooks({resolve(specifier, context, next) {
  return definitions[specifier] ? {url: `data:text/javascript,${encodeURIComponent(definitions[specifier])}`, shortCircuit: true} : next(specifier, context);
}});
const {default: Approvals} = await import('../mods/approvals/main.js');

function context() {
  const tasks = [];
  const cx = {focus_handle: () => ({focus() {}}), notify() {}, stop_propagation() {},
    timer: {after() { throw new Error('Unexpected countdown in catalog test'); }, every() { throw new Error('Unexpected live polling in preview'); }},
    spawn(fn) { const task = fn(cx); tasks.push(task); return task; },
    async settle() { await Promise.all(tasks); },
  };
  return cx;
}

function viewFor(provider) {
  const controller = new ApprovalController({provider, journal: new MemoryJournal()});
  return Object.assign(Object.create(Approvals.prototype), {
    controller, preview: false, closed: false, mode: 'once', connection: 'native', delayMs: 3000,
    scope: 'selected', selectedSessions: [], sessionCatalog: [], selectedKey: null, choice: null,
    busy: false, refreshing: false,
  });
}

test('a working session can be selected in settings before it has any approval request', () => {
  checking = false; settings.clear();
  const working = {sessionKey: 'working-session', address: 't1', agent: 'codex', status: 'working'};
  const view = viewFor({id: 'native'});
  view.refresh = () => {};
  view.sessionCatalog = [working];
  assert.deepEqual(view.controller.rows, []);
  view.toggleSession(working.sessionKey, context());
  assert.deepEqual(settings.get('approvals.sessions'), [working.sessionKey]);
  assert.deepEqual(view.selectedSessions, [working.sessionKey]);
  view.toggleSession(working.sessionKey, context());
  assert.deepEqual(settings.get('approvals.sessions'), []);
});

test('the picker refuses unknown keys even when supplied as a stale request row', () => {
  checking = false; settings.clear();
  const view = viewFor({id: 'native'});
  view.refresh = () => {};
  view.controller.rows = [{sessionKey: 'not-in-current-catalog'}];
  view.toggleSession('not-in-current-catalog', context());
  assert.equal(settings.has('approvals.sessions'), false);
  assert.deepEqual(view.selectedSessions, []);
});

test('a live refresh stores the agent catalog independently of the empty request queue', async () => {
  checking = false; settings.clear();
  let catalogs = 0;
  const working = {sessionKey: 'working-session', address: 't1', agent: 'codex', status: 'working'};
  const view = viewFor({id: 'native',
    catalog: async () => { catalogs += 1; return [working]; },
    list: async () => [], readQuestion: async () => null,
  });
  const cx = context();
  view.refresh(cx);
  await cx.settle();
  assert.equal(catalogs, 1);
  assert.deepEqual(view.sessionCatalog, [working]);
  assert.deepEqual(view.controller.rows, []);
});

test('preview and checking never enumerate the live catalog or write user settings', () => {
  for (const isCheck of [false, true]) {
    checking = isCheck; settings.clear(); io = 0;
    const view = new Approvals();
    view.init({preview: !isCheck}, context());
    view.render(context());
    view.toggleSession('unknown', context());
    assert.equal(io, 0);
    assert.equal(settings.size, 0);
  }
});

test('clearing stored sessions removes stale keys and invalidates the countdown while preview keeps settings unchanged', async () => {
  checking = false; settings.clear();
  const row = {sessionKey: 'current-session', episode: '1', address: 't1', agent: 'codex',
    status: 'blocked', question: parseCodex(basicPrompt)};
  const stored = ['stopped-process-session', row.sessionKey];
  settings.set('approvals.enabled', true);
  settings.set('approvals.scope', 'selected');
  settings.set('approvals.sessions', [...stored]);
  const view = viewFor({id: 'native', list: async () => [row], readQuestion: async () => row});
  view.refresh = () => {};
  view.sessionCatalog = [row];
  view.syncSettings();
  await view.controller.refresh();
  assert.ok(view.controller.pending);
  assert.deepEqual(view.selectedSessions, stored);

  view.clearSessions(context());
  assert.deepEqual(settings.get('approvals.sessions'), []);
  assert.deepEqual(view.selectedSessions, []);
  assert.equal(view.controller.pending, null);
  assert.equal(settings.get('approvals.scope'), 'selected');

  settings.set('approvals.sessions', [...stored]);
  view.selectedSessions = [...stored];
  view.preview = true;
  view.clearSessions(context());
  assert.deepEqual(settings.get('approvals.sessions'), stored);
  assert.deepEqual(view.selectedSessions, stored);
});

test('a catalog refresh failure clears stale requests and manual selection so changing connection remains possible', async () => {
  checking = false; settings.clear();
  let failed = false;
  const row = {sessionKey: 'current-session', episode: '1', address: 't1', agent: 'codex',
    status: 'blocked', question: parseCodex(basicPrompt)};
  const view = viewFor({id: 'native',
    catalog: async () => { if (failed) throw new Error('catalog unavailable'); return [row]; },
    list: async () => [row], readQuestion: async () => row,
  });
  const cx = context();
  view.refresh(cx);
  await cx.settle();
  assert.equal(view.sessionCatalog.length, 1);
  assert.equal(view.controller.rows.length, 1);
  await view.controller.journal.claim('retained-unknown-attempt', {
    status: 'unknown', provider: 'native', sessionKey: 'another-incarnation', episode: 'old-episode',
  });
  view.choose(row, 1, cx);
  await view.controller.flush();
  assert.equal(view.choice, 1);
  assert.ok(view.selection);

  failed = true;
  view.refresh(cx);
  await cx.settle();
  assert.deepEqual(view.sessionCatalog, []);
  assert.deepEqual(view.controller.rows, []);
  assert.equal(view.controller.pending, null);
  assert.equal(view.choice, null);
  assert.equal(view.selection, null);
  assert.equal(view.selectedKey, null);
  assert.match(String(view.error), /catalog unavailable/);
  await view.controller.flush();
  assert.ok((await view.controller.journal.entries()).some(entry => entry.key === 'retained-unknown-attempt' && entry.status === 'unknown'));

  let replacements = 0;
  view.makeController = () => { replacements += 1; };
  view.refresh = () => {};
  view.switchProvider(cx);
  assert.equal(replacements, 1);
  assert.equal(view.connection, 'cockpit');
  assert.equal(settings.get('approvals.provider'), 'cockpit');
});
