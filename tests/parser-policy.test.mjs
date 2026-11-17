import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCodex, inputKeys} from '../mods/approvals/parsers/codex.js';
import {chooseApproval} from '../mods/approvals/policy.js';
import {basicPrompt, codexPrompt, terminalInputPrompt} from './fixtures/prompts.mjs';

test('recognizes a complete terminal input permission and allows it once in either approval mode', () => {
  const question = parseCodex(terminalInputPrompt());
  assert.ok(question, 'terminal input approvals must enter the existing request flow');
  assert.equal(question.kind, 'terminal-input');
  assert.equal(question.terminalId, '24680');
  assert.equal(question.input, '"\\u{3}"');
  assert.equal(question.command, 'Input: "\\u{3}"');
  assert.equal(chooseApproval(question, 'once'), 1);
  assert.equal(chooseApproval(question, 'remember'), 1);
  assert.deepEqual(inputKeys(question, 1), ['enter']);
});

test('rejects incomplete or ambiguous terminal input approvals instead of inferring the missing data', () => {
  const prompt = terminalInputPrompt();
  for (const screen of [
    terminalInputPrompt({ terminal: '' }), terminalInputPrompt({ terminal: '../24680' }),
    terminalInputPrompt({ input: '"\\u{3}' }), terminalInputPrompt({ input: 'Ctrl+C' }),
    terminalInputPrompt({ input: '"\\q"' }), terminalInputPrompt({ input: '"\\u{}"' }),
    terminalInputPrompt({ input: '"damaged\ufffdinput"' }),
    prompt.replace('Environment: local\n', ''),
    prompt.replace('Reason: Send input to an existing terminal.\n', ''),
    prompt.replace('Input:', 'Environment: remote\nInput:'),
    prompt.replace('❯ 1.', '1.'), prompt.replace('  2.', '❯ 2.'),
    prompt.replace('Press enter to confirm or esc to cancel', ''),
    prompt.replace('Input:', 'Input: "other"\nInput:'),
    prompt.replace('  2. No,', '     Extra action\n  2. No,'),
    prompt.replace('❯ 1.', 'New context\n❯ 1.'),
  ]) assert.equal(parseCodex(screen), null, screen);
});

test('terminal input identity binds its target, full escaped input, environment and reason while cursor changes stay separate', () => {
  const original = parseCodex(terminalInputPrompt());
  for (const patch of [{ terminal: '24681' }, { input: '"exit\\n"' }, { environment: 'other' }, { reason: 'A changed operation.' }]) {
    assert.notEqual(parseCodex(terminalInputPrompt(patch)).fingerprint, original.fingerprint);
  }
  const moved = parseCodex(terminalInputPrompt({ cursor: 2 }));
  assert.equal(moved.fingerprint, original.fingerprint);
  assert.deepEqual(inputKeys(moved, 1), ['up', 'enter']);
  assert.equal(parseCodex(basicPrompt + '\n' + terminalInputPrompt()).fingerprint, original.fingerprint);
  for (const input of ['""', '"yes\\n"', '"quoted \\"text\\" and \\\\ path"', '"\\u0003"', '"\\u{1b}"']) {
    assert.equal(parseCodex(terminalInputPrompt({ input })).input, input);
  }
});

test('terminal input approval never saves a command rule even if a caller supplies rule choices', () => {
  const question = parseCodex(terminalInputPrompt());
  const withRule = { ...question, choices: [
    ...question.choices,
    { n: 3, label: "Yes, and don't ask again for commands that start with `pnpm test`", description: '', free: false },
  ] };
  assert.equal(chooseApproval(withRule, 'remember'), 1);
});

test('reads a complete Codex permission menu without losing its command or choice labels', () => {
  const question = parseCodex(basicPrompt);
  assert.ok(question);
  assert.equal(question.command, 'pnpm test');
  assert.equal(question.cursor, 1);
  assert.deepEqual(question.choices.map(choice => [choice.n, choice.label]), [
    [1, 'Yes, proceed (y)'],
    [2, "Yes, and don't ask again for commands that start with `pnpm test`"],
    [3, 'No, and tell Codex what to do differently (esc)'],
  ]);
  assert.equal(typeof question.fingerprint, 'string');
  assert.notEqual(question.fingerprint, '');
});

test('keeps wrapped command text and quotation changes in the request fingerprint', () => {
  const command = 'node -e "console.log(\'one\')"\n    --test-name-pattern "two words"';
  const first = parseCodex(codexPrompt({command}));
  const second = parseCodex(codexPrompt({command: command.replace('one', 'two')}));
  assert.ok(first.command.includes('console.log(\'one\')'));
  assert.ok(first.command.includes('--test-name-pattern "two words"'));
  assert.notEqual(first.fingerprint, second.fingerprint);
});

test('a cursor move changes the input plan without changing request identity', () => {
  const first = parseCodex(basicPrompt);
  const moved = parseCodex(codexPrompt({cursor: 3}));
  assert.equal(first.fingerprint, moved.fingerprint);
  assert.deepEqual(inputKeys(first, 2), ['down', 'enter']);
  assert.deepEqual(inputKeys(moved, 1), ['up', 'up', 'enter']);
  assert.deepEqual(inputKeys(moved, 3), ['enter']);
  assert.throws(() => inputKeys(moved, 9));
});

test('retains option descriptions and includes their changes in identity', () => {
  const question = parseCodex(codexPrompt({descriptions: true}));
  assert.equal(question.choices[0].description, 'Run this command for this request only.');
  const changed = parseCodex(codexPrompt({descriptions: true}).replace('this request only.', 'the current workspace.'));
  assert.notEqual(question.fingerprint, changed.fingerprint);
});

test('ignores terminal color escapes while preserving the selected cursor', () => {
  const colored = basicPrompt.replace('❯', '\u001b[36m❯\u001b[0m');
  assert.equal(parseCodex(colored).fingerprint, parseCodex(basicPrompt).fingerprint);
});

test('rejects ordinary numbered prose and Yes/No questions', () => {
  for (const screen of [
    'Choose a release plan\n$ pnpm test\n❯ 1. Yes\n  2. No',
    'Documentation example\n  1. Yes, proceed (y)\n  2. No, and tell Codex what to do differently (esc)',
    'Run pnpm test?\nYes / No',
  ]) assert.equal(parseCodex(screen), null);
});

test('rejects incomplete command blocks, missing or ambiguous cursors, gaps and duplicates', () => {
  for (const screen of [
    basicPrompt.replace('  $ pnpm test\n', ''),
    basicPrompt.replace('❯', ' '),
    basicPrompt.replace('  2.', '❯ 2.'),
    basicPrompt.replace('  2.', '  4.'),
    basicPrompt.replace('  2.', '  1.'),
  ]) assert.equal(parseCodex(screen), null);
});

test('rejects checkbox, free-text and non-Codex permission menus', () => {
  for (const screen of [
    basicPrompt.replace('Yes, proceed (y)', '[ ] Yes, proceed (y)'),
    basicPrompt.replace("Yes, and don't ask again for commands that start with `pnpm test`", 'Type something'),
    basicPrompt.replace('tell Codex', 'tell another tool'),
  ]) assert.equal(parseCodex(screen), null);
});

test('once is the default policy and remember chooses the unique narrow scope', () => {
  const question = parseCodex(basicPrompt);
  assert.equal(chooseApproval(question), 1);
  assert.equal(chooseApproval(question, 'once'), 1);
  assert.equal(chooseApproval(question, 'remember'), 2);
});

test('remember never chooses a broad all/any/future or bypass scope', () => {
  for (const remembered of [
    "Yes, and don't ask again for all commands",
    "Yes, and don't ask again for any tools",
    "Yes, and don't ask again for all future actions",
    "Yes, and don't ask again for bypass commands",
  ]) assert.notEqual(chooseApproval(parseCodex(codexPrompt({remembered})), 'remember'), 2);
});

test('ambiguous remembered scopes and ordinary Yes/No choices are not auto-approved', () => {
  const question = parseCodex(basicPrompt);
  assert.equal(chooseApproval({...question, choices: [
    ...question.choices,
    {n: 4, label: "Yes, and don't ask again for commands that start with `pnpm lint`", description: '', free: false},
  ]}, 'remember'), null);
  assert.equal(chooseApproval({text: 'Pick a plan', command: 'plan', cursor: 1,
    choices: [{n: 1, label: 'Yes'}, {n: 2, label: 'No'}]}), null);
});
