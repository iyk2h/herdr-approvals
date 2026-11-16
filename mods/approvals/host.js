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
