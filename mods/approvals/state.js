const DEFAULT_LIMIT = 512;
const copy = value => JSON.parse(JSON.stringify(value));
const cancelledAutoClaim = (entries, key, record) => record.source === 'auto'
  && entries.some(entry => entry.kind === 'cancellation' && entry.requestKey === key);
const conflictsWithSession = (entries, record) => record.status === 'dispatching'
  && typeof record.sessionKey === 'string'
  && entries.some(entry => entry.sessionKey === record.sessionKey && entry.provider === record.provider
    && (entry.status === 'dispatching' || entry.status === 'unknown'));

export class MemoryJournal {
  constructor({ limit = DEFAULT_LIMIT } = {}) {
    this.records = new Map();
    this.limit = limit;
  }

  async claim(key, record) {
    if (this.records.has(key)) return false;
    if (cancelledAutoClaim([...this.records.values()], key, record)) return false;
    if (conflictsWithSession([...this.records.values()], record)) return false;
    if (this.records.size >= this.limit) throw new Error('Approval journal is full; existing attempt fences are retained');
    this.records.set(key, copy({ ...record, key }));
    return true;
  }

  async mark(key, status) {
    const record = this.records.get(key);
    if (!record) return false;
    this.records.set(key, { ...record, status });
    return true;
  }

  async entries() {
    return [...this.records.values()].map(copy);
  }
}

function recordsOf(value) {
  if (value === null || value === undefined) return [];
  if (value.schema !== 1 || !Array.isArray(value.entries) || value.entries.some(record => !record || typeof record.key !== 'string' || typeof record.status !== 'string')) {
    throw new Error('Approval journal format is invalid; input is disabled');
  }
  const keys = value.entries.map(record => record.key);
  if (new Set(keys).size !== keys.length) throw new Error('Approval journal contains duplicate attempt fences');
  return copy(value.entries);
}

export class CasJournal {
  constructor(host, name = 'herdr.approvals.attempts.v1', { limit = DEFAULT_LIMIT } = {}) {
    this.host = host;
    this.name = name;
    this.limit = limit;
  }

  async update(change) {
    for (let retry = 0; retry < 16; retry += 1) {
      const snapshot = await this.host.read(this.name);
      if (!Number.isInteger(snapshot?.version) || snapshot.version < 0) throw new Error('Approval journal version is unavailable');
      const entries = recordsOf(snapshot.value);
      const result = change(entries);
      if (!result.changed) return result.value;
      try {
        await this.host.write(this.name, { schema: 1, entries }, snapshot.version);
        return result.value;
      } catch (error) {
        if (error?.kind !== 'conflict') throw error;
      }
    }
    throw new Error('Approval journal remained busy; no input was sent');
  }

  async claim(key, record) {
    return this.update(entries => {
      if (entries.some(entry => entry.key === key)) return { changed: false, value: false };
      if (cancelledAutoClaim(entries, key, record)) return { changed: false, value: false };
      if (conflictsWithSession(entries, record)) return { changed: false, value: false };
      if (entries.length >= this.limit) throw new Error('Approval journal is full; existing attempt fences are retained');
      entries.push(copy({ ...record, key }));
      return { changed: true, value: true };
    });
  }

  async mark(key, status) {
    return this.update(entries => {
      const record = entries.find(entry => entry.key === key);
      if (!record) return { changed: false, value: false };
      record.status = status;
      return { changed: true, value: true };
    });
  }

  async entries() {
    return recordsOf((await this.host.read(this.name)).value);
  }
}
