import { View } from 'gpui-kit';
import { checking, shared, setShared, nextCommand, run, props, agents } from 'herdr';
import { ApprovalController } from './controller.js';
import { MemoryJournal, CasJournal } from './state.js';
import { parseCodex } from './parsers/codex.js';
import { NativeProvider } from './providers/native.js';
import { CockpitProvider } from './providers/cockpit.js';
import { ScopedProvider } from './providers/scoped.js';
import { host, journalHost } from './host.js';
import { cockpitRequest } from './cockpit-client.js';
import { panel } from './ui.js';

const PREVIEW = 'Would you like to run the following command?\n\n  $ pnpm test\n\n❯ 1. Yes, proceed (y)\n  2. Yes, and don\'t ask again for commands that start with `pnpm test`\n  3. No, and tell Codex what to do differently (esc)\n\nPress enter to confirm or esc to cancel';

export default class Approvals extends View {
  init(options, cx) {
    const p = options ?? props() ?? {};
    this.preview = checking() || Boolean(p.preview);
    this.tab = p.tab === 'settings' ? 'settings' : 'requests';
    this.focus = cx.focus_handle();
    this.mode = shared('approvals.mode') === 'remember' ? 'remember' : 'once';
    this.connection = shared('approvals.provider') === 'cockpit' ? 'cockpit' : 'native';
    this.delayMs = [3000, 5000, 10000].includes(shared('approvals.delay')) ? shared('approvals.delay') : 3000;
    this.scope = shared('approvals.scope') === 'selected' ? 'selected' : 'all';
    this.selectedSessions = Array.isArray(shared('approvals.sessions')) ? shared('approvals.sessions').filter(key => typeof key === 'string').slice(0, 40) : [];
    this.choice = null; this.selectedKey = null; this.busy = false; this.closed = false;
    this.sessionCatalog = [];
    this.makeController();
    if (this.preview) {
      const question = parseCodex(PREVIEW);
      this.controller.rows = [{ sessionKey: 'preview', episode: '1', address: 'fixture', title: 'Codex · Run tests', agent: 'codex', status: 'blocked', question }];
      this.sessionCatalog = this.controller.rows.map(({ question: _question, ...session }) => session);
      this.controller.enabled = true;
      this.controller.pending = { sessionKey: 'preview', episode: '1', fingerprint: question.fingerprint, choice: 1, deadline: Date.now() + 3000 };
      return;
    }
    this.refresh(cx);
    cx.timer.every(2000, cx => this.refresh(cx));
    cx.timer.every(1000, cx => { if (this.controller.pending || this.busy) cx.notify(); });
    cx.spawn(async cx => { while (!this.closed) { const name = await nextCommand(); this.command(name, cx); } });
  }
  makeController() {
    this.sessionCatalog = [];
    const native = new NativeProvider(host);
    const delegate = this.connection === 'cockpit' ? new CockpitProvider({ native, view: () => cockpitRequest({ op: 'view' }), answer: (choice, options) => cockpitRequest({ op: 'answer', ...choice }, options) }) : native;
    const provider = new ScopedProvider(delegate, () => ({ scope: shared('approvals.scope') === 'selected' ? 'selected' : 'all', selectedSessions: Array.isArray(shared('approvals.sessions')) ? shared('approvals.sessions') : [] }));
    this.journal = this.preview ? new MemoryJournal() : new CasJournal(journalHost, 'herdr.approvals.attempts.v1');
    this.controller = new ApprovalController({ provider, journal: this.journal, mode: this.mode, delayMs: this.delayMs });
    this.controller.setEnabled(!this.preview && shared('approvals.enabled') === true);
  }
  schedule(cx) {
    const pending = this.controller.pending;
    if (!pending || pending === this.scheduled) return;
    this.scheduled = pending;
    cx.timer.after(Math.max(0, pending.deadline - Date.now()), cx => {
      this.syncSettings();
      if (this.closed || this.preview || this.controller.pending !== pending) return;
      cx.spawn(async cx => { this.busy = true; cx.notify(); try { await this.controller.tick(); } catch (e) { this.error = String(e.message || e); } finally { this.busy = false; cx.notify(); this.schedule(cx); } });
    });
  }
  refresh(cx) {
    if (this.closed || this.preview || this.refreshing || this.busy) return;
    this.refreshing = true;
    const controller = this.controller;
    cx.spawn(async cx => {
      try {
        this.syncSettings();
        const catalog = await controller.provider.catalog();
        if (this.closed || controller !== this.controller) return;
        if (!Array.isArray(catalog)) throw new Error('Agent catalog is unavailable');
        this.sessionCatalog = catalog;
        await controller.refresh();
        if (this.closed || controller !== this.controller) return;
        this.error = controller.error;
        const selected = this.controller.rows.find(row => row.sessionKey === this.selectedKey);
        if (!selected) { this.selectedKey = this.controller.rows[0]?.sessionKey ?? null; this.choice = null; this.selection = null; }
        else if (this.selection && (selected.episode !== this.selection.episode || selected.question.fingerprint !== this.selection.fingerprint)) { this.choice = null; this.selection = null; }
        this.schedule(cx);
      } catch (e) {
        if (this.closed || controller !== this.controller) return;
        controller.discardObservations(e);
        this.sessionCatalog = []; this.selectedKey = null; this.choice = null; this.selection = null;
        this.error = String(e.message || e);
      } finally {
        if (!this.closed && controller === this.controller) { this.refreshing = false; cx.notify(); }
      }
    });
  }
  syncSettings() {
    if (this.preview || this.closed) return;
    this.controller.setEnabled(shared('approvals.enabled') === true);
    const mode = shared('approvals.mode') === 'remember' ? 'remember' : 'once';
    if (mode !== this.mode) { this.mode = mode; this.controller.setMode(mode); }
    const delay = [3000, 5000, 10000].includes(shared('approvals.delay')) ? shared('approvals.delay') : 3000;
    if (delay !== this.delayMs) { this.delayMs = delay; this.controller.setDelay(delay); }
    const scope = shared('approvals.scope') === 'selected' ? 'selected' : 'all';
    const selected = Array.isArray(shared('approvals.sessions')) ? shared('approvals.sessions').filter(key => typeof key === 'string').slice(0, 40) : [];
    const signature = JSON.stringify([scope, selected]);
    if (this.scopeSignature !== undefined && signature !== this.scopeSignature) this.controller.invalidate();
    this.scopeSignature = signature; this.scope = scope; this.selectedSessions = selected;
  }
  setTab(name, cx) { this.tab = name === 'settings' ? 'settings' : 'requests'; cx.notify(); }
  setDelay(ms, cx) { if (this.preview || ![3000, 5000, 10000].includes(ms)) return; setShared('approvals.delay', ms); this.syncSettings(); this.refresh(cx); cx.notify(); }
  setScope(scope, cx) { if (this.preview) return; setShared('approvals.scope', scope === 'selected' ? 'selected' : 'all'); this.syncSettings(); this.refresh(cx); cx.notify(); }
  toggleSession(key, cx) {
    if (this.preview || !this.sessionCatalog.some(session => session.sessionKey === key)) return;
    const selected = new Set(this.selectedSessions); if (selected.has(key)) selected.delete(key); else selected.add(key);
    setShared('approvals.sessions', [...selected].slice(0, 40)); this.syncSettings(); this.refresh(cx); cx.notify();
  }
  clearSessions(cx) {
    if (this.preview) return;
    setShared('approvals.sessions', []); this.controller.invalidate(); this.syncSettings(); this.refresh(cx); cx.notify();
  }
  setMode(mode, cx) { if (this.preview) return; setShared('approvals.mode', mode === 'remember' ? 'remember' : 'once'); this.syncSettings(); this.refresh(cx); cx.notify(); }
  pick(row, cx) { this.controller.cancel(row.sessionKey); this.selectedKey = row.sessionKey; this.choice = null; this.selection = null; cx.notify(); }
  choose(row, choice, cx) { if (this.preview || row.quarantined || !row.question.choices.some(item => item.n === choice && !item.free)) return; this.selectedKey = row.sessionKey; this.choice = choice; this.selection = { episode: row.episode, fingerprint: row.question.fingerprint }; this.controller.select(row.sessionKey, choice); cx.notify(); }
  cancel(cx) { this.controller.cancel(); cx.notify(); }
  toggle(cx) { if (this.preview) return; const enabled = !this.controller.enabled; setShared('approvals.enabled', enabled); this.controller.setEnabled(enabled); this.refresh(cx); cx.notify(); }
  toggleMode(cx) { if (this.preview || this.busy) return; this.mode = this.mode === 'once' ? 'remember' : 'once'; setShared('approvals.mode', this.mode); this.controller.setMode(this.mode); this.refresh(cx); cx.notify(); }
  switchProvider(cx) {
    if (this.preview || this.busy || this.refreshing || this.controller.rows.length) return;
    this.controller.close(); this.connection = this.connection === 'native' ? 'cockpit' : 'native';
    setShared('approvals.provider', this.connection); this.makeController(); this.refresh(cx); cx.notify();
  }
  submit(row, cx) {
    if (this.preview || this.busy || this.choice === null) return;
    const choice = this.choice, selection = this.selection;
    cx.spawn(async cx => { this.busy = true; cx.notify(); try { await this.controller.submit(row.sessionKey, choice, selection); } catch (e) { this.error = String(e.message || e); } finally { this.busy = false; this.choice = null; this.selection = null; cx.notify(); } });
  }
  inspect(row, cx) { this.controller.cancel(row.sessionKey); run('agent.focus', { terminal: row.address }); cx.notify(); }
  key(event, cx) {
    const key = event.keystroke || event.key;
    const row = this.controller.rows.find(item => item.sessionKey === this.selectedKey) ?? this.controller.rows[0];
    if (key === 'escape' || key === 'esc') this.cancel(cx);
    else if (this.tab === 'settings') return false;
    else if (row && /^[1-9]$/.test(key)) this.choose(row, Number(key), cx);
    else if (row && key === 'enter') this.submit(row, cx);
    else return false;
    return true;
  }
  command(name, cx) {
    if (name === 'focus' || name === 'open') this.focus.focus();
    else if (name === 'settings' || name === 'requests') { this.setTab(name, cx); this.focus.focus(); }
    else if (name === 'cancel') this.cancel(cx);
    else if (name === 'toggle-auto') this.toggle(cx);
    else if (name === 'refresh') this.refresh(cx);
    else if (name === 'approve' && this.choice !== null) { const row = this.controller.rows.find(item => item.sessionKey === this.selectedKey); if (row) this.submit(row, cx); }
    cx.notify();
  }
  render(cx) {
    if (!this.preview) {
      this.syncSettings();
      const signature = JSON.stringify(agents().map(agent => [agent.address, agent.seq, agent.status]));
      if (signature !== this.signature) { this.signature = signature; this.refresh(cx); }
    }
    return panel(this, cx);
  }
  close() { this.closed = true; this.controller.close(); }
}
