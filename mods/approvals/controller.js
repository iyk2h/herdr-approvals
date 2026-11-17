import { chooseApproval } from './policy.js';
import { sha256 } from './digest.js';
import { savedDelay, validDelay } from './settings.js';

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
    this.delayMs = savedDelay(delayMs);
    this.mode = mode === 'remember' ? 'remember' : 'once';
    this.enabled = false;
    this.closed = false;
    this.rows = [];
    this.pending = null;
    this.countdowns = new Map();
    this.selected = null;
    this.selectionSnapshot = null;
    this.busy = false;
    this.status = 'idle';
    this.statusRequest = null;
    this.error = null;
    this.generation = 0;
    this.sessionGenerations = new Map();
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

  quarantineSession(sessionKey) {
    // A refresh started before the fence cannot restore its earlier row state.
    this.refreshSequence += 1;
    this.rows = this.rows.map(row => row.sessionKey === sessionKey ? { ...row, quarantined: true } : row);
    for (const [key, entry] of this.countdowns) {
      if (entry.row.sessionKey === sessionKey) this.countdowns.delete(key);
    }
    this.syncPending();
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
    this.countdowns.clear();
    this.pending = null;
    this.pendingRow = null;
  }

  syncPending() {
    let next = null;
    for (const entry of this.countdowns.values()) {
      if (!next || entry.pending.deadline < next.pending.deadline) next = entry;
    }
    this.pending = next?.pending ?? null;
    this.pendingRow = next?.row ?? null;
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
    if (!validDelay(delayMs) || delayMs === this.delayMs) return;
    this.invalidate();
    this.delayMs = delayMs;
    if (!this.busy) this.status = 'idle';
  }

  cancel(sessionKey) {
    const rows = sessionKey
      ? [this.active?.sessionKey === sessionKey ? this.active : this.rows.find(item => item.sessionKey === sessionKey)]
      : this.rows.concat([...this.countdowns.values()].map(entry => entry.row), this.active ?? []);
    const requests = new Map(rows.filter(usable).map(row => [this.key(row), row]));
    for (const [key, row] of requests) {
      this.suppressed.add(key);
      this.persistCancellation(row);
    }
    if (sessionKey) {
      if (!requests.size) this.cancelNext.add(sessionKey);
      this.sessionGenerations.set(sessionKey, (this.sessionGenerations.get(sessionKey) ?? 0) + 1);
      for (const [key, entry] of this.countdowns) {
        if (entry.row.sessionKey === sessionKey) this.countdowns.delete(key);
      }
      this.syncPending();
    } else this.invalidate();
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
          this.persistCancellation(row);
          this.cancelNext.delete(row.sessionKey);
        }
      }
      if (this.selected && !rows.some(row => row.sessionKey === this.selected.sessionKey
        && row.episode === this.selected.episode && row.question.fingerprint === this.selected.fingerprint)) this.selected = null;
      const eligible = new Map(rows.filter(row => row.autoAllowed !== false && !claimed.has(this.key(row)) && !cancelled.has(this.key(row))
        && !this.suppressed.has(this.key(row)) && !this.quarantined(row, entries) && chooseApproval(row.question, this.mode) !== null)
        .map(row => [this.key(row), row]));
      for (const key of this.countdowns.keys()) {
        if (!eligible.has(key)) this.countdowns.delete(key);
      }
      if (this.enabled) for (const [key, row] of eligible) {
        if (this.countdowns.has(key) || (this.active && this.key(this.active) === key)) continue;
        const choice = chooseApproval(row.question, this.mode);
        this.countdowns.set(key, { row: clone(row), pending: {
          sessionKey: row.sessionKey, episode: row.episode, fingerprint: row.question.fingerprint, choice,
          deadline: this.now() + this.delayMs,
        } });
      }
      this.syncPending();
      if (this.busy) return;
      if (!this.pending) {
        if (rows.some(item => this.quarantined(item, entries))) this.status = 'unknown';
        else if (this.status === 'countdown') this.status = 'idle';
        return;
      }
      this.status = 'countdown';
      this.error = null;
    } catch (error) {
      if (!current()) return;
      this.discardObservations(error);
    }
  }

  async tick() {
    if (this.closed || !this.enabled || this.busy || this.ticking) return;
    this.ticking = true;
    try {
      try { await this.flush(); } catch (error) {
        this.discardObservations(error);
        return { status: 'error' };
      }
      let result;
      while (!this.closed && this.enabled && !this.busy && this.pending && this.now() >= this.pending.deadline) {
        const row = this.pendingRow, choice = this.pending.choice;
        if (!row) break;
        result = await this.dispatch(row, choice, 'auto');
      }
      return result;
    } finally {
      this.ticking = false;
    }
  }

  async submit(sessionKey, choice, expected) {
    if (this.closed || this.busy) return { status: 'busy' };
    const row = this.rows.find(item => item.sessionKey === sessionKey);
    const snapshot = expected ?? (this.selectionSnapshot?.sessionKey === sessionKey ? this.selectionSnapshot : null);
    this.cancel(sessionKey);
    if (snapshot && (!row || row.episode !== snapshot.episode || row.question?.fingerprint !== snapshot.fingerprint)) {
      this.status = 'changed';
      this.statusRequest = row ? { sessionKey: row.sessionKey, episode: row.episode, fingerprint: row.question.fingerprint } : null;
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
    const sessionGeneration = this.sessionGenerations.get(row.sessionKey) ?? 0;
    let observation = row;
    const allowed = () => !this.closed && generation === this.generation
      && sessionGeneration === (this.sessionGenerations.get(row.sessionKey) ?? 0)
      && (source !== 'auto' || (this.enabled && observation?.autoAllowed !== false));
    const key = this.key(row);
    const cancelled = entries => source === 'auto'
      && entries.some(entry => entry.kind === 'cancellation' && entry.requestKey === key);
    let claimed = false;
    let dispatched = false;
    this.busy = true;
    this.active = row;
    this.countdowns.delete(key);
    this.syncPending();
    this.status = 'validating';
    this.statusRequest = { sessionKey: row.sessionKey, episode: row.episode, fingerprint: row.question.fingerprint };
    this.error = null;
    try {
      await this.flush();
      if (!allowed()) return { status: 'cancelled' };
      const records = await this.journal.entries();
      if (!allowed()) return { status: 'cancelled' };
      if (this.quarantined(row, records)) {
        this.status = 'unknown';
        this.quarantineSession(row.sessionKey);
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
        if (this.status === 'unknown') this.quarantineSession(row.sessionKey);
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
      if (status === 'unknown') this.quarantineSession(row.sessionKey);
      await this.journal.mark(key, status);
      return { status };
    } catch (error) {
      this.error = String(error?.message ?? error);
      this.status = dispatched ? 'unknown' : 'error';
      if (dispatched) this.quarantineSession(row.sessionKey);
      if (claimed) {
        try { await this.journal.mark(key, this.status); }
        catch { this.quarantineSession(row.sessionKey); }
      }
      return { status: this.status };
    } finally {
      this.busy = false;
      this.active = null;
    }
  }
}
