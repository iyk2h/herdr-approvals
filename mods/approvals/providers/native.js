import { parseCodex, inputKeys } from '../parsers/codex.js';

function decoded(result) {
  if (result.code !== 0) throw new Error(result.stderr?.trim() || `hc exited ${result.code}`);
  return JSON.parse(result.stdout);
}

function word(terminal) {
  return typeof terminal.status === 'string' ? terminal.status : terminal.status?.state;
}

function kind(terminal) {
  return String(terminal.agent || terminal.status?.app || terminal.app || '').toLowerCase();
}
const codex = terminal => ['codex', 'openai-codex'].includes(kind(terminal));

export class NativeProvider {
  constructor(host) {
    this.id = 'native';
    this.claimScope = 'herdr-core-local';
    this.host = host;
    this.coreId = null;
  }

  async identity() {
    if (!this.coreId) {
      const status = decoded(await this.host.hc(['server', 'status', '--json']));
      if (!status.core?.id) throw new Error('Herdr core identity is unavailable');
      this.coreId = status.core.id;
    }
    return this.coreId;
  }

  async get(address) {
    if (!/^t[a-z0-9]+$/.test(address)) throw new Error('Only local terminal addresses are supported');
    const terminal = decoded(await this.host.hc(['get', address, '--json']));
    if (terminal.address !== address || !terminal.created_ms || !terminal.pid || !terminal.foreground?.pid) return null;
    const agent = codex(terminal) ? 'codex' : kind(terminal);
    const core = await this.identity();
    return {
      sessionKey: JSON.stringify([core, address, terminal.created_ms, terminal.pid]),
      episode: JSON.stringify([terminal.turn ?? 0, terminal.status_ms ?? null, terminal.foreground.pid]),
      address, agent, status: word(terminal), state: terminal.state,
      title: terminal.name || terminal.title || address,
      remote: false,
      requestKind: typeof terminal.status === 'object' ? terminal.status?.kind ?? null : null,
    };
  }

  async list() {
    const listing = decoded(await this.host.hc(['ls', '--json']));
    const candidates = (listing.terminals ?? []).filter(t =>
      /^t[a-z0-9]+$/.test(t.address) && t.state === 'live' && word(t) === 'blocked' && codex(t));
    const sessions = [];
    for (const terminal of candidates.slice(0, 40)) {
      const session = await this.get(terminal.address);
      if (session?.state === 'live' && session.status === 'blocked') sessions.push(session);
    }
    return sessions;
  }

  async readQuestion(session) {
    const before = await this.get(session.address);
    if (!before || before.state !== 'live' || before.status !== 'blocked' || before.agent !== 'codex' || (before.requestKind && before.requestKind !== 'permission')) return null;
    const result = decoded(await this.host.hc(['read', session.address, '--lines', '0', '--json']));
    const after = await this.get(session.address);
    if (!after || before.sessionKey !== after.sessionKey || before.episode !== after.episode || after.state !== 'live' || after.agent !== 'codex' || after.status !== 'blocked' || (after.requestKind && after.requestKind !== 'permission')) return null;
    const question = parseCodex(result.text ?? '');
    return question ? { ...after, question, observedAt: Date.now() } : null;
  }

  async submit(session, choice, options = {}) {
    const fresh = await this.readQuestion(session);
    if (!fresh || fresh.sessionKey !== session.sessionKey || fresh.episode !== session.episode || fresh.question.fingerprint !== session.question.fingerprint) {
      return { status: 'rejected' };
    }
    const keys = inputKeys(fresh.question, choice);
    if (options.allowed && !options.allowed()) return { status: 'rejected' };
    // Core may defer keys until quiet. A successful call is delivery, not semantic approval.
    try {
      const result = await this.host.hc(['keys', fresh.address, ...keys, '--json']);
      if (result.code !== 0) return { status: 'unknown' };
      return { status: 'delivered' };
    } catch {
      return { status: 'unknown' };
    }
  }
}
