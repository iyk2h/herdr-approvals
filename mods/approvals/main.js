import { View } from 'gpui-kit';
import { checking, shared, setShared, nextCommand, run, props, agents, openOverlay, closeOverlay } from 'herdr';
import { ApprovalController } from './controller.js';
import { MemoryJournal, CasJournal } from './state.js';
import { parseCodex } from './parsers/codex.js';
import { NativeProvider } from './providers/native.js';
import { CockpitProvider } from './providers/cockpit.js';
import { ScopedProvider } from './providers/scoped.js';
import { host, journalHost } from './host.js';
import { cockpitRequest } from './cockpit-client.js';
import { panel } from './ui.js';
import { sha256 } from './digest.js';
import { registerOwner, presentation, newPresentation, revokePresentation, relay, publish, removeOwner } from './presentation-registry.js';

const PREVIEW = 'Would you like to run the following command?\n\n  $ pnpm test\n\n❯ 1. Yes, proceed (y)\n  2. Yes, and don\'t ask again for commands that start with `pnpm test`\n  3. No, and tell Codex what to do differently (esc)\n\nPress enter to confirm or esc to cancel';

export default class Approvals extends View {
  get controller() { return this.presentation ? this.owner?.controller : this._controller; }
  set controller(value) { this._controller = value; }
  init(options, cx) {
    const p = options ?? props() ?? {};
    if (p.presentation === true) { this.initPresentation(p, cx); return; }
    this.preview = checking() || Boolean(p.preview);
    this.compact = p.compact === true;
    this.panelId = typeof p.panelId === 'string' && p.panelId.trim() ? p.panelId : null;
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
    cx.timer.every(1000, cx => { if (this.controller.pending || this.busy) this.changed(cx); });
    cx.spawn(async cx => { while (!this.closed) { const name = await nextCommand(); this.command(name, cx); } });
  }
  initPresentation(p, cx) {
    this.presentation = true; this.ownerId = p.ownerId; this.dialogToken = p.dialogToken;
    this.tab = p.tab === 'settings' ? 'settings' : 'requests';
    this.overlay = p.overlay; this.closed = false; this.focus = cx.focus_handle();
    const entry = presentation(this.ownerId, this.dialogToken);
    this.owner = entry?.owner;
    this.preview = checking() || Boolean(p.preview) || !this.owner || this.owner.preview;
    if (this.preview) return;
    this.focus.focus();
    const updates = entry.dialog.updates;
    cx.spawn(async cx => {
      while (!this.closed && await updates.next()) {
        if (!presentation(this.ownerId, this.dialogToken)) break;
        cx.notify();
      }
    });
  }
  changed(cx) { if (!this.presentation) publish(this.ownerId); cx.notify(); }
  openPopup(tab, cx) {
    if (this.preview || this.closed || checking()) return;
    if (!this.presentationEntry) {
      const { id, entry } = registerOwner(this);
      this.ownerId = id; this.presentationEntry = entry;
      cx.spawn(async cx => {
        while (!this.closed) {
          const message = await entry.actions.next();
          if (!message) break;
          try { message.ack(Boolean(await this.handlePresentation(message.packet, cx))); }
          catch (error) { this.error = String(error?.message ?? error); message.ack(false); }
          this.changed(cx);
        }
      });
    }
    const dialog = newPresentation(this.ownerId, tab === 'settings' ? 'settings' : 'requests');
    this.dialogToken = dialog.token;
    if (this.popupId) closeOverlay(this.popupId);
    this.popupId = openOverlay({ mod: 'approvals', kind: 'dialog', width: 480, height: 600,
      props: { presentation: true, ownerId: this.ownerId, dialogToken: dialog.token, tab: dialog.tab } });
  }
  relay(action) {
    if (!this.presentation || this.closed || this.preview) return Promise.resolve(false);
    return relay({ ...action, ownerId: this.ownerId, dialogToken: this.dialogToken });
  }
  handlePresentation(packet, cx) {
    const entry = presentation(packet.ownerId, packet.dialogToken);
    if (this.closed || this.preview || entry?.owner !== this) return false;
    const { action, value } = packet;
    if (action === 'tab' && ['settings', 'requests'].includes(value)) { entry.dialog.tab = value; return true; }
    if (entry.dialog.tab === 'settings') {
      if (action === 'delay' && [3000, 5000, 10000].includes(value)) this.setDelay(value, cx);
      else if (action === 'mode' && ['once', 'remember'].includes(value)) this.setMode(value, cx);
      else if (action === 'scope' && ['all', 'selected'].includes(value)) this.setScope(value, cx);
      else if (action === 'session' && this.sessionCatalog.some(row => row.sessionKey === value)) this.toggleSession(value, cx);
      else if (action === 'clear') this.clearSessions(cx);
      else if (action === 'toggle' && typeof value === 'boolean') { if (value !== this.controller.enabled) this.toggle(cx); }
      else if (action === 'provider' && ['native', 'cockpit'].includes(value) && !this.busy && !this.refreshing && !this.controller.rows.length) { if (value !== this.connection) this.switchProvider(cx); }
      else return false;
      return true;
    }
    const row = this.controller.rows.find(row => row.sessionKey === packet.sessionKey);
    if (!row || row.episode !== packet.episode || sha256(row.question.fingerprint) !== packet.digest) return false;
    if (action === 'pick') this.pick(row, cx);
    else if (action === 'cancel') { this.controller.cancel(row.sessionKey); this.changed(cx); }
    else if (action === 'inspect') this.inspect(row, cx);
    else if (['choose', 'submit'].includes(action) && !this.busy && !row.quarantined
      && row.question.choices.some(choice => choice.n === packet.choice && !choice.free)) {
      if (action === 'choose') this.choose(row, packet.choice, cx);
      else if (packet.choice === this.choice && this.selectedKey === row.sessionKey
        && this.selection?.episode === row.episode && this.selection.fingerprint === row.question.fingerprint) this.submit(row, cx);
      else return false;
    } else return false;
    return true;
  }
  requestSnapshot(row) {
    return row ? { sessionKey: row.sessionKey, episode: row.episode, digest: sha256(row.question.fingerprint) } : {};
  }
  presentationView() {
    const available = presentation(this.ownerId, this.dialogToken);
    if (!available) return { presentation: true, unavailable: true, focus: this.focus, key: (event, cx) => this.key(event, cx), dismiss: () => this.dismiss() };
    const owner = available.owner;
    const row = owner.controller.rows.find(item => item.sessionKey === owner.selectedKey) ?? owner.controller.rows[0];
    this.visibleRequest = this.requestSnapshot(row); this.visibleChoice = owner.choice;
    const snapshots = new Map(owner.controller.rows.map(item => [item, this.requestSnapshot(item)]));
    const choice = owner.choice, enabled = owner.controller.enabled;
    const pendingRow = owner.controller.rows.find(item => item.sessionKey === owner.controller.pending?.sessionKey);
    const request = (action, row, extra = {}) => this.relay({ action, ...snapshots.get(row), ...extra });
    return { ...owner, controller: owner.controller, presentation: true, compact: false, tab: this.tab, focus: this.focus,
      preview: this.preview, key: (event, cx) => this.key(event, cx), dismiss: () => this.dismiss(),
      setTab: (tab, cx) => { this.tab = tab === 'settings' ? 'settings' : 'requests'; this.relay({ action: 'tab', value: this.tab }); cx.notify(); },
      toggle: () => this.relay({ action: 'toggle', value: !enabled }),
      setDelay: value => this.relay({ action: 'delay', value }), setMode: value => this.relay({ action: 'mode', value }),
      setScope: value => this.relay({ action: 'scope', value }), toggleSession: value => this.relay({ action: 'session', value }),
      clearSessions: () => this.relay({ action: 'clear' }), switchProvider: (_cx, value) => this.relay({ action: 'provider', value }),
      pick: row => request('pick', row), choose: (row, choice) => request('choose', row, { choice }),
      submit: row => request('submit', row, { choice }), inspect: row => request('inspect', row),
      cancel: () => request('cancel', pendingRow ?? row),
    };
  }
  dismiss() { this.close(); if (this.overlay) closeOverlay(this.overlay); }
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
      cx.spawn(async cx => { this.busy = true; this.changed(cx); try { await this.controller.tick(); } catch (e) { this.error = String(e.message || e); } finally { this.busy = false; this.updateCompactSize(cx); this.changed(cx); this.schedule(cx); } });
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
        if (!this.closed && controller === this.controller) { this.refreshing = false; this.updateCompactSize(cx); this.changed(cx); }
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
  updateCompactSize(_cx) {
    if (!this.compact || !this.panelId || this.preview || this.closed || checking()) return;
    const size = 40;
    if (size === this.compactSize) return;
    this.compactSize = size;
    run('layout.resize', { id: this.panelId, px: size });
  }
  setTab(name, cx) {
    const tab = name === 'settings' ? 'settings' : 'requests';
    if (this.compact) this.openPopup(tab, cx);
    else this.tab = tab;
    this.updateCompactSize(cx); this.changed(cx);
  }
  setDelay(ms, cx) { if (this.preview || ![3000, 5000, 10000].includes(ms)) return; setShared('approvals.delay', ms); this.syncSettings(); this.refresh(cx); this.changed(cx); }
  setScope(scope, cx) { if (this.preview) return; setShared('approvals.scope', scope === 'selected' ? 'selected' : 'all'); this.syncSettings(); this.refresh(cx); this.changed(cx); }
  toggleSession(key, cx) {
    if (this.preview || !this.sessionCatalog.some(session => session.sessionKey === key)) return;
    const selected = new Set(this.selectedSessions); if (selected.has(key)) selected.delete(key); else selected.add(key);
    setShared('approvals.sessions', [...selected].slice(0, 40)); this.syncSettings(); this.refresh(cx); this.changed(cx);
  }
  clearSessions(cx) {
    if (this.preview) return;
    setShared('approvals.sessions', []); this.controller.invalidate(); this.syncSettings(); this.refresh(cx); this.changed(cx);
  }
  setMode(mode, cx) { if (this.preview) return; setShared('approvals.mode', mode === 'remember' ? 'remember' : 'once'); this.syncSettings(); this.refresh(cx); this.changed(cx); }
  pick(row, cx) { this.controller.cancel(row.sessionKey); this.selectedKey = row.sessionKey; this.choice = null; this.selection = null; this.changed(cx); }
  review(row, cx) {
    if (this.preview || !row) return;
    this.controller.cancel(row.sessionKey); this.selectedKey = row.sessionKey; this.choice = null; this.selection = null;
    this.setTab('requests', cx);
  }
  choose(row, choice, cx) { if (this.preview || row.quarantined || !row.question.choices.some(item => item.n === choice && !item.free)) return; this.selectedKey = row.sessionKey; this.choice = choice; this.selection = { episode: row.episode, fingerprint: row.question.fingerprint }; this.controller.select(row.sessionKey, choice); this.changed(cx); }
  cancel(cx) { this.controller.cancel(); this.updateCompactSize(cx); this.changed(cx); }
  toggle(cx) { if (this.preview) return; const enabled = !this.controller.enabled; setShared('approvals.enabled', enabled); this.controller.setEnabled(enabled); this.updateCompactSize(cx); this.refresh(cx); this.changed(cx); }
  toggleMode(cx) { if (this.preview || this.busy) return; this.mode = this.mode === 'once' ? 'remember' : 'once'; setShared('approvals.mode', this.mode); this.controller.setMode(this.mode); this.refresh(cx); this.changed(cx); }
  switchProvider(cx) {
    if (this.preview || this.busy || this.refreshing || this.controller.rows.length) return;
    this.controller.close(); this.connection = this.connection === 'native' ? 'cockpit' : 'native';
    setShared('approvals.provider', this.connection); this.makeController(); this.refresh(cx); this.changed(cx);
  }
  submit(row, cx) {
    if (this.preview || this.busy || this.choice === null) return;
    const choice = this.choice, selection = this.selection;
    cx.spawn(async cx => { this.busy = true; this.changed(cx); try { await this.controller.submit(row.sessionKey, choice, selection); } catch (e) { this.error = String(e.message || e); } finally { this.busy = false; this.choice = null; this.selection = null; this.changed(cx); } });
  }
  inspect(row, cx) { this.controller.cancel(row.sessionKey); run('agent.focus', { terminal: row.address }); this.changed(cx); }
  key(event, cx) {
    const key = event.keystroke || event.key;
    if (this.presentation) {
      if (key === 'escape' || key === 'esc') { this.dismiss(); return true; }
      if (this.tab !== 'requests' || !this.visibleRequest?.sessionKey) return false;
      if (/^[1-9]$/.test(key)) this.relay({ action: 'choose', ...this.visibleRequest, choice: Number(key) });
      else if (key === 'enter' && this.visibleChoice !== null) this.relay({ action: 'submit', ...this.visibleRequest, choice: this.visibleChoice });
      else return false;
      return true;
    }
    const row = this.controller.rows.find(item => item.sessionKey === this.selectedKey) ?? this.controller.rows[0];
    if (key === 'escape' || key === 'esc') this.cancel(cx);
    else if (this.tab === 'settings' || this.compact) return false;
    else if (row && /^[1-9]$/.test(key)) this.choose(row, Number(key), cx);
    else if (row && key === 'enter') this.submit(row, cx);
    else return false;
    return true;
  }
  command(name, cx) {
    if (name === 'focus' || name === 'open') this.focus.focus();
    else if (name === 'settings' || name === 'requests') { this.setTab(name, cx); if (!this.compact) this.focus.focus(); }
    else if (name === 'cancel') this.cancel(cx);
    else if (name === 'toggle-auto') this.toggle(cx);
    else if (name === 'refresh') this.refresh(cx);
    else if (name === 'approve' && this.tab === 'requests' && this.choice !== null && !this.compact) { const row = this.controller.rows.find(item => item.sessionKey === this.selectedKey); if (row) this.submit(row, cx); }
    this.changed(cx);
  }
  render(cx) {
    if (this.presentation) return panel(this.presentationView(), cx);
    if (!this.preview) {
      this.syncSettings();
      const signature = JSON.stringify(agents().map(agent => [agent.address, agent.seq, agent.status]));
      if (signature !== this.signature) { this.signature = signature; this.refresh(cx); }
    }
    return panel(this, cx);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.presentation) { revokePresentation(this.ownerId, this.dialogToken); return; }
    removeOwner(this.ownerId);
    if (this.popupId) closeOverlay(this.popupId);
    this.controller.close();
  }
}
