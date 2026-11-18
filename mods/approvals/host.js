import { exec, hc, appHome, readTextFile, home, checking } from 'herdr';

export const host = { hc: args => {
  if (checking()) throw new Error('Input and core IO are disabled during checking');
  return hc(args);
} };

export async function rpc(method, params = {}) {
  if (checking()) throw new Error('Core IO is disabled during checking');
  const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const result = await exec('/bin/sh', [`${appHome()}/mods/approvals/rpc.sh`, request], { timeout: 15000 });
  if (result.code !== 0) throw new Error(result.stderr?.trim() || 'Herdr core RPC is unavailable');
  const responses = result.stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  const response = responses.find(value => value.id === 1);
  if (!response) throw new Error('Herdr core did not acknowledge the request');
  if (response.error) {
    const error = new Error(response.error.message || 'Core request failed');
    error.kind = response.error.data?.kind;
    throw error;
  }
  return response.result;
}

export const journalHost = {
  read: name => rpc('doc.get', { name }),
  write: (name, value, version) => rpc('doc.set', { name, value, version }),
};

const RELEASE_API = 'https://api.github.com/repos/iyk2h/herdr-approvals/releases/latest';

export const updateHost = {
  async latest() {
    if (checking()) throw new Error('Update checks are disabled during checking');
    const result = await exec('curl', ['--silent', '--show-error', '--location', '--proto', '=https',
      '--proto-redir', '=https', '--max-time', '20', '--max-filesize', '262144',
      '--header', 'Accept: application/vnd.github+json', '--write-out', '\n%{http_code}', RELEASE_API], { timeout: 25000 });
    if (result.code !== 0) throw new Error('Could not check for updates. Try again.');
    const at = result.stdout.lastIndexOf('\n');
    const status = result.stdout.slice(at + 1).trim();
    if (status === '404') return null;
    if (status !== '200') throw new Error(status === '403' || status === '429'
      ? 'GitHub limited update checks. Try again later.' : 'Could not check for updates. Try again.');
    return JSON.parse(result.stdout.slice(0, at));
  },
  async install(release, attempt) {
    if (checking()) throw new Error('Updates are disabled during checking');
    let result;
    try {
      result = await exec('python3', [`${appHome()}/mods/approvals/update.py`, '--app-home', appHome(),
        '--version', release.version, '--attempt', attempt], { timeout: 300000 });
    } catch {
      throw new Error('The update did not complete. Python 3, curl, and herdr-app are required.');
    }
    let value;
    try { value = JSON.parse((result.stdout.trim() || result.stderr.trim()).split('\n').pop()); } catch { /* A failed process can stop before it writes a receipt. */ }
    if (result.code !== 0) throw new Error(value?.error || 'The update failed. Check the installed version.');
    if (!value || value.version !== release.version || typeof value.backup !== 'string') throw new Error('The update result is unavailable. Check the installed version.');
    return value;
  },
  async receipt() {
    if (checking()) throw new Error('Update records are disabled during checking');
    const text = await readTextFile(`${appHome()}/data/approvals-update-result.json`);
    if (!text || text.length > 16384) return null;
    let value;
    try { value = JSON.parse(text); } catch { return null; }
    if (value?.status === 'installing' && /^[A-Za-z0-9._:-]{1,160}$/.test(value.attempt || '')
      && /^\d+\.\d+\.\d+$/.test(value.version || '')) {
      const result = await exec('python3', [`${appHome()}/mods/approvals/update.py`, '--status',
        '--app-home', appHome(), '--version', value.version, '--attempt', value.attempt], { timeout: 40000 });
      if (result.code === 0) { try { return JSON.parse(result.stdout.trim()); } catch { return value; } }
    }
    return value;
  },
};

export async function cockpitInfo() {
  if (checking()) throw new Error('Cockpit IO is disabled during checking');
  const text = await readTextFile(`${appHome()}/cockpit.json`);
  if (!text) throw new Error('Cockpit settings are absent. Select the Herdr connection.');
  const install = JSON.parse(text);
  if (install.machine) throw new Error('Remote Cockpit connections are not supported.');
  const hubText = await readTextFile(`${install.cache || `${home()}/.cache/cockpit`}/hub.json`);
  if (!hubText) throw new Error('The Cockpit hub is not available. Start Cockpit.');
  const info = JSON.parse(hubText);
  if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535 || !info.token) throw new Error('The Cockpit hub settings are invalid.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(info.host || '127.0.0.1')) throw new Error('Only local Cockpit hubs are supported.');
  if (typeof install.bin !== 'string' || !install.bin) throw new Error('The Cockpit executable path is absent.');
  return { bin: install.bin };
}
