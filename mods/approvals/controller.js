import { chooseApproval } from './policy.js';
import { sha256 } from './digest.js';

const clone = value => JSON.parse(JSON.stringify(value));
const usable = row => row && typeof row.sessionKey === 'string' && row.sessionKey.length > 0
  && typeof row.episode === 'string' && row.episode.length > 0
  && row.agent === 'codex' && row.status === 'blocked' && !row.remote && /^t[a-z0-9]+$/.test(row.address)
  && typeof row.question?.fingerprint === 'string' && chooseApproval(row.question, 'once') !== null;
const sameRequest = (first, second) => usable(second)
  && first.sessionKey === second.sessionKey && first.episode === second.episode
  && first.question.fingerprint === second.question.fingerprint;

export class ApprovalController {
  constructor({ provider, journal, now = Date.now, delayMs = 3000, mode = 'once' }) {
    this.provider = provider;
    this.journal = journal;
    this.now = now;
    this.delayMs = Math.max(0, Number.isFinite(delayMs) ? delayMs : 3000);
    this.mode = mode === 'remember' ? 'remember' : 'once';
    this.enabled = false;
    this.closed = false;
    this.rows = [];
    this.pending = null;
    this.selected = null;
    this.selectionSnapshot = null;
    this.busy = false;
    this.status = 'idle';
    this.error = null;
    this.generation = 0;
    this.refreshSequence = 0;
    this.suppressed = new Set();
    this.cancelNext = new Set();
    this.active = null;
    this.pendingRow = null;
    this.pendingWrites = new Set();
    this.writeFailure = null;
  }

  key(row) {
    return JSON.stringify([this.provider.claimScope ?? this.provider.id, row.sessionKey, row.episode, sha256(row.question.fingerprint)]);
  }

  quarantined(row, entries) {
    const provider = this.provider.claimScope ?? this.provider.id;
    return entries.some(entry => entry.sessionKey === row.sessionKey && entry.provider === provider
      && (entry.status === 'dispatching' || entry.status === 'unknown'));
  }

  persistCancellation(row) {
    const requestKey = this.key(row);
    const write = Promise.resolve().then(async () => {
      try {
        await this.journal.claim(`cancel:${requestKey}`, {
          status: 'cancelled', kind: 'cancellation', requestKey,
          provider: this.provider.claimScope ?? this.provider.id,
          sessionKey: row.sessionKey, episode: row.episode, at: this.now(),
        });
      } catch (error) {
        this.writeFailure = error;
        this.error = String(error?.message ?? error);
      }
    });
    this.pendingWrites.add(write);
    write.then(() => this.pendingWrites.delete(write));
  }

  async flush() {
    while (this.pendingWrites.size) await Promise.all([...this.pendingWrites]);
    if (this.writeFailure) throw this.writeFailure;
  }

  invalidate() {
    this.generation += 1;
    this.pending = null;
    this.pendingRow = null;
  }

  discardObservations(error) {
    this.invalidate();
    this.rows = [];
    this.selected = null;
    this.selectionSnapshot = null;
    this.status = 'error';
    this.error = String(error?.message ?? error);
  }

  setEnabled(enabled) {
    const next = Boolean(enabled) && !this.closed;
    if (next === this.enabled) return;
    if (!next) this.cancel();
    else this.invalidate();
    this.enabled = next;
  }

  setMode(mode) {
    const next = mode === 'remember' ? 'remember' : 'once';
    if (next !== this.mode) {
      this.invalidate();
      this.mode = next;
    }
  }

  setDelay(delayMs) {
    if (![3000, 5000, 10000].includes(delayMs) || delayMs === this.delayMs) return;
    this.invalidate();
    this.delayMs = delayMs;
    if (!this.busy) this.status = 'idle';
  }

  cancel(sessionKey) {
    const row = sessionKey
      ? this.rows.find(item => item.sessionKey === sessionKey) ?? (this.active?.sessionKey === sessionKey ? this.active : null)
      : this.active ?? this.pendingRow;
    if (usable(row)) {
      this.suppressed.add(this.key(row));
      this.persistCancellation(row);
    }
    else if (sessionKey) this.cancelNext.add(sessionKey);
    this.invalidate();
    if (!this.busy) this.status = 'cancelled';
  }

  select(sessionKey, choice) {
    this.cancel(sessionKey);
    const row = this.rows.find(item => item.sessionKey === sessionKey);
    this.selectionSnapshot = usable(row)
      ? { sessionKey, choice, episode: row.episode, fingerprint: row.question.fingerprint }
      : null;
    this.selected = this.selectionSnapshot;
  }

  close() {
    this.cancel();
    this.closed = true;
    this.enabled = false;
  }

  async refresh() {
    if (this.closed) return;
    const generation = this.generation;
    const sequence = ++this.refreshSequence;
    const current = () => !this.closed && generation === this.generation && sequence === this.refreshSequence;
    try {
      await this.flush();
      if (!current()) return;
      const sessions = await this.provider.list();
      if (!current()) return;
      const rows = [];
      for (const session of sessions) {
        const row = await this.provider.readQuestion(session);
        if (!current()) return;
        if (usable(row)) rows.push(clone(row));
      }
      const entries = await this.journal.entries();
      if (!current()) return;
      this.error = null;
      if (this.status === 'error') this.status = 'idle';
      const claimed = new Set(entries.map(entry => entry.key));
      const cancelled = new Set(entries.filter(entry => entry.kind === 'cancellation').map(entry => entry.requestKey));
      this.rows = rows.map(row => ({ ...row, quarantined: this.quarantined(row, entries) }));
      for (const row of rows) {
        if (this.cancelNext.has(row.sessionKey)) {
          this.suppressed.add(this.key(row));
          this.cancelNext.delete(row.sessionKey);
        }
      }
      if (this.selected && !rows.some(row => row.sessionKey === this.selected.sessionKey
        && row.episode === this.selected.episode && row.question.fingerprint === this.selected.fingerprint)) this.selected = null;
      if (this.pendingRow && (!rows.some(row => sameRequest(this.pendingRow, row) && row.autoAllowed !== false)
        || claimed.has(this.key(this.pendingRow)) || cancelled.has(this.key(this.pendingRow))
        || this.quarantined(this.pendingRow, entries))) {
        this.pending = null;
        this.pendingRow = null;
      }
      if (!this.enabled || this.busy || this.pending) return;
      const row = rows.find(item => item.autoAllowed !== false && !claimed.has(this.key(item)) && !cancelled.has(this.key(item))
        && !this.suppressed.has(this.key(item)) && !this.quarantined(item, entries) && chooseApproval(item.question, this.mode) !== null);
      if (!row) {
        if (rows.some(item => this.quarantined(item, entries))) this.status = 'unknown';
        else if (this.status === 'countdown') this.status = 'idle';
        return;
      }
      const choice = chooseApproval(row.question, this.mode);
      this.pendingRow = clone(row);
      this.pending = { sessionKey: row.sessionKey, episode: row.episode, fingerprint: row.question.fingerprint, choice, deadline: this.now() + this.delayMs };
      this.status = 'countdown';
      this.error = null;
    } catch (error) {
      if (!current()) return;
      this.discardObservations(error);
    }
  }

  async tick() {
    try { await this.flush(); } catch (error) {
      this.error = String(error?.message ?? error);
      this.status = 'error';
      return { status: 'error' };
    }
    if (this.closed || !this.enabled || this.busy || !this.pending || this.now() < this.pending.deadline) return;
    const row = this.pendingRow;
    const choice = this.pending.choice;
    return this.dispatch(row, choice, 'auto');
  }

  async submit(sessionKey, choice, expected) {
    if (this.closed || this.busy) return { status: 'busy' };
    const row = this.rows.find(item => item.sessionKey === sessionKey);
    const snapshot = expected ?? (this.selectionSnapshot?.sessionKey === sessionKey ? this.selectionSnapshot : null);
    this.cancel(sessionKey);
    if (snapshot && (!row || row.episode !== snapshot.episode || row.question?.fingerprint !== snapshot.fingerprint)) {
      this.status = 'changed';
      return { status: 'changed' };
    }
    if (!usable(row) || !Number.isInteger(choice) || !row.question.choices.some(item => item.n === choice && !item.free)) {
      this.status = 'rejected';
      return { status: 'rejected' };
    }
    return this.dispatch(clone(row), choice, 'manual');
  }

  async dispatch(row, choice, source) {
    if (this.closed || this.busy || !usable(row)) return { status: 'busy' };
    const generation = this.generation;
    let observation = row;
    const allowed = () => !this.closed && generation === this.generation
      && (source !== 'auto' || (this.enabled && observation?.autoAllowed !== false));
    const key = this.key(row);
    const cancelled = entries => source === 'auto'
      && entries.some(entry => entry.kind === 'cancellation' && entry.requestKey === key);
    let claimed = false;
    let dispatched = false;
    this.busy = true;
    this.active = row;
    this.pending = null;
    this.pendingRow = null;
    this.status = 'validating';
    this.error = null;
    try {
      await this.flush();
      if (!allowed()) return { status: 'cancelled' };
      const records = await this.journal.entries();
      if (!allowed()) return { status: 'cancelled' };
      if (this.quarantined(row, records)) {
        this.status = 'unknown';
        return { status: 'unknown' };
      }
      if (cancelled(records)) {
        this.suppressed.add(key);
        this.status = 'cancelled';
        return { status: 'cancelled' };
      }
      const fresh = await this.provider.readQuestion(row);
      observation = fresh;
      if (!allowed()) return { status: 'cancelled' };
      if (!sameRequest(row, fresh) || !fresh.question.choices.some(item => item.n === choice && !item.free)) {
        this.status = 'changed';
        return { status: 'changed' };
      }
      claimed = await this.journal.claim(key, {
        status: 'dispatching', sessionKey: row.sessionKey, episode: row.episode,
        provider: this.provider.claimScope ?? this.provider.id, choice, source, at: this.now(),
      });
      if (!claimed) {
        this.suppressed.add(key);
        const records = await this.journal.entries();
        this.status = this.quarantined(row, records) ? 'unknown' : cancelled(records) ? 'cancelled' : 'already';
        return { status: this.status };
      }
      if (!allowed()) {
        await this.journal.mark(key, 'cancelled');
        this.status = 'cancelled';
        return { status: 'cancelled' };
      }
      const beforeRead = await this.journal.entries();
      if (!allowed() || cancelled(beforeRead)) {
        await this.journal.mark(key, 'cancelled');
        this.status = 'cancelled';
        return { status: 'cancelled' };
      }
      const latest = await this.provider.readQuestion(row);
      observation = latest;
      if (!allowed() || !sameRequest(row, latest)) {
        const status = allowed() ? 'changed' : 'cancelled';
        await this.journal.mark(key, status);
        this.status = status;
        return { status };
      }
      const beforeDispatch = await this.journal.entries();
      if (!allowed() || cancelled(beforeDispatch)) {
        await this.journal.mark(key, 'cancelled');
        this.status = 'cancelled';
        return { status: 'cancelled' };
      }
      // A durable claim fences cooperating clients, not external terminal input.
      dispatched = true;
      this.status = 'dispatching';
      const result = await this.provider.submit(latest, choice, { source, allowed });
      const status = result?.status === 'delivered' ? 'sent' : result?.status === 'rejected' ? 'rejected' : 'unknown';
      this.status = status;
      await this.journal.mark(key, status);
      return { status };
    } catch (error) {
      this.error = String(error?.message ?? error);
      this.status = dispatched ? 'unknown' : 'error';
      if (claimed) {
        try { await this.journal.mark(key, this.status); } catch { /* The original dispatching claim remains a fence. */ }
      }
      return { status: this.status };
    } finally {
      this.busy = false;
      this.active = null;
    }
  }
}
