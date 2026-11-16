// The optional adapter accepts an explicitly supplied transport; it never starts a hub.
export class CockpitProvider {
  constructor({ native, view, answer }) {
    this.id = 'cockpit';
    this.claimScope = 'herdr-core-local';
    this.native = native;
    this.view = view;
    this.answer = answer;
  }

  async list() {
    const value = await this.view();
    const rows = Array.isArray(value) ? value : value?.agents ?? value?.rows ?? [];
    const sessions = [];
    for (const row of rows) {
      if (row.stage !== 'needs_you' || !/^app:t[a-z0-9]+$/.test(row.terminal)) continue;
      const address = row.terminal.slice(4);
      const session = await this.native.get(address);
      if (session?.agent === 'codex' && session.status === 'blocked') sessions.push({ ...session, handle: row.terminal });
    }
    return sessions;
  }

  async readQuestion(session) {
    // Native snapshots retain the full command, which hub question text may abbreviate.
    const fresh = await this.native.readQuestion(session);
    return fresh ? { ...fresh, handle: `app:${fresh.address}` } : null;
  }

  async submit(session, choice, options = {}) {
    const fresh = await this.readQuestion(session);
    if (!fresh || fresh.sessionKey !== session.sessionKey || fresh.episode !== session.episode || fresh.question.fingerprint !== session.question.fingerprint) return { status: 'rejected' };
    if (!fresh.question.choices.some(c => c.n === choice)) return { status: 'rejected' };
    if (options.allowed && !options.allowed()) return { status: 'rejected' };
    try {
      const result = await this.answer({ terminal: fresh.handle, choice }, options);
      return { status: result?.error ? 'unknown' : 'delivered' };
    } catch {
      return { status: 'unknown' };
    }
  }
}
