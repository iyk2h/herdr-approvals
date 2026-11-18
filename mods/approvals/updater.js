import { VERSION } from './version.js';

export { VERSION };
export const RELEASES_URL = 'https://github.com/iyk2h/herdr-approvals/releases';
export const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function parts(value) {
  if (typeof value !== 'string' || !/^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value)) return null;
  const numbers = value.replace(/^v/, '').split('.').map(Number);
  return numbers.every(Number.isSafeInteger) ? numbers : null;
}

export function isNewer(next, current) {
  const a = parts(next), b = parts(current);
  if (!a || !b) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}

function byteLength(text) {
  let length = 0;
  for (const character of text) {
    const point = character.codePointAt(0);
    length += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return length;
}

export function parseRelease(payload, current = VERSION) {
  if (!payload || payload.draft !== false || payload.prerelease !== false
    || typeof payload.tag_name !== 'string' || !payload.tag_name.startsWith('v')
    || !parts(payload.tag_name) || !parts(current)) throw new Error('The published release is invalid.');
  const tag = payload.tag_name, version = tag.slice(1);
  const url = `${RELEASES_URL}/tag/${tag}`;
  const base = `${RELEASES_URL}/download/${tag}`;
  const archiveName = `herdr-approval-${version}.zip`;
  const asset = name => {
    const matches = Array.isArray(payload.assets) ? payload.assets.filter(item => item?.name === name) : [];
    if (matches.length !== 1 || matches[0].browser_download_url !== `${base}/${name}`) {
      throw new Error('The release files are missing or invalid.');
    }
    return matches[0].browser_download_url;
  };
  const notes = payload.body ?? '';
  if (payload.html_url !== url || typeof notes !== 'string' || notes.length > 20 * 1024
    || byteLength(notes) > 20 * 1024) throw new Error('The published release is invalid.');
  return Object.freeze({ version, tag, notes, url, archiveUrl: asset(archiveName),
    checksumUrl: asset(`${archiveName}.sha256`), available: isNewer(version, current) });
}

export class UpdateController {
  constructor({ host, version = VERSION, now = Date.now, canInstall = () => true }) {
    if (!parts(version)) throw new Error('The installed version is invalid.');
    this.host = host;
    this.version = version;
    this.now = now;
    this.canInstall = canInstall;
    this.phase = 'idle';
    this.release = null;
    this.checkedAt = null;
    this.error = null;
    this.result = null;
    this.checking = null;
    this.installing = null;
  }

  check({ force = false } = {}) {
    if (this.installing || this.phase === 'installing') return Promise.resolve(false);
    if (this.checking) return this.checking;
    const elapsed = this.now() - this.checkedAt;
    if (!force && this.checkedAt !== null && elapsed >= 0 && elapsed < CHECK_INTERVAL) return Promise.resolve(false);
    this.phase = 'checking'; this.error = null; this.release = null;
    this.checking = this.readRelease().finally(() => { this.checking = null; });
    return this.checking;
  }

  async readRelease() {
    try {
      const payload = await this.host.latest();
      if (payload === null) this.phase = 'unpublished';
      else {
        this.release = parseRelease(payload, this.version);
        this.phase = this.release.available ? 'available' : 'current';
      }
      this.checkedAt = this.now();
      return true;
    } catch (error) {
      this.phase = 'error'; this.release = null; this.checkedAt = null;
      this.error = String(error?.message ?? error);
      return false;
    }
  }

  install() {
    if (this.installing) return this.installing;
    if (this.checking || !['available', 'error'].includes(this.phase) || !this.release?.available) return Promise.resolve(false);
    try {
      if (!this.canInstall()) {
        this.error = 'Resolve pending requests and wait for replies to finish before you update.';
        return Promise.resolve(false);
      }
    } catch (error) {
      this.phase = 'error'; this.error = String(error?.message ?? error);
      return Promise.resolve(false);
    }
    const release = this.release;
    this.phase = 'installing'; this.error = null; this.result = null;
    this.installing = this.installRelease(release).finally(() => { this.installing = null; });
    return this.installing;
  }

  async installRelease(release) {
    try {
      const result = await this.host.install(release);
      if (result?.version !== release.version || typeof result.backup !== 'string' || !result.backup.trim()) {
        throw new Error('The installed version could not be verified.');
      }
      this.result = { version: result.version, backup: result.backup,
        ...(typeof result.warning === 'string' ? { warning: result.warning.slice(0, 2000) } : {}) };
      this.version = result.version;
      this.release = Object.freeze({ ...release, available: false });
      this.phase = 'installed';
      return true;
    } catch (error) {
      this.phase = 'error'; this.error = String(error?.message ?? error);
      return false;
    }
  }
}
