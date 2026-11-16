import { exec, checking } from 'herdr';
import { cockpitInfo } from './host.js';

// The optional CLI transport has bounded IO and never installs or updates Cockpit.
export async function cockpitRequest(message, options = {}) {
  if (checking()) throw new Error('Cockpit IO is disabled during checking');
  const info = await cockpitInfo();
  let args;
  if (message.op === 'view') args = ['agents', '--json'];
  else if (message.op === 'answer' && /^app:t[a-z0-9]+$/.test(message.terminal) && Number.isInteger(message.choice) && message.choice > 0 && message.choice < 10) args = ['agents', 'answer', message.terminal, String(message.choice)];
  else throw new Error('This Cockpit request is not supported.');
  if (options.allowed && !options.allowed()) return { error: 'Input cancelled before dispatch' };
  const result = await exec(info.bin, args, { timeout: 15000 });
  if (result.code !== 0) throw new Error('The Cockpit request failed.');
  return message.op === 'view' ? JSON.parse(result.stdout) : {};
}
