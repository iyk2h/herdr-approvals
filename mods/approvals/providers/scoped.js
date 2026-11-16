export class ScopedProvider {
  constructor(delegate, settings) {
    this.delegate = delegate;
    this.settings = settings;
    this.id = delegate.id;
    this.claimScope = delegate.claimScope;
  }
  eligible(session) {
    const settings = this.settings();
    return settings.scope !== 'selected' || settings.selectedSessions.includes(session.sessionKey);
  }
  catalog() { return this.delegate.catalog(); }
  list() { return this.delegate.list(); }
  async readQuestion(session) {
    const row = await this.delegate.readQuestion(session);
    return row ? { ...row, autoAllowed: this.eligible(row) } : null;
  }
  submit(session, choice, options = {}) {
    const allowed = () => (!options.allowed || options.allowed()) && (options.source !== 'auto' || this.eligible(session));
    if (!allowed()) return Promise.resolve({ status: 'rejected' });
    return this.delegate.submit(session, choice, { ...options, allowed });
  }
}
