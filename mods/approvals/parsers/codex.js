// Adapted from quaresc/cockpit prompt.rs at 7ae5aa6c16db3547d34b2270d56e4884c09abadd.
// That parser derives from johnny4young/herdr-relevo lib/prompt.js (Apache-2.0).
// Changes: JavaScript reimplementation, Codex-only permission recognition, full
// command identity, and rejection of ambiguous cursors. See NOTICE and LICENSES/.

const OPTION = /^\s*([❯›>]\s*)?(\d+)\.\s+(.+?)\s*$/;
const HEADER = /^\s*Would you like to run the following command\?\s*$/i;
const INPUT_HEADER = /^\s*Would you like to send input to terminal ([1-9]\d{0,19})\?\s*$/i;
const PROCEED = /^Yes,?\s*proceed(?:\s*\(y\))?$/i;
const DENY = /^No,\s*and tell Codex what to do differently(?:\s*\(esc\))?$/i;
const FREE = /^(?:\[[ xX✔✓✗]?\]|Type something\b|Chat about this\b)/i;
const QUOTED_INPUT = /^"(?:[^"\\\x00-\x1f\ufffd]|\\(?:["\\nrt0bf/]|u\{[0-9a-fA-F]{1,6}\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}))*"$/;

function screenLines(screen) {
  return screen
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/^[│┃]\s?/, '').replace(/\s?[│┃]\s*$/, '').trimEnd());
}

function terminalInput(lines, header, options) {
  if (options.length !== 2 || !PROCEED.test(options[0].label) || !DENY.test(options[1].label)) return null;
  const body = lines.slice(header + 1, options[0].line);
  const inputs = body.filter(line => /^\s*Input:/.test(line));
  const environments = body.filter(line => /^\s*Environment:/.test(line));
  const reasons = body.filter(line => /^\s*Reason:/.test(line));
  if (inputs.length !== 1 || environments.length !== 1 || reasons.length !== 1) return null;
  if (!/^\s*Environment:\s*\S/.test(environments[0]) || !/^\s*Reason:\s*\S/.test(reasons[0])) return null;
  const environmentAt = body.indexOf(environments[0]), reasonAt = body.indexOf(reasons[0]), inputAt = body.indexOf(inputs[0]);
  if (environmentAt >= reasonAt || reasonAt >= inputAt
    || body.slice(0, environmentAt).some(line => line.trim())
    || body.slice(environmentAt + 1, reasonAt).some(line => line.trim())
    || body.slice(inputAt + 1).some(line => line.trim())
    || lines.slice(options[0].line + 1, options[1].line).some(line => line.trim())) return null;
  const input = inputs[0].replace(/^\s*Input:\s*/, '').trim();
  if (!QUOTED_INPUT.test(input)) return null;
  const tail = lines.slice(options[1].line + 1).map(line => line.trim()).filter(Boolean);
  if (tail.length !== 1 || !/^Press enter to confirm or esc to cancel$/i.test(tail[0])) return null;
  const terminalId = INPUT_HEADER.exec(lines[header])[1];
  const text = lines[header].trim();
  const choices = options.map(option => ({ n: option.n, label: option.label.trim(), description: '', free: false }));
  return { kind: 'terminal-input', terminalId, input, text, command: `Input: ${input}`, choices,
    cursor: options.find(option => option.selected).n,
    fingerprint: JSON.stringify(['codex-terminal-input-v1', text, body.join('\n').trim(), choices.map(choice => [choice.n, choice.label])]),
  };
}

export function parseCodex(screen) {
  if (typeof screen !== 'string' || screen.length > 65536) return null;
  const lines = screenLines(screen);
  let header = -1;
  for (let i = 0; i < lines.length; i += 1) if (HEADER.test(lines[i]) || INPUT_HEADER.test(lines[i])) header = i;
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
  if (INPUT_HEADER.test(lines[header])) return terminalInput(lines, header, options);

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
