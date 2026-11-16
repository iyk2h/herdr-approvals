export const codexPrompt = ({
  command = 'pnpm test',
  cursor = 1,
  remembered = "Yes, and don't ask again for commands that start with `pnpm test`",
  descriptions = false,
} = {}) => [
  'Would you like to run the following command?',
  '',
  `  $ ${command}`,
  '',
  `${cursor === 1 ? '❯' : ' '} 1. Yes, proceed (y)`,
  ...(descriptions ? ['     Run this command for this request only.'] : []),
  `${cursor === 2 ? '❯' : ' '} 2. ${remembered}`,
  ...(descriptions ? ['     The permission applies to this command prefix.'] : []),
  `${cursor === 3 ? '❯' : ' '} 3. No, and tell Codex what to do differently (esc)`,
  '',
  'Press enter to confirm or esc to cancel',
].join('\n');

export const basicPrompt = codexPrompt();

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

export function casHost() {
  let value = null;
  let version = 0;
  let fail = null;
  const copies = value => value === null ? null : structuredClone(value);
  return {
    setFailure(error) { fail = error; },
    async read() { return {value: copies(value), version}; },
    async write(_name, next, expected) {
      await Promise.resolve();
      if (fail) { const error = fail; fail = null; throw error; }
      if (expected !== version) throw Object.assign(new Error('version conflict'), {kind: 'conflict'});
      value = copies(next);
      version += 1;
    },
  };
}
