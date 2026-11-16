// Adapted from quaresc/cockpit prompt.rs at 7ae5aa6c16db3547d34b2270d56e4884c09abadd.
// That parser derives from johnny4young/herdr-relevo lib/prompt.js (Apache-2.0).
// Changes: JavaScript reimplementation, Codex-only permission recognition, full
// command identity, and rejection of ambiguous cursors. See NOTICE and LICENSES/.

const OPTION = /^\s*([❯›>]\s*)?(\d+)\.\s+(.+?)\s*$/;
const HEADER = /^\s*Would you like to run the following command\?\s*$/i;
const PROCEED = /^Yes,?\s*proceed(?:\s*\(y\))?$/i;
const DENY = /^No,\s*and tell Codex what to do differently(?:\s*\(esc\))?$/i;
const FREE = /^(?:\[[ xX✔✓✗]?\]|Type something\b|Chat about this\b)/i;

function screenLines(screen) {
  return screen
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/^[│┃]\s?/, '').replace(/\s?[│┃]\s*$/, '').trimEnd());
}

export function parseCodex(screen) {
  if (typeof screen !== 'string' || screen.length > 65536) return null;
  const lines = screenLines(screen);
  let header = -1;
  for (let i = 0; i < lines.length; i += 1) if (HEADER.test(lines[i])) header = i;
  if (header < 0) return null;

  const options = [];
  for (let i = header + 1; i < lines.length; i += 1) {
    const match = OPTION.exec(lines[i]);
    if (match) options.push({ line: i, n: Number(match[2]), label: match[3], selected: Boolean(match[1]) });
  }
  if (options.length < 2 || options.length > 9) return null;
  if (options.some((option, index) => option.n !== index + 1 || FREE.test(option.label))) return null;
  const selected = options.filter(option => option.selected);
  if (selected.length !== 1) return null;

  const first = options[0].line;
  const commandAt = lines.findIndex((line, index) => index > header && index < first && /^\s*\$\s+\S/.test(line));
  if (commandAt < 0) return null;
  const commandLines = lines.slice(commandAt, first);
  commandLines[0] = commandLines[0].replace(/^\s*\$\s+/, '');
  while (commandLines.length && commandLines[commandLines.length - 1].trim() === '') commandLines.pop();
  const command = commandLines.join('\n').trim();
  if (!command || /(?:\.\.\.|…)\s*$/.test(command) || command.includes('\ufffd')) return null;

  const choices = options.map((option, index) => {
    const next = options[index + 1]?.line ?? option.line + 1;
    const description = lines.slice(option.line + 1, next).map(line => line.trim()).filter(Boolean).join(' ');
    return { n: option.n, label: option.label.trim(), description, free: false };
  });
  if (choices.filter(choice => PROCEED.test(choice.label)).length !== 1 || choices.filter(choice => DENY.test(choice.label)).length !== 1) return null;
  if (choices.some(choice => FREE.test(choice.description))) return null;
  const text = lines[header].trim();
  return {
    text, command, choices, cursor: selected[0].n,
    fingerprint: JSON.stringify(['codex-permission-v1', text, command, choices.map(choice => [choice.n, choice.label, choice.description, choice.free])]),
  };
}

export function inputKeys(question, choice) {
  const choices = question?.choices;
  if (!Array.isArray(choices) || !Number.isInteger(question.cursor) || !Number.isInteger(choice)) throw new Error('Invalid permission choice');
  const current = choices.findIndex(item => item.n === question.cursor);
  const target = choices.findIndex(item => item.n === choice && !item.free);
  if (current < 0 || target < 0) throw new Error('Permission cursor or choice is unavailable');
  const key = target > current ? 'down' : 'up';
  return [...Array(Math.abs(target - current)).fill(key), 'enter'];
}
